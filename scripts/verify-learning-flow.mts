import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const temporaryRoot = process.argv[2];
const keyFile = process.argv[3];
if (!temporaryRoot || !keyFile) throw new Error('Provide a temporary directory and an absolute key-file path.');

await mkdir(temporaryRoot, { recursive: true });
process.chdir(temporaryRoot);
process.env.OPENAI_KEY_FILE = keyFile;

const { WorkspaceStore } = await import('../server/memory/workspace-store.ts');
const { ingestDocument, loadRelevantDocumentContext } = await import('../server/knowledge/document-store.ts');
const { createPlacement, submitPlacement } = await import('../server/agents/assessor/placement.ts');
const { createTeacherMaterial } = await import('../server/agents/teacher/create-material.ts');

const learnerId = 'verification-learner';
const goalId = '0a5a5cf7-33f8-4e66-b711-363206cd60ad';
const store = new WorkspaceStore();
await store.update(learnerId, (workspace) => {
  workspace.profile = {
    displayName: 'Verification Learner',
    background: 'Absolute beginner',
    preferences: 'Short explanations followed by examples',
  };
  workspace.goals.push({
    id: goalId,
    title: 'Use AcmeFlow workflow rules',
    motivation: 'Automate a fictional internal approval workflow',
    targetOutcome: 'Create and test one safe workflow rule',
    status: 'active',
    createdAt: new Date().toISOString(),
  });
});

const uploadPath = path.join(temporaryRoot, 'acmeflow.md');
const privateDocumentation = '# AcmeFlow workflow rules\nA rule has a trigger, optional conditions, and one or more actions. Test a rule in Preview mode before enabling it.\n';
await writeFile(uploadPath, privateDocumentation, 'utf8');
const document = await ingestDocument({
  filename: 'verification-document',
  originalname: 'AcmeFlow private guide.md',
  mimetype: 'text/markdown',
  path: uploadPath,
  size: Buffer.byteLength(privateDocumentation),
}, { learnerId, goalId, visibility: 'goal' });
await store.update(learnerId, (workspace) => { workspace.documents.push(document); });

const retrieved = await loadRelevantDocumentContext(
  [document],
  'AcmeFlow workflow rules preview trigger actions',
  { learnerId, goalId },
);
const placement = await createPlacement(store, learnerId, goalId);
const placementWorkspace = await store.get(learnerId);
const privatePlacement = placementWorkspace.assessments.find((item) => item.id === placement.id);
if (!privatePlacement) throw new Error('Verification placement was not persisted.');
await submitPlacement(store, learnerId, placement.id, privatePlacement.questions.map((question) => question.correctIndex));
const priorTopics = ['Workflow rule anatomy', 'Triggers, conditions, and actions', 'Preview-mode testing'];
await store.update(learnerId, (workspace) => {
  workspace.materials.push({
    id: '54ddd410-25f8-46a0-abef-1a499c89ca97',
    goalId,
    owner: 'teacher',
    kind: 'lesson',
    title: 'AcmeFlow foundations',
    summary: 'A seeded prior lesson used to verify topic continuity.',
    topics: priorTopics,
    assessedLevel: 'Professional',
    placementAssessmentId: placement.id,
    sections: [{ title: 'Rule anatomy', content: 'Triggers, conditions, actions, and Preview mode.', activities: [] }],
    createdAt: new Date().toISOString(),
  });
});
const lesson = await createTeacherMaterial(store, learnerId, goalId);
const workspace = await store.get(learnerId);

console.log(JSON.stringify({
  document: { status: document.status, characters: document.characterCount },
  retrieval: { usedDocuments: retrieved.usedDocuments, hasPrivateFact: retrieved.context.includes('Preview mode') },
  placement: { questionCount: placement.questions.length, appliedLevel: lesson.assessedLevel, linkedAssessment: lesson.placementAssessmentId === placement.id },
  lesson: {
    kind: lesson.kind,
    topics: lesson.topics,
    hasNewTopic: lesson.topics?.some((topic) => !priorTopics.map((prior) => prior.toLowerCase()).includes(topic.toLowerCase())) ?? false,
    sectionCount: lesson.sections.length,
    publicSourceCount: lesson.sources?.filter((source) => source.origin === 'public-web').length ?? 0,
    uploadedSourceCount: lesson.sources?.filter((source) => source.origin === 'uploaded-document').length ?? 0,
  },
  persisted: { materials: workspace.materials.length, documents: workspace.documents.length, assessments: workspace.assessments.length },
}, null, 2));
