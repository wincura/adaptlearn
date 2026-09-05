import crypto from 'node:crypto';
import { z } from 'zod';
import type { PlacementAssessment, PlacementDiagnostics, PlacementResult, PublicPlacementAssessment } from '../../../shared/contracts.ts';
import { aiResponse, IncompleteAIResponseError, parseJsonObject } from '../../ai/provider.ts';
import type { WorkspaceRepository } from '../../storage/workspace-repository.ts';
import { assessorAgent } from './agent.ts';

const placementSchema = z.object({
  questions: z.array(z.object({
    prompt: z.string().min(1).max(600),
    options: z.array(z.string().min(1).max(300)).length(4),
    correctIndex: z.number().int().min(0).max(3),
    dimension: z.string().min(2).max(80),
    difficulty: z.enum(['foundation', 'basic', 'applied', 'advanced']),
  })).length(12),
}).refine((value) => new Set(value.questions.map((question) => question.dimension.toLowerCase())).size >= 4, {
  message: 'Placement must assess at least four distinct competency areas.',
});

const placementJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array', minItems: 12, maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['prompt', 'options', 'correctIndex', 'dimension', 'difficulty'],
        properties: {
          prompt: { type: 'string', minLength: 1, maxLength: 600 },
          options: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 300 } },
          correctIndex: { type: 'integer', minimum: 0, maximum: 3 },
          dimension: { type: 'string', minLength: 2, maxLength: 80 },
          difficulty: { type: 'string', enum: ['foundation', 'basic', 'applied', 'advanced'] },
        },
      },
    },
  },
};

export const publicAssessment = (assessment: PlacementAssessment): PublicPlacementAssessment => ({
  ...assessment,
  questions: assessment.questions.map(({ id, prompt, options, dimension, difficulty }) => ({ id, prompt, options, dimension, difficulty })),
});

export async function createPlacement(store: WorkspaceRepository, learnerId: string, goalId: string) {
  const workspace = await store.get(learnerId);
  const goal = workspace.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error('Add a learning goal before starting a placement test.');
  const completedAttempts = workspace.assessments.filter((assessment) => assessment.goalId === goalId && assessment.completedAt);
  const testType = completedAttempts.length === 0 ? 'placement' : 'assessment';
  const attemptNumber = completedAttempts.length + 1;
  const existing = workspace.assessments.find((assessment) => assessment.goalId === goalId && !assessment.completedAt);
  if (existing && existing.questions.length >= 10) return publicAssessment({
    ...existing,
    testType,
    attemptNumber,
    title: testType === 'placement' ? `${goal.title} placement test` : `${goal.title} assessment test`,
  });
  let generated: z.infer<typeof placementSchema> | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await aiResponse({
        workload: 'assessment',
        jsonSchema: { name: 'diagnostic_placement', schema: placementJsonSchema },
        maxOutputTokens: 8_000,
        textVerbosity: 'low',
        temperature: 0.1,
        messages: [
          { role: 'system', content: assessorAgent.systemPrompt },
          { role: 'system', content: `Return the required structured ${testType === 'placement' ? 'placement test' : 'assessment test'}. Create exactly 12 multiple-choice questions with exactly four plausible options and one zero-based correctIndex each. Cover at least four clearly named competency dimensions. Distribute questions across foundation, basic, applied, and advanced difficulty so the result reveals both familiar and unfamiliar areas. Test understanding and application, not trivia. Do not reveal answers in prompts or option wording.${testType === 'assessment' ? ' This is a subsequent assessment: re-evaluate current mastery, include the learner’s earlier focus areas, and use fresh questions rather than repeating the prior test.' : ' This is the learner’s first test for this goal and should establish a starting level.'}${attempt ? ' This is a retry: keep wording concise and complete every required field.' : ''}` },
          { role: 'user', content: `Create a granular ${testType === 'placement' ? 'placement test' : 'assessment test'} for this goal: ${JSON.stringify(goal)}. The learner's requested focus is: ${JSON.stringify(goal.motivation || 'not narrowed yet')}. Learner-reported background: ${JSON.stringify(workspace.profile.background || 'not supplied')}. Learning preference: ${JSON.stringify(workspace.profile.preferences || 'not supplied')}.${testType === 'assessment' ? ` Previous completed test evidence: ${JSON.stringify(completedAttempts.map(({ score, level, diagnostics, completedAt }) => ({ score, level, diagnostics, completedAt })))}` : ''}` },
        ],
      });
      generated = placementSchema.parse(parseJsonObject(response.text));
      break;
    } catch (error) {
      lastError = error;
      if (attempt === 1 || !(error instanceof IncompleteAIResponseError || error instanceof z.ZodError || (error instanceof Error && /JSON/i.test(error.message)))) throw error;
    }
  }
  if (!generated) throw new Error(`The ${testType} test could not be completed: ${lastError instanceof Error ? lastError.message : 'unknown error'}`);
  const assessment: PlacementAssessment = {
    id: crypto.randomUUID(),
    goalId,
    testType,
    attemptNumber,
    title: testType === 'placement' ? `${goal.title} placement test` : `${goal.title} assessment test`,
    questions: generated.questions.map((question) => ({ ...question, id: crypto.randomUUID() })),
    createdAt: new Date().toISOString(),
  };
  await store.update(learnerId, (current) => {
    current.assessments = current.assessments.filter((item) => item.completedAt || item.goalId !== goalId);
    current.assessments.push(assessment);
  });
  return publicAssessment(assessment);
}

