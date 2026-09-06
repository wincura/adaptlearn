import crypto from 'node:crypto';
import { z } from 'zod';
import type { LearningMaterial } from '../../../shared/contracts.ts';
import { aiChat, parseJsonObject } from '../../ai/provider.ts';
import { generateCodingChallenge } from '../../sandbox/code-evaluator.ts';
import { detectCodeTopic } from '../../sandbox/topic-detector.ts';
import type { WorkspaceRepository } from '../../storage/workspace-repository.ts';
import { builderAgent } from './agent.ts';

const labJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'sections'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 140 },
    summary: { type: 'string', minLength: 1, maxLength: 600 },
    sections: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'content', 'activities'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          content: { type: 'string', minLength: 1, maxLength: 4000 },
          activities: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
  },
};

const labSchema = z.object({
  title: z.string().min(1).max(140),
  summary: z.string().min(1).max(600),
  sections: z.preprocess((val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.entries(val).map(([key, item]) => {
        if (typeof item === 'string') {
          return { title: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), content: item };
        }
        if (item && typeof item === 'object') {
          const sectionObj = item as Record<string, unknown>;
          return {
            title: String(sectionObj.title ?? key),
            content: String(sectionObj.content ?? JSON.stringify(sectionObj)),
            activities: Array.isArray(sectionObj.activities) ? sectionObj.activities : undefined,
          };
        }
        return { title: key, content: String(item) };
      });
    }
    return val;
  }, z.array(z.object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(4000),
    activities: z.array(z.string().min(1).max(500)).max(8).optional(),
  })).min(3).max(8)),
});

export async function createBuilderLab(store: WorkspaceRepository, learnerId: string, goalId: string): Promise<LearningMaterial> {
  const workspace = await store.get(learnerId);
  const goal = workspace.goals.find((item) => item.id === goalId);
  if (!goal) throw new Error('Active learning goal not found.');
  const teacherMaterial = [...workspace.materials].reverse().find((item) => item.goalId === goalId && item.owner === 'teacher');
  const latestAssessment = workspace.assessments
    .filter((assessment) => assessment.goalId === goalId && assessment.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
  const assessedLevel = latestAssessment?.level ?? 'Beginner';

  const raw = await aiChat({
    jsonSchema: { name: 'practice_lab', schema: labJsonSchema },
    temperature: 0.25,
    messages: [
      { role: 'system', content: builderAgent.systemPrompt },
      { role: 'system', content: 'Return only valid JSON with title, summary, and sections as an array of section objects. Sections must cover practical learning objectives, key concepts & syntax recap, step-by-step guidance, and hands-on exercises. Never output developer infrastructure notes like reset paths or safety limits.' },
      { role: 'user', content: `Build a student-friendly practice activity for ${JSON.stringify(goal)}.\nAssessed learner level: ${assessedLevel}\nTeacher context: ${teacherMaterial ? JSON.stringify(teacherMaterial) : 'No Teacher material exists yet; keep the activity foundational.'}\nLearner: ${JSON.stringify(workspace.profile)}` },
    ],
  });
  const content = labSchema.parse(parseJsonObject(raw));

  const detected = detectCodeTopic(content.title, goal.title, goal.motivation);
  let codingChallenge: import('../../../shared/contracts.ts').CodingChallenge | undefined;
  if (detected.isCodeTopic && detected.language) {
    try {
      codingChallenge = await generateCodingChallenge(
        goal,
        content.title,
        content.title,
        detected.language,
        assessedLevel,
      );
    } catch (err) {
      console.warn(`[AdaptLearn] Builder coding challenge skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const material: LearningMaterial = {
    id: crypto.randomUUID(),
    goalId,
    owner: 'builder',
    kind: 'practice-lab',
    ...content,
    codingChallenge,
    codingChallenges: codingChallenge ? [codingChallenge] : [],
    isCodeTopic: detected.isCodeTopic,
    createdAt: new Date().toISOString(),
  };
  await store.update(learnerId, (current) => { current.materials.push(material); });
  return material;
}
