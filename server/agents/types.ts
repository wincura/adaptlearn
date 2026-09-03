import type { AgentId, LearningWorkspace } from '../../shared/contracts.ts';

export type AgentDefinition = {
  id: AgentId;
  name: string;
  owns: string[];
  doesNotOwn: string[];
  systemPrompt: string;
};

export const workspaceContext = (workspace: LearningWorkspace) => JSON.stringify({
  learner: workspace.profile,
  activeGoals: workspace.goals.filter((goal) => goal.status === 'active'),
  progress: workspace.progress,
  existingMaterials: workspace.materials.map((item) => ({ title: item.title, kind: item.kind, owner: item.owner })),
  acceptedSuggestions: workspace.suggestions.filter((item) => item.status === 'accepted'),
}, null, 2);
