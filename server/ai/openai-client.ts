import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IncompleteAIResponseError, type AIProvider, type AIRequest, type AIResult } from './contracts.ts';

type OpenAIConfig = { apiKey: string; model: string };

let configPromise: Promise<OpenAIConfig> | null = null;

const stripQuotes = (value: string) => value.trim().replace(/^['"]|['"]$/g, '');

async function loadConfig(): Promise<OpenAIConfig> {
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? 'gpt-5-nano',
    };
  }

  const keyFile = path.resolve(process.cwd(), process.env.OPENAI_KEY_FILE ?? 'keys/key.txt');
  const raw = await readFile(keyFile, 'utf8');
  const values = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (match) values.set(match[1], stripQuotes(match[2]));
  }

  // Accept the old label temporarily so a key replaced in-place works before
  // the local secret file is renamed. New setups should use OPENAI_API_KEY.
  const apiKey = values.get('OPENAI_API_KEY') ?? values.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY was not found in the configured key file.');
  if (!apiKey.startsWith('sk-')) throw new Error('The configured credential is not an OpenAI API key.');
  return { apiKey, model: values.get('OPENAI_MODEL') ?? 'gpt-5-nano' };
}

export async function openAIIsConfigured() {
  try {
    await (configPromise ??= loadConfig());
    return true;
  } catch {
    return false;
  }
}

type ResponseOutput = {
  status?: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
    action?: { sources?: Array<{ type?: string; title?: string; url?: string }> };
  }>;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

export async function openAIResponse(request: AIRequest): Promise<AIResult> {
  const config = await (configPromise ??= loadConfig());
  const workloadModel = request.workload === 'assessment'
    ? process.env.OPENAI_ASSESSOR_MODEL ?? 'gpt-5.4-nano'
    : request.workload === 'research'
    ? process.env.OPENAI_RESEARCH_MODEL ?? 'gpt-5.4-nano'
    : request.workload === 'teacher'
      ? process.env.OPENAI_TEACHER_MODEL ?? 'gpt-5.4-nano'
      : undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
        model: request.model ?? workloadModel ?? config.model,
        input: request.messages,
        store: false,
        ...(request.jsonSchema ? {
          text: { format: { type: 'json_schema', name: request.jsonSchema.name, schema: request.jsonSchema.schema, strict: true }, ...(request.textVerbosity ? { verbosity: request.textVerbosity } : {}) },
        } : request.jsonMode ? { text: { format: { type: 'json_object' }, ...(request.textVerbosity ? { verbosity: request.textVerbosity } : {}) } } : request.textVerbosity ? { text: { verbosity: request.textVerbosity } } : {}),
        ...(request.builtInTools?.length ? {
          tools: request.builtInTools.map((type) => type === 'web_search'
            ? { type: 'web_search' }
            : { type: 'code_interpreter', container: { type: 'auto' } }),
        } : {}),
        ...(request.requireTool ? { tool_choice: 'required' } : {}),
        ...(request.includeWebSources ? { include: ['web_search_call.action.sources'] } : {}),
        ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
        }),
      });
    } catch (error) {
      const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
      if ((error as Error).name === 'AbortError') throw new Error('OpenAI did not respond within 60 seconds. Please try again.');
      const detail = [cause?.code, cause?.message].filter(Boolean).join(': ');
      console.error(`[AdaptLearn] OpenAI network failure${detail ? ` (${detail})` : ''}`);
      throw new Error(`Could not reach OpenAI${cause?.code ? ` (${cause.code})` : ''}. Your key was loaded, but the network request failed.`);
    }
    const data = await response.json() as ResponseOutput;
    if (!response.ok) {
      throw new Error(`OpenAI request failed (${response.status}): ${data.error?.message ?? 'Unknown API error'}`);
    }
    if (data.status === 'incomplete') {
      const reason = data.incomplete_details?.reason ?? 'unknown reason';
      console.warn(`[AdaptLearn] OpenAI response incomplete: reason=${reason}, outputTokens=${data.usage?.output_tokens ?? 'unknown'}`);
      throw new IncompleteAIResponseError(reason);
    }
    if (data.status === 'failed') throw new Error(`OpenAI could not complete the response: ${data.error?.message ?? 'Unknown API error'}`);
    const content = data.output_text?.trim() ?? data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text' && item.text)
      .map((item) => item.text)
      .join('\n')
      .trim();
    if (!content) throw new Error('OpenAI returned an empty response.');
    const webSources = (data.output ?? [])
      .flatMap((item) => item.action?.sources ?? [])
      .filter((source): source is { type?: string; title?: string; url: string } => Boolean(source.url))
      .map((source) => ({ title: source.title?.trim() || source.url, url: source.url }))
      .filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url) === index);
    return { text: content, webSources };
  } finally {
    clearTimeout(timeout);
  }
}

export async function openAIChat(request: AIRequest): Promise<string> {
  return (await openAIResponse(request)).text;
}

export const openAIProvider: AIProvider = {
  id: 'openai',
  isConfigured: openAIIsConfigured,
  respond: openAIResponse,
};

export function parseJsonObject<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (fenced ?? raw).trim();
  const start = source.indexOf('{');
  if (start < 0) throw new Error('The model response did not contain a JSON object.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1)) as T;
    }
  }
  throw new Error('The model response contained incomplete JSON.');
}
