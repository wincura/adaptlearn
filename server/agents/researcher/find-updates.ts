import crypto from 'node:crypto';
import { z } from 'zod';
import type { ResearchSuggestion } from '../../../shared/contracts.ts';
import { aiChat, parseJsonObject } from '../../ai/provider.ts';
import type { WorkspaceRepository } from '../../storage/workspace-repository.ts';
import { researcherAgent } from './agent.ts';

const suggestionsSchema = z.object({
  suggestions: z.array(z.object({
    title: z.string().min(1).max(180),
    summary: z.string().min(1).max(800),
    whyRelevant: z.string().min(1).max(500),
    sourceUrl: z.string().url().optional(),
  })).max(3),
});

export async function findResearchUpdates(store: WorkspaceRepository, learnerId: string, goalId: string) {
  const workspace = await store.get(learnerId);
  const goal = workspace.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error('Add a learning goal before asking the Researcher for updates.');
  const completedLessons = workspace.materials.filter((material) => material.goalId === goalId && material.kind === 'lesson');
  const coveredTopics = completedLessons.flatMap((material) => material.topics?.length
    ? material.topics
    : [material.title, ...material.sections.map((section) => section.title)]);
  const raw = await aiChat({
    workload: 'research',
    builtInTools: ['web_search'],
    temperature: 0.15,
    messages: [
      { role: 'system', content: researcherAgent.systemPrompt },
      { role: 'system', content: 'Use web search. Return only a JSON object with a suggestions array of at most 3 items. Each item: title, summary, whyRelevant, and one direct sourceUrl. Prefer official sources. If nothing materially useful is new, return an empty array.' },
      { role: 'user', content: `Find current, useful developments for this learning goal: ${JSON.stringify(goal)}. Existing suggestion titles: ${JSON.stringify(workspace.suggestions.map((item) => item.title))}. Completed lesson titles: ${JSON.stringify(completedLessons.map((item) => item.title))}. Topics already covered: ${JSON.stringify(coveredTopics)}. Do not suggest a topic already covered unless the development materially changes it; prefer a genuinely new extension.` },
    ],
  });
  const generated = suggestionsSchema.parse(parseJsonObject(raw));
  const suggestions: ResearchSuggestion[] = generated.suggestions.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    goalId,
    status: 'suggested',
    createdAt: new Date().toISOString(),
  }));
  await store.update(learnerId, (current) => {
    current.suggestions = [...current.suggestions.filter((item) => item.goalId !== goalId || item.status !== 'suggested'), ...suggestions];
  });
  return suggestions;
}
