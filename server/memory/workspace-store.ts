import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ConversationTurn, LearningWorkspace } from '../../shared/contracts.ts';

type WorkspaceFile = { workspaces: Record<string, LearningWorkspace> };

const freshWorkspace = (learnerId: string): LearningWorkspace => ({
  learnerId,
  profile: { displayName: 'Learner', background: '', preferences: '' },
  goals: [],
  documents: [],
  materials: [],
  suggestions: [],
  assessments: [],
  conversation: [],
  progress: { xp: 0, level: 'Unassessed', badges: [], completedAssessments: 0 },
  updatedAt: new Date().toISOString(),
});

const normalizedWorkspace = (workspace: LearningWorkspace): LearningWorkspace => ({
  ...workspace,
  documents: workspace.documents ?? [],
});

export class WorkspaceStore {
  private readonly filePath = path.resolve(process.cwd(), 'data', 'workspace.json');
  private queue: Promise<unknown> = Promise.resolve();

  private async readFile(): Promise<WorkspaceFile> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as WorkspaceFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { workspaces: {} };
    }
  }

  private async writeFile(data: WorkspaceFile) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  async get(learnerId: string): Promise<LearningWorkspace> {
    const data = await this.readFile();
    return normalizedWorkspace(data.workspaces[learnerId] ?? freshWorkspace(learnerId));
  }

  async update(learnerId: string, mutate: (workspace: LearningWorkspace) => void | LearningWorkspace): Promise<LearningWorkspace> {
    let result!: LearningWorkspace;
    const operation = this.queue.then(async () => {
      const data = await this.readFile();
      const current = normalizedWorkspace(data.workspaces[learnerId] ?? freshWorkspace(learnerId));
      result = mutate(current) ?? current;
      result.updatedAt = new Date().toISOString();
      data.workspaces[learnerId] = result;
      await this.writeFile(data);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  async appendTurn(learnerId: string, turn: Omit<ConversationTurn, 'id' | 'createdAt'>) {
    return this.update(learnerId, (workspace) => {
      workspace.conversation.push({ ...turn, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
      workspace.conversation = workspace.conversation.slice(-80);
    });
  }
}
