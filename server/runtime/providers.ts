import type { KnowledgeRepository } from '../knowledge/contracts.ts';
import { localKnowledgeRepository } from '../knowledge/document-store.ts';
import { WorkspaceStore } from '../memory/workspace-store.ts';
import type { WorkspaceRepository } from '../storage/workspace-repository.ts';
import { DynamoDbWorkspaceRepository } from '../storage/dynamodb-workspace-repository.ts';

export function createWorkspaceRepository(): WorkspaceRepository {
  const provider = process.env.WORKSPACE_REPOSITORY ?? 'local-json';
  if (provider === 'local-json') return new WorkspaceStore();
  if (provider === 'dynamodb') return new DynamoDbWorkspaceRepository();
  throw new Error(`Unknown WORKSPACE_REPOSITORY “${provider}”. Register its WorkspaceRepository adapter in server/runtime/providers.ts.`);
}

export function createKnowledgeRepository(): KnowledgeRepository {
  const provider = process.env.KNOWLEDGE_REPOSITORY ?? 'local-filesystem';
  if (provider === 'local-filesystem') return localKnowledgeRepository;
  throw new Error(`Unknown KNOWLEDGE_REPOSITORY “${provider}”. Register its KnowledgeRepository adapter in server/runtime/providers.ts.`);
}
