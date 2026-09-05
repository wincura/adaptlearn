import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { IncompleteAIResponseError, type AIProvider, type AIRequest, type AIResult } from './contracts.ts';

const defaultModel = 'amazon.nova-2-lite-v1:0';
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

const configuredModel = () => process.env.BEDROCK_MODEL_ID ?? defaultModel;

export async function bedrockResponse(request: AIRequest): Promise<AIResult> {
  if (request.builtInTools?.length) {
    throw new Error('BedrockProvider does not provide OpenAI built-in tools. Configure an auditable web-search integration before enabling research requests.');
  }

  const schemaInstruction = request.jsonSchema
    ? `Return only one JSON object matching this schema: ${JSON.stringify(request.jsonSchema.schema)}`
    : request.jsonMode
      ? 'Return only one valid JSON object.'
      : undefined;
  const system = [
    ...request.messages.filter((message) => message.role === 'system').map((message) => message.content),
    ...(schemaInstruction ? [schemaInstruction] : []),
  ].map((text) => ({ text }));
  const messages = request.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: [{ text: message.content }],
    }));

  const response = await client.send(new ConverseCommand({
    modelId: request.model ?? configuredModel(),
    ...(system.length ? { system } : {}),
    messages,
    inferenceConfig: {
      ...(request.maxOutputTokens ? { maxTokens: request.maxOutputTokens } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    },
  }), { abortSignal: AbortSignal.timeout(60_000) });

  if (response.stopReason === 'max_tokens') throw new IncompleteAIResponseError('max_output_tokens');
  const text = response.output?.message?.content
    ?.flatMap((block) => block.text ? [block.text] : [])
    .join('\n')
    .trim();
  if (!text) throw new Error('Bedrock returned an empty response.');
  return { text, webSources: [] };
}

export const bedrockProvider: AIProvider = {
  id: 'bedrock',
  isConfigured: async () => Boolean(configuredModel()),
  respond: bedrockResponse,
};
