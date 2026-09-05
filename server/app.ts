import crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { LearningWorkspace } from '../shared/contracts.ts';
import { agents } from './agents/catalog.ts';
import { createPlacement, publicAssessment, submitPlacement } from './agents/assessor/placement.ts';
import { createBuilderLab } from './agents/builder/create-lab.ts';
import { findResearchUpdates } from './agents/researcher/find-updates.ts';
import { createTeacherMaterial } from './agents/teacher/create-material.ts';
import { aiIsConfigured, aiProviderId } from './ai/provider.ts';
import type { KnowledgeRepository } from './knowledge/contracts.ts';
import { runTurn } from './orchestration/run-turn.ts';
import { createKnowledgeRepository, createSandboxExecutor, createWorkspaceRepository } from './runtime/providers.ts';
import { evaluateCodeSubmission, generateCodingChallenge, runChallengeTestCases } from './sandbox/code-evaluator.ts';
import type { SandboxExecutor } from './sandbox/contracts.ts';
import { detectCodeTopic } from './sandbox/topic-detector.ts';
import type { WorkspaceRepository } from './storage/workspace-repository.ts';

export type AppDependencies = {
  workspaceRepository?: WorkspaceRepository;
  knowledgeRepository?: KnowledgeRepository;
  sandboxExecutor?: SandboxExecutor;
};

const learnerIdSchema = z.string().trim().min(1).max(100);
const chatSchema = z.object({ learnerId: learnerIdSchema, message: z.string().trim().min(1).max(8000) });
const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  background: z.string().trim().max(1500).default(''),
  preferences: z.string().trim().max(1000).default(''),
});
const goalSchema = z.object({
  title: z.string().trim().min(2).max(160),
  courseTemplateId: z.string().trim().min(1).max(100).optional(),
  motivation: z.string().trim().max(1000).default(''),
  targetOutcome: z.string().trim().max(1000).default(''),
  background: z.string().trim().max(1500).default(''),
  preferences: z.string().trim().max(1000).default(''),
});
const goalDetailsSchema = goalSchema.pick({ title: true, motivation: true, targetOutcome: true });

