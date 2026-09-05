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
import { createKnowledgeRepository, createWorkspaceRepository } from './runtime/providers.ts';
import type { WorkspaceRepository } from './storage/workspace-repository.ts';

export type AppDependencies = {
  workspaceRepository?: WorkspaceRepository;
  knowledgeRepository?: KnowledgeRepository;
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
const courseImageSchema = z.object({ query: z.string().trim().min(2).max(120) });

type UnsplashSearchResponse = {
  results?: Array<{ urls?: { regular?: string } }>;
};

const courseImageCache = new Map<string, { image: string; expiresAt: number }>();

const publicWorkspace = (workspace: LearningWorkspace): LearningWorkspace => ({
  ...workspace,
  assessments: workspace.assessments.map((assessment) => publicAssessment(assessment) as typeof assessment),
});

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const store = dependencies.workspaceRepository ?? createWorkspaceRepository();
  const knowledge = dependencies.knowledgeRepository ?? createKnowledgeRepository();
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
    ai: aiProviderId(),
    aiConfigured: await aiIsConfigured(),
  }));

  app.get('/api/course-image', async (request, response) => {
    const { query } = courseImageSchema.parse(request.query);
    const normalizedQuery = query.toLocaleLowerCase();
    const cached = courseImageCache.get(normalizedQuery);
    if (cached && cached.expiresAt > Date.now()) return response.json({ image: cached.image });

    const accessKey = process.env.UNSPLASH_ACCESS_KEY ?? process.env.UNSPLASH_API_KEY;
    if (!accessKey) return response.json({});

    const searchUrl = new URL('https://api.unsplash.com/search/photos');
    searchUrl.searchParams.set('query', query);
    searchUrl.searchParams.set('per_page', '1');
    searchUrl.searchParams.set('orientation', 'landscape');

    try {
      const result = await fetch(searchUrl, { headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' } });
      if (!result.ok) return response.json({});
      const payload = await result.json() as UnsplashSearchResponse;
      const image = payload.results?.[0]?.urls?.regular;
      if (image) courseImageCache.set(normalizedQuery, { image, expiresAt: Date.now() + 60 * 60 * 1000 });
      return response.json(image ? { image } : {});
    } catch {
      return response.json({});
    }
  });

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

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next;
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const status = error instanceof z.ZodError ? 400 : message.startsWith('Complete the placement test') ? 409 : 500;
    console.error(`[AdaptLearn] ${message}`);
    response.status(status).json({ error: message });
  });

  return app;
}
