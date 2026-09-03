import type { AgentId, ChatResponse } from '../../shared/contracts.ts';
import { openAIChat } from '../ai/openai-client.ts';
import { agents, routeToAgent } from '../agents/catalog.ts';
import { workspaceContext } from '../agents/types.ts';
import type { WorkspaceStore } from '../memory/workspace-store.ts';

export async function runTurn(store: WorkspaceStore, learnerId: string, message: string, requestedAgent?: AgentId): Promise<ChatResponse> {
  const workspace = await store.get(learnerId);
  const routedTo = routeToAgent(message, requestedAgent);
  const specialist = agents[routedTo];
  const history = workspace.conversation.slice(-12).map((turn) => ({
    role: turn.role,
    content: turn.text,
  } as const));

  await store.appendTurn(learnerId, { role: 'user', text: message, agent: 'coordinator' });
  const reply = await openAIChat({
    model: routedTo === 'researcher' ? (process.env.OPENAI_RESEARCH_MODEL ?? 'gpt-5.4-nano') : undefined,
    builtInTools: routedTo === 'researcher' ? ['web_search'] : undefined,
    messages: [
      { role: 'system', content: agents.coordinator.systemPrompt },
      { role: 'system', content: `The Coordinator routed this turn to ${specialist.name}.\n${specialist.systemPrompt}` },
      { role: 'system', content: `Current persistent workspace:\n${workspaceContext(workspace)}` },
      ...history,
      { role: 'user', content: message },
    ],
  });
  const updated = await store.appendTurn(learnerId, { role: 'assistant', text: reply, agent: routedTo });
  return {
    reply,
    respondedBy: routedTo,
    trace: routedTo === 'coordinator'
      ? [{ agent: 'coordinator', action: 'Used learner memory and responded' }]
      : [
          { agent: 'coordinator', action: `Read memory and routed to ${specialist.name}` },
          { agent: routedTo, action: 'Completed the specialist turn' },
        ],
    workspace: updated,
  };
}
