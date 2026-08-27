import crypto from 'node:crypto';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { generateReply } from './ai/provider.ts';
import { LocalJsonStore } from './storage/local-json-store.ts';

const port = Number(process.env.API_PORT ?? 8787);
const app = express();
const store = new LocalJsonStore();
const upload = multer({
  dest: path.resolve(process.cwd(), 'data', 'uploads'),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const chatSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  mode: z.enum(['Teacher', 'Conversation']),
  profile: z.object({
    topic: z.string().max(120),
    level: z.string().max(80),
    style: z.string().max(80),
    xp: z.number().nonnegative(),
  }),
});

const profileSchema = z.object({
  id: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100),
  topic: z.string().min(1).max(120),
  familiarity: z.enum(['Absolute beginner', 'Beginner', 'Intermediate', 'Professional']),
  learningStyle: z.string().max(80),
  goals: z.array(z.string().max(240)).max(20),
  xp: z.number().nonnegative(),
  currentLevel: z.string().max(80),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => response.json({ status: 'ok', storage: 'local-json', ai: process.env.AI_PROVIDER ?? 'mock' }));

app.get('/api/profile/:id', async (request, response) => {
  const profile = await store.getProfile(request.params.id);
  if (!profile) return response.status(404).json({ error: 'Profile not found' });
  return response.json(profile);
});

app.put('/api/profile/:id', async (request, response) => {
  const parsed = profileSchema.safeParse({ ...request.body, id: request.params.id });
  if (!parsed.success) return response.status(400).json({ error: 'Invalid profile', details: parsed.error.flatten() });
  return response.json(await store.saveProfile(parsed.data));
});

app.post('/api/chat', async (request, response, next) => {
  try {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid chat request' });
    const reply = await generateReply(parsed.data);
    await store.appendEvent({
      id: crypto.randomUUID(),
      learnerId: 'local-learner',
      type: 'conversation',
      summary: parsed.data.message.slice(0, 240),
      evidence: { mode: parsed.data.mode, topic: parsed.data.profile.topic },
      createdAt: new Date().toISOString(),
    });
    return response.json({ reply, agent: 'teacher', coordinatedBy: 'coordinator' });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/documents', upload.single('document'), (request, response) => {
  if (!request.file) return response.status(400).json({ error: 'No document supplied' });
  return response.status(201).json({
    id: request.file.filename,
    name: request.file.originalname,
    size: request.file.size,
    status: 'queued-for-indexing',
  });
});

app.get('/api/research/suggestions', (_request, response) => response.json({
  suggestions: [
    { id: 'python-type-hints', title: 'Type hints as a beginner readability tool', scope: 'optional', sourceType: 'official-documentation' },
    { id: 'vscode-debugging', title: 'Debugging with breakpoints after your first loop project', scope: 'optional', sourceType: 'official-documentation' },
  ],
}));

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  console.error(error);
  response.status(500).json({ error: 'The local service could not complete this request.' });
});

app.listen(port, () => {
  console.log(`AdaptLearn API ready at http://localhost:${port}`);
});
