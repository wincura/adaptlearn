import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import type { LearningWorkspace } from '../shared/contracts.ts';

const temporaryRoot = process.argv[2];
if (!temporaryRoot) throw new Error('Provide a temporary directory.');
await mkdir(temporaryRoot, { recursive: true });
process.chdir(temporaryRoot);

const { createApp } = await import('../server/app.ts');
const { LocalKnowledgeRepository } = await import('../server/knowledge/document-store.ts');
const { WorkspaceStore } = await import('../server/memory/workspace-store.ts');

const store = new WorkspaceStore();
const knowledge = new LocalKnowledgeRepository();
const server = createApp({ workspaceRepository: store, knowledgeRepository: knowledge }).listen(0);
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
const baseUrl = `http://127.0.0.1:${address.port}`;

const requestJson = async <T,>(pathname: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  const body = await response.json() as T;
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
};
const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

try {
  const learnerId = 'architecture-verification';
  const first = await requestJson<LearningWorkspace>(`/api/workspace/${learnerId}/goals`, postJson({
    title: 'First durable goal', motivation: '', targetOutcome: '', background: 'Beginner', preferences: 'Examples',
  }));
  const firstGoalId = first.goals[0].id as string;
  const second = await requestJson<LearningWorkspace>(`/api/workspace/${learnerId}/goals`, postJson({
    title: 'Second durable goal', motivation: '', targetOutcome: '', background: 'Beginner', preferences: 'Examples',
  }));
  const secondGoal = second.goals.find((goal) => goal.status === 'active');
  if (!secondGoal) throw new Error('The second goal was not activated.');
  const secondGoalId = secondGoal.id;
  const switched = await requestJson<LearningWorkspace>(`/api/workspace/${learnerId}/goals/${firstGoalId}/activate`, { method: 'PUT' });
  const activeGoals = switched.goals.filter((goal: { status: string }) => goal.status === 'active');
  if (activeGoals.length !== 1 || activeGoals[0].id !== firstGoalId) throw new Error('Goal activation did not persist exactly one active goal.');
  if (!switched.goals.some((goal: { id: string; status: string }) => goal.id === secondGoalId && goal.status === 'paused')) {
    throw new Error('The previously active goal was not preserved as paused.');
  }

  const ownUpload = path.join(temporaryRoot, 'own.md');
  const otherUpload = path.join(temporaryRoot, 'other.md');
  await writeFile(ownUpload, 'AdaptLearn private workflow uses a blue approval token.', 'utf8');
  await writeFile(otherUpload, 'Another learner private workflow uses a red approval token.', 'utf8');
  const ownDocument = await knowledge.ingest({
    filename: 'own-document', originalname: 'Own guide.md', mimetype: 'text/markdown', path: ownUpload, size: 57,
  }, { learnerId, goalId: firstGoalId, visibility: 'goal' });
  const otherDocument = await knowledge.ingest({
    filename: 'other-document', originalname: 'Other guide.md', mimetype: 'text/markdown', path: otherUpload, size: 62,
  }, { learnerId: 'different-learner', visibility: 'learner' });
  const passages = await knowledge.retrieve([ownDocument, otherDocument], {
    text: 'private workflow approval token',
    scope: { learnerId, goalId: firstGoalId },
    topK: 5,
  });
  if (!passages.some((passage) => passage.text.includes('blue approval token'))) throw new Error('Scoped retrieval missed the learner document.');
  if (passages.some((passage) => passage.text.includes('red approval token'))) throw new Error('Scoped retrieval leaked another learner document.');

  console.log(JSON.stringify({
    goals: { saved: switched.goals.length, active: activeGoals[0].title, previousGoalPreserved: true },
    retrieval: { passages: passages.length, source: passages[0]?.source.title, crossLearnerIsolation: true },
  }, null, 2));
} finally {
  server.close();
  await once(server, 'close');
}
