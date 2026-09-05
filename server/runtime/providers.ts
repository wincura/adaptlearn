import type { KnowledgeRepository } from '../knowledge/contracts.ts';
import { localKnowledgeRepository } from '../knowledge/document-store.ts';
import { WorkspaceStore } from '../memory/workspace-store.ts';
import type { SandboxExecutor } from '../sandbox/contracts.ts';
import { E2BSandboxExecutor } from '../sandbox/e2b-executor.ts';
import { LocalSandboxExecutor } from '../sandbox/local-executor.ts';
import type { WorkspaceRepository } from '../storage/workspace-repository.ts';

export function createWorkspaceRepository(): WorkspaceRepository {
  const provider = process.env.WORKSPACE_REPOSITORY ?? 'local-json';
  if (provider === 'local-json') return new WorkspaceStore();
  throw new Error(`Unknown WORKSPACE_REPOSITORY “${provider}”. Register its WorkspaceRepository adapter in server/runtime/providers.ts.`);
}

export function createKnowledgeRepository(): KnowledgeRepository {
  const provider = process.env.KNOWLEDGE_REPOSITORY ?? 'local-filesystem';
  if (provider === 'local-filesystem') return localKnowledgeRepository;
  throw new Error(`Unknown KNOWLEDGE_REPOSITORY “${provider}”. Register its KnowledgeRepository adapter in server/runtime/providers.ts.`);
}

export function createSandboxExecutor(): SandboxExecutor {
  const provider = (process.env.SANDBOX_EXECUTOR ?? 'e2b').toLowerCase();
  if (provider === 'e2b') return new E2BSandboxExecutor();
  if (provider === 'local') return new LocalSandboxExecutor();
  throw new Error(`Unknown SANDBOX_EXECUTOR “${provider}”. Supported values: e2b, local.`);
}

