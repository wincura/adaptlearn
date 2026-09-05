import crypto from 'node:crypto';
import { z } from 'zod';
import type { ResearchSuggestion } from '../../../shared/contracts.ts';
import { aiChat, aiProviderId, parseJsonObject } from '../../ai/provider.ts';
import type { WorkspaceRepository } from '../../storage/workspace-repository.ts';
import { researcherAgent } from './agent.ts';

const suggestionsSchema = z.object({
  suggestions: z.array(z.object({
    purpose: z.enum(['update', 'refresh', 'next-topic']).default('next-topic'),
    title: z.string().min(1).max(180),
    summary: z.string().min(1).max(800).optional(),
    whyRelevant: z.string().min(1).max(500).optional(),
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
  const completedAssessments = workspace.assessments
    .filter((assessment) => assessment.goalId === goalId && assessment.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''));
  const latestAssessment = completedAssessments[0];
  const existingSuggestionTitles = workspace.suggestions
    .filter((suggestion) => suggestion.goalId === goalId)
    .map((suggestion) => suggestion.title);
  const supportsWebSearch = aiProviderId() === 'openai';
  const raw = await aiChat({
    workload: 'research',
    ...(supportsWebSearch ? { builtInTools: ['web_search' as const] } : {}),
    temperature: 0.15,
    messages: [
      { role: 'system', content: researcherAgent.systemPrompt },
      { role: 'system', content: supportsWebSearch
        ? 'Use web search to ground every suggestion. Return only a JSON object with a suggestions array of at most 3 items. Each item must contain purpose (update, refresh, or next-topic), title, summary, whyRelevant, and one direct sourceUrl. Prefer official documentation, primary sources, respected dictionaries, language authorities, or established educational references. If no suggestion is genuinely useful for this learner, return an empty array.'
        : 'You do not have web access. Return only a JSON object with a suggestions array of at most 3 stable next-topic or refresh suggestions. Never describe a suggestion as current, researched, verified, or sourced, and omit sourceUrl.' },
      { role: 'user', content: `Find useful updates, refreshers, or next topics for this learner.

Active learning goal: ${JSON.stringify(goal)}
Learner background: ${JSON.stringify(workspace.profile.background || 'Not supplied')}
Learning preferences: ${JSON.stringify(workspace.profile.preferences || 'Not supplied')}
Latest test evidence: ${JSON.stringify(latestAssessment ? { score: latestAssessment.score, level: latestAssessment.level, strengths: latestAssessment.diagnostics?.strengths ?? [], focusAreas: latestAssessment.diagnostics?.focusAreas ?? [], dimensionScores: latestAssessment.diagnostics?.dimensionScores ?? [] } : 'No completed placement test')}
Completed lesson titles: ${JSON.stringify(completedLessons.map((item) => item.title))}
Topics already covered: ${JSON.stringify(coveredTopics)}
Previous suggestion titles for this goal: ${JSON.stringify(existingSuggestionTitles)}

First decide whether this is a fast-changing technical/software subject, a human language, or another relatively stable skill. Apply the matching domain rules from your instructions. Tailor every suggestion to the learner's exact requested focus and evidence. For a human-language goal, do not suggest news about Duolingo or another learning product, official language exams, certifications, or generic study resources unless the goal explicitly requests one. Suggest the actual language knowledge or communication skill to learn. Do not repeat a covered topic unless you label it refresh and the test evidence gives a concrete reason to reinforce it.` },
    ],
  });
  const generated = suggestionsSchema.parse(parseJsonObject(raw));
  const suggestions: ResearchSuggestion[] = generated.suggestions.map((item) => ({
    ...item,
    ...(supportsWebSearch ? {} : { sourceUrl: undefined }),
    summary: item.summary ?? `A focused ${item.purpose} step for ${goal.title}.`,
    whyRelevant: item.whyRelevant ?? 'It builds directly on this learning goal and the learner’s current evidence.',
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
