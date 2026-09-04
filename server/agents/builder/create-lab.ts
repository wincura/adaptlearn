import crypto from 'node:crypto';
import { z } from 'zod';
import type { LearningMaterial } from '../../../shared/contracts.ts';
import { aiChat, parseJsonObject } from '../../ai/provider.ts';
import type { WorkspaceRepository } from '../../storage/workspace-repository.ts';
import { builderAgent } from './agent.ts';

const labSchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(600),
  sections: z.array(z.object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(4000),
    activities: z.array(z.string().min(1).max(500)).max(8).optional(),
  })).min(3).max(8),
});

export async function createBuilderLab(store: WorkspaceRepository, learnerId: string, goalId: string): Promise<LearningMaterial> {
  const workspace = await store.get(learnerId);
  const goal = workspace.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error('Active learning goal not found.');
  const teacherMaterial = [...workspace.materials].reverse().find((item) => item.goalId === goalId && item.owner === 'teacher');
  const raw = await aiChat({
    jsonMode: true,
    temperature: 0.25,
    messages: [
      { role: 'system', content: builderAgent.systemPrompt },
      { role: 'system', content: 'Return only valid JSON with title, summary, and sections. Sections must cover objective, environment/starter state, steps, expected result, reset path, and safety limits.' },
      { role: 'user', content: `Build a practice-lab specification for ${JSON.stringify(goal)}.\nTeacher context: ${teacherMaterial ? JSON.stringify(teacherMaterial) : 'No Teacher material exists yet; keep the lab foundational.'}\nLearner: ${JSON.stringify(workspace.profile)}` },
    ],
  });
  const content = labSchema.parse(parseJsonObject(raw));
  const material: LearningMaterial = {
    id: crypto.randomUUID(), goalId, owner: 'builder', kind: 'practice-lab', ...content, createdAt: new Date().toISOString(),
  };
  await store.update(learnerId, (current) => { current.materials.push(material); });
  return material;
}
