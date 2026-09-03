import crypto from 'node:crypto';
import { z } from 'zod';
import type { PlacementAssessment, PublicPlacementAssessment } from '../../../shared/contracts.ts';
import { openAIChat, parseJsonObject } from '../../ai/openai-client.ts';
import type { WorkspaceStore } from '../../memory/workspace-store.ts';
import { assessorAgent } from './agent.ts';

const placementSchema = z.object({
  title: z.string().min(1).max(140),
  questions: z.array(z.object({
    prompt: z.string().min(1).max(600),
    options: z.array(z.string().min(1).max(300)).length(4),
    correctIndex: z.number().int().min(0).max(3),
  })).length(4),
});

export const publicAssessment = (assessment: PlacementAssessment): PublicPlacementAssessment => ({
  ...assessment,
  questions: assessment.questions.map(({ id, prompt, options }) => ({ id, prompt, options })),
});

export async function createPlacement(store: WorkspaceStore, learnerId: string, goalId: string) {
  const workspace = await store.get(learnerId);
  const goal = workspace.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error('Add a learning goal before starting placement.');
  const existing = workspace.assessments.find((assessment) => assessment.goalId === goalId && !assessment.completedAt);
  if (existing) return publicAssessment(existing);
  const raw = await openAIChat({
    jsonMode: true,
    temperature: 0.15,
    messages: [
      { role: 'system', content: assessorAgent.systemPrompt },
      { role: 'system', content: 'Return only valid JSON with title and exactly four multiple-choice questions. Each question has prompt, exactly four options, and zero-based correctIndex. Start gently and increase difficulty. Do not reveal answers in prompts or options.' },
      { role: 'user', content: `Create a short placement check for this goal: ${JSON.stringify(goal)}. Learner-reported background: ${JSON.stringify(workspace.profile.background || 'not supplied')}.` },
    ],
  });
  const generated = placementSchema.parse(parseJsonObject(raw));
  const assessment: PlacementAssessment = {
    id: crypto.randomUUID(),
    goalId,
    title: generated.title,
    questions: generated.questions.map((question) => ({ ...question, id: crypto.randomUUID() })),
    createdAt: new Date().toISOString(),
  };
  await store.update(learnerId, (current) => { current.assessments.push(assessment); });
  return publicAssessment(assessment);
}

export async function submitPlacement(store: WorkspaceStore, learnerId: string, assessmentId: string, answers: number[]) {
  let result!: { score: number; level: string; xpAwarded: number; badgeAwarded?: string };
  const workspace = await store.update(learnerId, (current) => {
    const assessment = current.assessments.find((item) => item.id === assessmentId);
    if (!assessment) throw new Error('Placement assessment not found.');
    if (assessment.completedAt) throw new Error('This placement assessment was already submitted.');
    if (answers.length !== assessment.questions.length) throw new Error('Answer every question before submitting.');
    const correct = assessment.questions.reduce((total, question, index) => total + (question.correctIndex === answers[index] ? 1 : 0), 0);
    const score = Math.round((correct / assessment.questions.length) * 100);
    const level = score <= 25 ? 'Absolute beginner' : score <= 50 ? 'Beginner' : score <= 75 ? 'Intermediate' : 'Professional';
    const xpAwarded = 40 + correct * 10;
    const badgeAwarded = current.progress.completedAssessments === 0 ? 'First placement' : undefined;
    assessment.submittedAnswers = answers;
    assessment.score = score;
    assessment.level = level;
    assessment.completedAt = new Date().toISOString();
    current.progress.level = level;
    current.progress.xp += xpAwarded;
    current.progress.completedAssessments += 1;
    if (badgeAwarded) current.progress.badges.push(badgeAwarded);
    result = { score, level, xpAwarded, badgeAwarded };
  });
  return { ...result, workspace };
}
