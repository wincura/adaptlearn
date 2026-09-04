export type AIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AIRequest = {
  messages: AIMessage[];
  workload?: 'default' | 'assessment' | 'research' | 'teacher';
  model?: string;
  jsonMode?: boolean;
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  builtInTools?: Array<'web_search' | 'code_interpreter'>;
  requireTool?: boolean;
  includeWebSources?: boolean;
  maxOutputTokens?: number;
  textVerbosity?: 'low' | 'medium' | 'high';
  temperature?: number;
};

export type AIWebSource = { title: string; url: string };
export type AIResult = { text: string; webSources: AIWebSource[] };

export interface AIProvider {
  readonly id: string;
  isConfigured(): Promise<boolean>;
  respond(request: AIRequest): Promise<AIResult>;
}

export class IncompleteAIResponseError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`The AI provider stopped before completing the response (${reason}).`);
    this.name = 'IncompleteAIResponseError';
    this.reason = reason;
  }
}
