import type { AIProvider, AIRequest, AIResult } from './contracts.ts';
import { openAIProvider, parseJsonObject } from './openai-client.ts';
import { bedrockProvider } from './bedrock-provider.ts';

const providers: Record<string, AIProvider> = { openai: openAIProvider, bedrock: bedrockProvider };

export function activeAIProvider(): AIProvider {
  const id = (process.env.AI_PROVIDER ?? 'openai').toLowerCase();
  const provider = providers[id];
  if (!provider) {
    throw new Error(`AI provider “${id}” is not installed. Add an adapter implementing AIProvider and register it in server/ai/provider.ts.`);
  }
  return provider;
}

export const aiResponse = (request: AIRequest): Promise<AIResult> => activeAIProvider().respond(request);
export const aiChat = async (request: AIRequest): Promise<string> => (await aiResponse(request)).text;
export const aiIsConfigured = () => activeAIProvider().isConfigured();
export const aiProviderId = () => activeAIProvider().id;

export { IncompleteAIResponseError } from './contracts.ts';
export type { AIProvider, AIRequest, AIResult, AIWebSource } from './contracts.ts';
export { parseJsonObject };