export async function submitPlacement(store: WorkspaceRepository, learnerId: string, assessmentId: string, answers: number[]) {
  let result!: PlacementResult;
  const workspace = await store.update(learnerId, (current) => {
    const assessment = current.assessments.find((item) => item.id === assessmentId);
    if (!assessment) throw new Error('Test not found.');
    if (assessment.completedAt) throw new Error('This test was already submitted. Start a new assessment test instead.');
    if (answers.length !== assessment.questions.length) throw new Error('Answer every question before submitting.');
    const correct = assessment.questions.reduce((total, question, index) => total + (question.correctIndex === answers[index] ? 1 : 0), 0);
    const score = Math.round((correct / assessment.questions.length) * 100);
    const level = score <= 20 ? 'Absolute beginner' : score <= 45 ? 'Beginner' : score <= 75 ? 'Intermediate' : 'Professional';
    const xpAwarded = 40 + correct * 10;
    const badgeAwarded = current.progress.completedAssessments === 0 ? 'First placement' : undefined;
    const dimensions = new Map<string, { correct: number; total: number }>();
    assessment.questions.forEach((question, index) => {
      const dimension = question.dimension?.trim() || 'General foundations';
      const currentDimension = dimensions.get(dimension) ?? { correct: 0, total: 0 };
      currentDimension.total += 1;
      if (question.correctIndex === answers[index]) currentDimension.correct += 1;
      dimensions.set(dimension, currentDimension);
    });
    const dimensionScores = [...dimensions.entries()].map(([dimension, evidence]) => ({
      dimension,
      ...evidence,
      percentage: Math.round((evidence.correct / evidence.total) * 100),
    }));
    const diagnostics: PlacementDiagnostics = {
      strengths: dimensionScores.filter((item) => item.percentage >= 67).map((item) => item.dimension),
      focusAreas: dimensionScores.filter((item) => item.percentage < 67).map((item) => item.dimension),
      dimensionScores,
    };
    assessment.submittedAnswers = answers;
    assessment.score = score;
    assessment.level = level;
    assessment.diagnostics = diagnostics;
    assessment.completedAt = new Date().toISOString();
    current.progress.level = level;
    current.progress.xp += xpAwarded;
    current.progress.completedAssessments += 1;
    if (badgeAwarded) current.progress.badges.push(badgeAwarded);
    result = { score, level, xpAwarded, badgeAwarded, diagnostics };
  });
  return { ...result, workspace };
}
