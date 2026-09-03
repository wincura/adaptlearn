import type { AgentId } from '../../shared/contracts.ts';
import type { AgentDefinition } from './types.ts';
import { assessorAgent } from './assessor/agent.ts';
import { builderAgent } from './builder/agent.ts';
import { coordinatorAgent } from './coordinator/agent.ts';
import { researcherAgent } from './researcher/agent.ts';
import { teacherAgent } from './teacher/agent.ts';

export const agents: Record<AgentId, AgentDefinition> = {
  coordinator: coordinatorAgent,
  teacher: teacherAgent,
  builder: builderAgent,
  assessor: assessorAgent,
  researcher: researcherAgent,
};

export const routeToAgent = (message: string, requestedAgent?: AgentId): AgentId => {
  if (requestedAgent && requestedAgent !== 'coordinator') return requestedAgent;
  const text = message.toLowerCase();
  if (/\b(placement|assess|assessment|test|grade|level|score|quiz me)\b/.test(text)) return 'assessor';
  if (/\b(latest|new developments?|what'?s new|research|current|update|trend)\b/.test(text)) return 'researcher';
  if (/\b(build|sandbox|simulation|practice environment|starter files?|hands-on lab)\b/.test(text)) return 'builder';
  if (/\b(teach|explain|lesson|study plan|curriculum|exercise|quiz|learn)\b/.test(text)) return 'teacher';
  return 'coordinator';
};
