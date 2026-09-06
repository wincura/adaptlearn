import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkspaceRepository, WorkspaceMutation } from '../storage/workspace-repository.ts';
import type { ConversationTurn, LearningWorkspace } from '../../shared/contracts.ts';
import { summarizeWorkspace } from '../memory/workspace-store.ts';
import crypto from 'node:crypto';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const identity = new AsyncLocalStorage<{ learnerId: string }>();
export type PrivateWorkspace = LearningWorkspace & { auth?: { importingTo?: string; importedGuests?: string[]; pendingGuests?: string[]; nameCollected?: boolean } };
export const assertOwner = (learnerId: string) => {
  if (!identity.getStore() || identity.getStore()!.learnerId !== learnerId) throw new HttpError(403, 'This workspace belongs to another session.');
};
export const assertWritable = (workspace: PrivateWorkspace) => {
  if (workspace.auth?.importingTo) throw new HttpError(409, 'Guest progress is being imported. Finish signing in to continue.');
};

// Every repository operation, including nested agent calls and multipart uploads,
// is checked at the data boundary instead of trusting a route's learnerId.
export class OwnedWorkspaceRepository implements WorkspaceRepository {
  readonly backend: string;
  private repository: WorkspaceRepository;
  constructor(repository: WorkspaceRepository) { this.backend = repository.backend; this.repository = repository; }
  async list() { return [summarizeWorkspace(await this.get(identity.getStore()!.learnerId))]; }
  async get(id: string) { assertOwner(id); return this.repository.get(id); }
  async update(id: string, mutate: WorkspaceMutation) {
    assertOwner(id);
    return this.repository.update(id, (workspace) => { assertWritable(workspace); return mutate(workspace); });
  }
  async delete(_id: string): Promise<void> { throw new HttpError(403, 'Account profile deletion is not supported.'); }
  appendTurn(id: string, turn: Omit<ConversationTurn, 'id' | 'createdAt'>) {
    return this.update(id, (workspace) => {
      workspace.conversation.push({ ...turn, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      workspace.conversation = workspace.conversation.slice(-80);
    });
  }
}
