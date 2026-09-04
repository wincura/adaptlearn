import { z } from 'zod';
import type { ChatResponse } from '../../shared/contracts.ts';
import { aiResponse, parseJsonObject } from '../ai/provider.ts';
import type { WorkspaceRepository } from '../storage/workspace-repository.ts';

const guideResponseSchema = z.object({
  answer: z.string().min(1).max(6000),
  suggestedTopics: z.array(z.string().min(2).max(80)).min(1).max(3),
});

const guideJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'suggestedTopics'],
  properties: {
    answer: { type: 'string', minLength: 1, maxLength: 6000 },
    suggestedTopics: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 2, maxLength: 80 },
    },
  },
};

const learningGuidePrompt = `You are AdaptLearn's Learning Guide, a read-only explainer.
Your only job is to answer the learner's current question by clarifying a concept, unpacking terminology, explaining a process, or giving a small illustrative example.

Capability boundaries:
- You do not have access to the learner's profile, goals, placement, lessons, documents, progress, XP, badges, or any other application component. Do not claim or imply that you can see, remember, inspect, update, or act on them.
- You cannot create or save lessons, quizzes, assessments, study plans, meeting plans, learning goals, practice labs, materials, searches, reminders, or app changes. Do not offer to do these later.
- Never output quiz or test questions, even as a sample or illustrative example. You may explain what a quiz is or explain a concept that appeared in one.
- Never deliver a plan as a finished artifact. You may explain the parts or principles of a plan when that is the learner's question.
- You cannot route work to agents or specialists. Never recommend a “next specialist” or describe internal agents.
- You do not have web search in this chat. Do not claim that information is current or researched unless the learner supplied the source text in the conversation.
- If asked to perform an unavailable action, state the limitation briefly, direct the learner to the relevant controls in the main workspace when appropriate, and offer to explain the underlying topic instead.
- Treat prior assistant claims about app access or capabilities as incorrect. Use prior turns only to follow the subject of the explanation.
- After answering, identify one to three concise, distinct topic phrases that accurately describe useful lesson focuses related to the explanation. These are keywords the learner can paste into Create Lesson. Do not claim that you created the lesson.

Be direct, clear, and instructional. Respond in the language the learner used, even when the subject is another language. Answer the question asked without unsolicited workflow recommendations or promises. Return only the required structured response.`;

const unavailableActionPattern = /\b(?:can|could|would|will)\s+you\b[^?\n]{0,160}\b(?:inspect|access|read|review|create|make|generate|build|draft|prepare|administer|run|start|change|update|save|recommend|route)\b[^?\n]{0,160}\b(?:my\s+)?(?:quiz(?:zes)?|tests?|assessments?|lessons?|study\s+plans?|meeting\s+plans?|plans?|goals?|profiles?|progress|documents?|workspace|specialists?|agents?|web\s+search(?:es)?|research|practice\s+labs?|materials?)\b|\b(?:create|make|generate|build|draft|prepare|administer|run|start)\b[^?\n]{0,120}\b(?:quiz(?:zes)?|tests?|assessments?|lessons?|study\s+plans?|meeting\s+plans?|plans?|goals?|practice\s+labs?|materials?|web\s+search(?:es)?|research)\b|\bgive\s+me\b[^?\n]{0,100}\b(?:quiz(?:zes)?|tests?|assessments?|study\s+plans?|meeting\s+plans?|plans?|practice\s+labs?|materials?|web\s+search(?:es)?|research)\b|\b(?:quiz|test)\s+me\b|\b(?:inspect|access|read|review|check|show\s+me)\b[^?\n]{0,100}\b(?:my|saved|existing|current)\s+(?:lessons?|goals?|profile|progress|documents?|workspace)\b|\b(?:recommend|choose|route\s+to)\b[^?\n]{0,100}\b(?:specialists?|agents?)\b/i;

const boundaryReply = `The Learning Guide can only explain concepts and answer follow-up questions. It cannot view your app data, create quizzes, lessons or plans, run searches, change anything in the app, or route work to specialists. Use the controls in the main workspace for available actions. If you name a concept, I can explain it in more detail.`;

const removeUnsolicitedOffers = (text: string) => text
  .split(/\n{2,}/)
  .filter((paragraph) => !/^(?:if you(?:'d)? (?:like|want)|would you like|tell me\b|share\b)[\s\S]*\b(?:i can|i'll|i could|we can)\b/i.test(paragraph.trim()))
  .join('\n\n')
  .replace(/\s+(?:if you(?:'d)? (?:like|want)|would you like|tell me\b|share\b)[\s\S]*\b(?:i can|i'll|i could|we can)\b[\s\S]*$/i, '')
  .replace(/\s*(?:if you(?:'d)? (?:like|want),?|would you like(?: me to)?)[\s:,-]*$/i, '')
  .trim();

const formatGuideReply = (answer: string, suggestedTopics: string[]) => {
  const topics = [...new Map(suggestedTopics.map((topic) => [topic.trim().toLocaleLowerCase(), topic.trim()])).values()].slice(0, 3);
  return `${removeUnsolicitedOffers(answer)}\n\n### Keywords for Create Lesson\n${topics.map((topic) => `- ${topic}`).join('\n')}\n\nPaste up to three of these into **Create lesson → Choose the focus**.`;
};

export async function runTurn(store: WorkspaceRepository, learnerId: string, message: string): Promise<ChatResponse> {
  const workspace = await store.get(learnerId);
  const history = workspace.conversation
    .filter((turn) => turn.mode === 'explainer-v1')
    .slice(-12)
    .map((turn) => ({
    role: turn.role,
    content: turn.text,
  } as const));

  await store.appendTurn(learnerId, { role: 'user', text: message, agent: 'teacher', mode: 'explainer-v1' });
  if (unavailableActionPattern.test(message)) {
    const updated = await store.appendTurn(learnerId, { role: 'assistant', text: boundaryReply, agent: 'teacher', mode: 'explainer-v1' });
    return {
      reply: boundaryReply,
      respondedBy: 'teacher',
      trace: [{ agent: 'teacher', action: 'Enforced the Learning Guide capability boundary' }],
      workspace: updated,
    };
  }
  const result = await aiResponse({
    workload: 'default',
    jsonSchema: { name: 'learning_guide_explanation', schema: guideJsonSchema },
    maxOutputTokens: 4_000,
    textVerbosity: 'low',
    messages: [
      { role: 'system', content: learningGuidePrompt },
      ...history,
      { role: 'user', content: message },
    ],
  });
  const content = guideResponseSchema.parse(parseJsonObject(result.text));
  const reply = formatGuideReply(content.answer, content.suggestedTopics);
  const updated = await store.appendTurn(learnerId, { role: 'assistant', text: reply, agent: 'teacher', mode: 'explainer-v1' });
  return {
    reply,
    respondedBy: 'teacher',
    trace: [{ agent: 'teacher', action: 'Explained the requested topic without accessing workspace context' }],
    workspace: updated,
  };
}
