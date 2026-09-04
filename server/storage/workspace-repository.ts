import type { ConversationTurn, LearnerWorkspaceSummary, LearningWorkspace } from '../../shared/contracts.ts';

export type WorkspaceMutation = (workspace: LearningWorkspace) => void | LearningWorkspace;

export interface WorkspaceRepository {
  readonly backend: string;
  list(): Promise<LearnerWorkspaceSummary[]>;
  get(learnerId: string): Promise<LearningWorkspace>;
  update(learnerId: string, mutate: WorkspaceMutation): Promise<LearningWorkspace>;
  appendTurn(learnerId: string, turn: Omit<ConversationTurn, 'id' | 'createdAt'>): Promise<LearningWorkspace>;
  delete(learnerId: string): Promise<void>;
}
