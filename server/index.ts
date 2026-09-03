import crypto from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AgentId, LearningWorkspace } from '../shared/contracts.ts';
import { agents } from './agents/catalog.ts';
import { submitPlacement, createPlacement, publicAssessment } from './agents/assessor/placement.ts';
import { createBuilderLab } from './agents/builder/create-lab.ts';
import { findResearchUpdates } from './agents/researcher/find-updates.ts';
import { createTeacherMaterial } from './agents/teacher/create-material.ts';
import { openAIIsConfigured } from './ai/openai-client.ts';
import { ingestDocument } from './knowledge/document-store.ts';
import { WorkspaceStore } from './memory/workspace-store.ts';
import { runTurn } from './orchestration/run-turn.ts';

const port = Number(process.env.API_PORT ?? 8787);
const app = express();
const store = new WorkspaceStore();
const upload = multer({
  dest: path.resolve(process.cwd(), 'data', 'uploads'),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const learnerIdSchema = z.string().trim().min(1).max(100);
const agentIdSchema = z.enum(['coordinator', 'teacher', 'builder', 'assessor', 'researcher']);
const chatSchema = z.object({
  learnerId: learnerIdSchema,
  message: z.string().trim().min(1).max(8000),
  requestedAgent: agentIdSchema.optional(),
});
const goalSchema = z.object({
  title: z.string().trim().min(2).max(160),
  motivation: z.string().trim().max(1000).default(''),
  targetOutcome: z.string().trim().max(1000).default(''),
  background: z.string().trim().max(1500).default(''),
  preferences: z.string().trim().max(1000).default(''),
});

const publicWorkspace = (workspace: LearningWorkspace): LearningWorkspace => ({
  ...workspace,
  assessments: workspace.assessments.map((assessment) => publicAssessment(assessment) as typeof assessment),
});

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_request, response) => response.json({
  status: 'ok',
  storage: 'local-workspace',
  ai: 'openai',
  aiConfigured: await openAIIsConfigured(),
}));

app.get('/api/agents', (_request, response) => response.json(Object.values(agents).map(({ id, name, owns, doesNotOwn }) => ({ id, name, owns, doesNotOwn }))));

app.get('/api/workspace/:learnerId', async (request, response) => {
  const learnerId = learnerIdSchema.parse(request.params.learnerId);
  response.json(publicWorkspace(await store.get(learnerId)));
});

app.put('/api/workspace/:learnerId/profile', async (request, response) => {
  const learnerId = learnerIdSchema.parse(request.params.learnerId);
  const profile = z.object({ displayName: z.string().trim().min(1).max(100), background: z.string().max(1500), preferences: z.string().max(1000) }).parse(request.body);
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
      id: crypto.randomUUID(),
      title: input.title,
      motivation: input.motivation,
      targetOutcome: input.targetOutcome,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  });
  response.status(201).json(publicWorkspace(workspace));
});

app.post('/api/chat', async (request, response) => {
  const input = chatSchema.parse(request.body);
  const result = await runTurn(store, input.learnerId, input.message, input.requestedAgent as AgentId | undefined);
  response.json({ ...result, workspace: publicWorkspace(result.workspace) });
});

app.delete('/api/workspace/:learnerId/conversation', async (request, response) => {
  const learnerId = learnerIdSchema.parse(request.params.learnerId);
  const workspace = await store.update(learnerId, (current) => { current.conversation = []; });
  response.json(publicWorkspace(workspace));
});

app.post('/api/materials/generate', async (request, response) => {
  const input = z.object({ learnerId: learnerIdSchema, goalId: z.string().uuid(), owner: z.enum(['teacher', 'builder']), kind: z.enum(['lesson', 'practice-lab']).optional() }).parse(request.body);
  const material = input.owner === 'builder'
    ? await createBuilderLab(store, input.learnerId, input.goalId)
    : await createTeacherMaterial(store, input.learnerId, input.goalId);
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
  let goalId = '';
  let brief = '';
  const workspace = await store.get(input.learnerId);
  const suggestion = workspace.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) throw new Error('Research suggestion not found.');
  goalId = suggestion.goalId;
  brief = `Turn this approved suggestion into a scoped optional lesson: ${suggestion.title}. ${suggestion.summary}. Source: ${suggestion.sourceUrl ?? 'No source URL supplied.'}`;
  const material = await createTeacherMaterial(store, input.learnerId, goalId, brief);
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
    const document = await ingestDocument(request.file);
    const workspace = await store.update(learnerId, (current) => { current.documents.push(document); });
    return response.status(201).json({ document, workspace: publicWorkspace(workspace) });
  } catch (error) {
    await unlink(request.file.path).catch(() => undefined);
    const message = error instanceof Error ? error.message : 'The document could not be read.';
    return response.status(400).json({ error: message });
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  const message = error instanceof Error ? error.message : 'Unknown server error';
  const status = error instanceof z.ZodError ? 400 : message.startsWith('Complete the placement check') ? 409 : 500;
  console.error(`[AdaptLearn] ${message}`);
  response.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`AdaptLearn API ready at http://localhost:${port}`);
});
