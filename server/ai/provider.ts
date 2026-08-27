import type { ChatRequest } from '../types.ts';

const coordinatorPrompt = (request: ChatRequest) => `You are AdaptLearn's Coordinator agent. Your goal is to help the learner upskill safely and effectively.
The learner is studying ${request.profile.topic}, identifies as ${request.profile.level}, prefers ${request.profile.style}, and has ${request.profile.xp} XP.
Route this turn through the Teacher behavior: be accurate, encouraging without being patronizing, concise, and adaptive. Ask only one useful follow-up at a time.
In Teacher mode, explain and guide practice. In Conversation mode, use dialogue and gentle correction.
Use established documentation as the source of truth. If uncertain, say so. Keep suggestions within the learner's goal and flag tangents. Do not facilitate harmful or unethical activity.`;

const localReply = (request: ChatRequest) => {
  const topic = request.profile.topic || 'your current topic';
  return request.mode === 'Conversation'
    ? `Let’s reason about that together in the context of ${topic}. What is your current best guess?`
    : `Here’s the practical version for ${topic}: start with one small example, predict what it will do, then test it. Which step feels least clear?`;
};

export async function generateReply(request: ChatRequest): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
  if (provider === 'mock') return localReply(request);

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini',
        temperature: 0.35,
        messages: [
          { role: 'system', content: coordinatorPrompt(request) },
          { role: 'user', content: request.message },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? localReply(request);
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
        max_tokens: 700,
        temperature: 0.35,
        system: coordinatorPrompt(request),
        messages: [{ role: 'user', content: request.message }],
      }),
    });
    if (!response.ok) throw new Error(`Anthropic request failed (${response.status})`);
    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    return data.content?.find((item) => item.type === 'text')?.text ?? localReply(request);
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}
