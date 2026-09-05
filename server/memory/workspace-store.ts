import { mkdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import type { ConversationTurn, LearnerWorkspaceSummary, LearningWorkspace } from '../../shared/contracts.ts';
import type { WorkspaceMutation, WorkspaceRepository } from '../storage/workspace-repository.ts';

type WorkspaceFile = { workspaces: Record<string, LearningWorkspace> };

export const freshWorkspace = (learnerId: string): LearningWorkspace => ({
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

const legacyTopics = (material: LearningWorkspace['materials'][number]) => {
  if (material.kind !== 'lesson' || material.topics?.length) return material.topics;
  const usefulSections = material.sections
    .map((section) => section.title.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter((title) => !/\b(quiz|practice|exercise|where this leads|how to read)\b/i.test(title))
    .slice(0, 6);
  return usefulSections.length ? usefulSections : [material.title.slice(0, 80)];
};

export const normalizedWorkspace = (workspace: LearningWorkspace): LearningWorkspace => ({
  ...workspace,
  documents: workspace.documents ?? [],
  materials: (workspace.materials ?? []).map((material) => ({
    ...material,
    ...(material.kind === 'lesson' ? { topics: legacyTopics(material) } : {}),
  })),
});

export const summarizeWorkspace = (workspace: LearningWorkspace): LearnerWorkspaceSummary => ({
  learnerId: workspace.learnerId,
  displayName: workspace.profile.displayName,
  background: workspace.profile.background,
  activeGoalTitle: workspace.goals.find((goal) => goal.status === 'active')?.title,
  goalCount: workspace.goals.length,
  xp: workspace.progress.xp,
  level: workspace.progress.level,
  updatedAt: workspace.updatedAt,
});

export class WorkspaceStore implements WorkspaceRepository {
  readonly backend = 'local-json';
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

  async list(): Promise<LearnerWorkspaceSummary[]> {
    const data = await this.readFile();
    return Object.values(data.workspaces)
      .map(normalizedWorkspace)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(summarizeWorkspace);
  }

  async get(learnerId: string): Promise<LearningWorkspace> {
    const data = await this.readFile();
    return normalizedWorkspace(data.workspaces[learnerId] ?? freshWorkspace(learnerId));
  }

  async update(learnerId: string, mutate: WorkspaceMutation): Promise<LearningWorkspace> {
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

  async delete(learnerId: string): Promise<void> {
    const operation = this.queue.then(async () => {
      const data = await this.readFile();
      delete data.workspaces[learnerId];
      await this.writeFile(data);
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
}