const publicWorkspace = (workspace: LearningWorkspace): LearningWorkspace => ({
  ...workspace,
  assessments: workspace.assessments.map((assessment) => publicAssessment(assessment) as typeof assessment),
});

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const store = dependencies.workspaceRepository ?? createWorkspaceRepository();
  const knowledge = dependencies.knowledgeRepository ?? createKnowledgeRepository();
  const sandbox = dependencies.sandboxExecutor ?? createSandboxExecutor();
  const upload = multer({
    dest: process.env.UPLOAD_DIRECTORY ?? path.resolve(process.cwd(), 'data', 'uploads'),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_request, response) => response.json({
    status: 'ok',
    storage: store.backend,
    knowledge: knowledge.backend,
    sandbox: sandbox.id,
    ai: aiProviderId(),
    aiConfigured: await aiIsConfigured(),
  }));

  app.get('/api/agents', (_request, response) => response.json(Object.values(agents).map(({ id, name, owns, doesNotOwn }) => ({ id, name, owns, doesNotOwn }))));

  app.get('/api/profiles', async (_request, response) => response.json(await store.list()));

  app.post('/api/profiles', async (request, response) => {
    const profile = profileSchema.parse(request.body);
    const learnerId = crypto.randomUUID();
    const workspace = await store.update(learnerId, (current) => { current.profile = profile; });
    response.status(201).json(publicWorkspace(workspace));
  });

  app.delete('/api/profiles/:learnerId', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const exists = (await store.list()).some((profile) => profile.learnerId === learnerId);
    if (!exists) return response.status(404).json({ error: 'Learner profile not found.' });
    const workspace = await store.get(learnerId);
    await knowledge.remove(workspace.documents);
    await store.delete(learnerId);
    return response.json({ profiles: await store.list() });
  });

  app.get('/api/workspace/:learnerId', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    response.json(publicWorkspace(await store.get(learnerId)));
  });

  app.put('/api/workspace/:learnerId/profile', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const profile = profileSchema.parse(request.body);
    const workspace = await store.update(learnerId, (current) => { current.profile = profile; });
    response.json(publicWorkspace(workspace));
  });

  app.post('/api/workspace/:learnerId/goals', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const input = goalSchema.parse(request.body);
    const workspace = await store.update(learnerId, (current) => {
      current.profile.background = input.background;
      current.profile.preferences = input.preferences;
      current.goals.forEach((goal) => { if (goal.status === 'active') goal.status = 'paused'; });
      current.goals.push({
        id: crypto.randomUUID(), courseTemplateId: input.courseTemplateId, title: input.title, motivation: input.motivation, targetOutcome: input.targetOutcome,
        status: 'active', createdAt: new Date().toISOString(),
      });
    });
    response.status(201).json(publicWorkspace(workspace));
  });

  app.put('/api/workspace/:learnerId/goals/:goalId/activate', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const goalId = z.string().uuid().parse(request.params.goalId);
    const workspace = await store.update(learnerId, (current) => {
      const selected = current.goals.find((goal) => goal.id === goalId);
      if (!selected) throw new Error('Learning goal not found.');
      current.goals.forEach((goal) => { goal.status = goal.id === goalId ? 'active' : goal.status === 'active' ? 'paused' : goal.status; });
    });
    response.json(publicWorkspace(workspace));
  });

  app.put('/api/workspace/:learnerId/goals/:goalId', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const goalId = z.string().uuid().parse(request.params.goalId);
    const input = goalDetailsSchema.parse(request.body);
    const workspace = await store.update(learnerId, (current) => {
      const goal = current.goals.find((item) => item.id === goalId);
      if (!goal) throw new Error('Learning goal not found.');
      goal.title = input.title;
      goal.motivation = input.motivation;
      goal.targetOutcome = input.targetOutcome;
    });
    response.json(publicWorkspace(workspace));
  });

  app.delete('/api/workspace/:learnerId/goals/:goalId', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const goalId = z.string().uuid().parse(request.params.goalId);
    const beforeDelete = await store.get(learnerId);
    const goalDocuments = beforeDelete.documents.filter((document) => document.scope?.visibility === 'goal' && document.scope.goalId === goalId);
    await knowledge.remove(goalDocuments);
    const workspace = await store.update(learnerId, (current) => {
      const goal = current.goals.find((item) => item.id === goalId);
      if (!goal) throw new Error('Learning goal not found.');
      current.goals = current.goals.filter((item) => item.id !== goalId);
      current.materials = current.materials.filter((item) => item.goalId !== goalId);
      current.suggestions = current.suggestions.filter((item) => item.goalId !== goalId);
      current.assessments = current.assessments.filter((item) => item.goalId !== goalId);
      current.documents = current.documents.filter((item) => !goalDocuments.some((document) => document.id === item.id));
      if (goal.status === 'active') {
        const nextGoal = current.goals.find((item) => item.status === 'paused') ?? current.goals[0];
        if (nextGoal) nextGoal.status = 'active';
      }
    });
    response.json(publicWorkspace(workspace));
  });

  app.post('/api/chat', async (request, response) => {
    const input = chatSchema.parse(request.body);
    const result = await runTurn(store, input.learnerId, input.message);
    response.json({ ...result, workspace: publicWorkspace(result.workspace) });
  });

  app.delete('/api/workspace/:learnerId/conversation', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const workspace = await store.update(learnerId, (current) => { current.conversation = []; });
    response.json(publicWorkspace(workspace));
  });

  app.post('/api/materials/generate', async (request, response) => {
    const input = z.object({
      learnerId: learnerIdSchema,
      goalId: z.string().uuid(),
      owner: z.enum(['teacher', 'builder']),
      kind: z.enum(['lesson', 'practice-lab']).optional(),
      topics: z.array(z.string().trim().min(2).max(120)).max(3).optional(),
    }).refine(({ topics }) => !topics || new Set(topics.map((topic) => topic.toLocaleLowerCase())).size === topics.length, {
      message: 'Lesson ideas must be distinct.',
      path: ['topics'],
    }).parse(request.body);
    const requestedFocus = input.topics?.length
      ? `Cover these learner-selected ideas in one coherent lesson: ${input.topics.join('; ')}.`
      : undefined;
    const material = input.owner === 'builder'
      ? await createBuilderLab(store, input.learnerId, input.goalId)
      : await createTeacherMaterial(store, input.learnerId, input.goalId, requestedFocus, knowledge);
    response.status(201).json({ material, workspace: publicWorkspace(await store.get(input.learnerId)) });
  });

  app.post('/api/assessments/placement', async (request, response) => {
    const input = z.object({ learnerId: learnerIdSchema, goalId: z.string().uuid() }).parse(request.body);
    response.status(201).json(await createPlacement(store, input.learnerId, input.goalId));
  });

  app.post('/api/assessments/:assessmentId/submit', async (request, response) => {
    const input = z.object({ learnerId: learnerIdSchema, answers: z.array(z.number().int().min(0).max(3)).min(1).max(20) }).parse(request.body);
    const result = await submitPlacement(store, input.learnerId, z.string().uuid().parse(request.params.assessmentId), input.answers);
    response.json({ ...result, workspace: publicWorkspace(result.workspace) });
  });

  app.post('/api/research/suggestions', async (request, response) => {
    const input = z.object({ learnerId: learnerIdSchema, goalId: z.string().uuid() }).parse(request.body);
    const suggestions = await findResearchUpdates(store, input.learnerId, input.goalId);
    response.status(201).json({ suggestions, workspace: publicWorkspace(await store.get(input.learnerId)) });
  });

  app.post('/api/research/suggestions/:suggestionId/accept', async (request, response) => {
    const input = z.object({ learnerId: learnerIdSchema }).parse(request.body);
    const suggestionId = z.string().uuid().parse(request.params.suggestionId);
    const workspace = await store.get(input.learnerId);
    const suggestion = workspace.suggestions.find((item) => item.id === suggestionId);
    if (!suggestion) throw new Error('Research suggestion not found.');
    const brief = `Turn this approved suggestion into a scoped optional lesson: ${suggestion.title}. ${suggestion.summary}. Source: ${suggestion.sourceUrl ?? 'No source URL supplied.'}`;
    const material = await createTeacherMaterial(store, input.learnerId, suggestion.goalId, brief, knowledge);
    await store.update(input.learnerId, (current) => {
      const accepted = current.suggestions.find((item) => item.id === suggestionId);
      if (accepted) accepted.status = 'accepted';
    });
    response.status(201).json({ material, workspace: publicWorkspace(await store.get(input.learnerId)) });
  });

  app.post('/api/documents', upload.single('document'), async (request, response) => {
    if (!request.file) return response.status(400).json({ error: 'No document supplied' });
    try {
      const learnerId = learnerIdSchema.parse(request.body.learnerId);
      const workspaceBeforeUpload = await store.get(learnerId);
      const activeGoal = workspaceBeforeUpload.goals.find((goal) => goal.status === 'active');
      const document = await knowledge.ingest(request.file, {
        learnerId,
        goalId: activeGoal?.id,
        visibility: 'learner',
      });
      const workspace = await store.update(learnerId, (current) => { current.documents.push(document); });
      return response.status(201).json({ document, workspace: publicWorkspace(workspace) });
    } catch (error) {
      await unlink(request.file.path).catch(() => undefined);
      const message = error instanceof Error ? error.message : 'The document could not be read.';
      return response.status(400).json({ error: message });
    }
  });

  app.delete('/api/workspace/:learnerId/documents/:documentId', async (request, response) => {
    const learnerId = learnerIdSchema.parse(request.params.learnerId);
    const documentId = z.string().trim().min(1).max(200).parse(request.params.documentId);
    const workspace = await store.get(learnerId);
    const document = workspace.documents.find((item) => item.id === documentId);
    if (!document) return response.status(404).json({ error: 'Uploaded document not found.' });
    await knowledge.remove([document]);
    const updated = await store.update(learnerId, (current) => {
      current.documents = current.documents.filter((item) => item.id !== documentId);
    });
    return response.json(publicWorkspace(updated));
  });

  app.post('/api/sandbox/run', async (request, response) => {
    const input = z.object({
      language: z.enum(['python', 'javascript', 'typescript', 'sql', 'cpp', 'java']),
      code: z.string().max(30000),
      harness: z.string().max(20000).optional(),
    }).parse(request.body);

    const result = await sandbox.execute({
      language: input.language,
      code: input.code,
      harness: input.harness,
    });
    response.json(result);
  });

  const challengePayloadSchema = z.object({
    id: z.string(),
    language: z.enum(['python', 'javascript', 'typescript', 'sql', 'cpp', 'java']),
    title: z.string(),
    prompt: z.string(),
    starterCode: z.string(),
    testHarness: z.string(),
    publicTestHarness: z.string().optional(),
    privateTestHarness: z.string().optional(),
    testCases: z.array(z.object({
      id: z.string(),
      description: z.string(),
      input: z.string().optional(),
      expectedOutput: z.string().optional(),
      assertion: z.string().optional(),
      isHidden: z.boolean().optional(),
    })).optional(),
    hints: z.array(z.string()).optional(),
  });

  app.post('/api/sandbox/run-tests', async (request, response) => {
    const input = z.object({
      challenge: challengePayloadSchema,
      studentCode: z.string().max(30000),
    }).parse(request.body);

    const execution = await runChallengeTestCases(input.challenge, input.studentCode, 'run', sandbox);
    response.json({ execution });
  });

  app.post('/api/sandbox/evaluate', async (request, response) => {
    const input = z.object({
      learnerId: learnerIdSchema.optional(),
      goalId: z.string().uuid().optional(),
      challenge: challengePayloadSchema,
      studentCode: z.string().max(30000),
    }).parse(request.body);

    const evaluation = await evaluateCodeSubmission(input.challenge, input.studentCode, sandbox);
    let updatedWorkspace: LearningWorkspace | undefined;

    if (input.learnerId && evaluation.passed && evaluation.xpAwarded) {
      updatedWorkspace = await store.update(input.learnerId, (current) => {
        current.progress.xp += evaluation.xpAwarded ?? 25;
      });
    }

    response.json({
      evaluation,
      workspace: updatedWorkspace ? publicWorkspace(updatedWorkspace) : undefined,
    });
  });

  app.post('/api/materials/:materialId/coding-challenge', async (request, response) => {
    const input = z.object({
      learnerId: learnerIdSchema,
      forceNew: z.boolean().optional(),
    }).parse(request.body);
    const materialId = z.string().uuid().parse(request.params.materialId);
    const workspace = await store.get(input.learnerId);
    const material = workspace.materials.find((item) => item.id === materialId);
    if (!material) return response.status(404).json({ error: 'Material not found.' });

    const goal = workspace.goals.find((g) => g.id === material.goalId);
    if (!goal) return response.status(404).json({ error: 'Goal not found.' });

    if (material.codingChallenge && !input.forceNew) {
      return response.json({ challenge: material.codingChallenge });
    }

    const detected = detectCodeTopic(material.title, goal.title, goal.motivation);
    if (!detected.isCodeTopic || !detected.language) {
      return response.status(400).json({ error: 'This topic does not require code execution.' });
    }

    const previousTitles: string[] = [];
    if (material.codingChallenge?.title) {
      previousTitles.push(material.codingChallenge.title);
    }
    if (material.codingChallenges) {
      for (const c of material.codingChallenges) {
        if (c.title && !previousTitles.includes(c.title)) {
          previousTitles.push(c.title);
        }
      }
    }

    const challenge = await generateCodingChallenge(
      goal,
      material.title,
      material.topics?.[0] ?? material.title,
      detected.language,
      material.assessedLevel ?? 'Beginner',
      { previousTitles },
    );

    const updated = await store.update(input.learnerId, (current) => {
      const item = current.materials.find((m) => m.id === materialId);
      if (item) {
        if (!item.codingChallenges) {
          item.codingChallenges = item.codingChallenge ? [item.codingChallenge] : [];
        }
        if (item.codingChallenge && !item.codingChallenges.some((c) => c.id === item.codingChallenge?.id)) {
          item.codingChallenges.push(item.codingChallenge);
        }
        item.codingChallenge = challenge;
        item.codingChallenges.push(challenge);
        item.isCodeTopic = true;
      }
    });

    response.status(201).json({ challenge, workspace: publicWorkspace(updated) });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next;
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const status = error instanceof z.ZodError ? 400 : message.startsWith('Complete the placement test') ? 409 : 500;
    console.error(`[AdaptLearn] ${message}`);
    response.status(status).json({ error: message });
  });

  return app;
}
