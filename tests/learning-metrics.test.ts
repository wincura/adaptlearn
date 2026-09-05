import assert from 'node:assert/strict';
import test from 'node:test';
import type { LearningWorkspace } from '../shared/contracts';
import { activityEvents, activityStreak, goalProgress, latestCompletedAssessment, overallMastery, skillBreakdown, weeklyActivity } from '../lib/learning-metrics.ts';

const atLocalNoon = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).toISOString();

const workspace = (overrides: Partial<LearningWorkspace> = {}): LearningWorkspace => ({
  learnerId: 'test-learner',
  profile: { displayName: 'Test Learner', background: '', preferences: '' },
  goals: [
    { id: 'japanese', title: 'Japanese', motivation: '', targetOutcome: '', status: 'active', createdAt: atLocalNoon(2026, 8, 1) },
    { id: 'python', title: 'Python', motivation: '', targetOutcome: '', status: 'active', createdAt: atLocalNoon(2026, 8, 2) },
    { id: 'empty', title: 'Empty', motivation: '', targetOutcome: '', status: 'active', createdAt: atLocalNoon(2026, 8, 3) },
  ],
  documents: [],
  materials: [],
  suggestions: [],
  assessments: [],
  conversation: [],
  progress: { xp: 0, level: 'Unassessed', badges: [], completedAssessments: 0 },
  updatedAt: atLocalNoon(2026, 8, 1),
  ...overrides,
});

test('selects the latest completed assessment and uses its score for progress', () => {
  const current = workspace({ assessments: [
    { id: 'old', goalId: 'japanese', title: 'Old', questions: [], score: 45, level: 'Beginner', completedAt: atLocalNoon(2026, 8, 10), createdAt: atLocalNoon(2026, 8, 10) },
    { id: 'latest', goalId: 'japanese', title: 'Latest', questions: [], score: 82, level: 'Intermediate', completedAt: atLocalNoon(2026, 8, 20), createdAt: atLocalNoon(2026, 8, 20) },
    { id: 'pending', goalId: 'japanese', title: 'Pending', questions: [], score: 99, createdAt: atLocalNoon(2026, 8, 25) },
  ] });

  assert.equal(latestCompletedAssessment(current, 'japanese')?.id, 'latest');
  assert.equal(goalProgress(current, 'japanese'), 82);
  assert.equal(goalProgress(current, 'empty'), undefined);
});

test('averages one latest score per assessed goal and leaves empty mastery honest', () => {
  const current = workspace({ assessments: [
    { id: 'japanese-latest', goalId: 'japanese', title: 'Japanese', questions: [], score: 82, completedAt: atLocalNoon(2026, 8, 20), createdAt: atLocalNoon(2026, 8, 20) },
    { id: 'python-latest', goalId: 'python', title: 'Python', questions: [], score: 60, completedAt: atLocalNoon(2026, 8, 21), createdAt: atLocalNoon(2026, 8, 21) },
  ] });

  assert.equal(overallMastery(current), 71);
  assert.equal(overallMastery(workspace()), undefined);
});

test('groups real activity by course and ignores practice labs', () => {
  const current = workspace({
    materials: [
      { id: 'lesson', goalId: 'japanese', owner: 'teacher', kind: 'lesson', title: 'Lesson', summary: '', sections: [], createdAt: atLocalNoon(2026, 9, 1) },
      { id: 'lab', goalId: 'python', owner: 'builder', kind: 'practice-lab', title: 'Lab', summary: '', sections: [], createdAt: atLocalNoon(2026, 9, 1) },
    ],
    assessments: [{ id: 'assessment', goalId: 'python', title: 'Assessment', questions: [], score: 70, completedAt: atLocalNoon(2026, 9, 2), createdAt: atLocalNoon(2026, 9, 2) }],
    conversation: [{ id: 'chat', role: 'user', text: 'Explain this', agent: 'coordinator', createdAt: atLocalNoon(2026, 9, 3) }],
  });

  assert.deepEqual(activityEvents(current).map((event) => event.kind), ['lesson', 'assessment', 'chat']);
  const days = weeklyActivity(current, new Date(2026, 8, 5));
  assert.equal(days.find((day) => day.date === '2026-09-01')?.japanese, 1);
  assert.equal(days.find((day) => day.date === '2026-09-02')?.python, 1);
  assert.equal(days.find((day) => day.date === '2026-09-03')?.general, 1);
  assert.equal(days.reduce((total, day) => total + day.total, 0), 3);
});

test('calculates a consecutive local-day streak and returns zero after a gap', () => {
  const current = workspace({ materials: [
    { id: 'one', goalId: 'japanese', owner: 'teacher', kind: 'lesson', title: 'One', summary: '', sections: [], createdAt: atLocalNoon(2026, 9, 3) },
    { id: 'two', goalId: 'japanese', owner: 'teacher', kind: 'lesson', title: 'Two', summary: '', sections: [], createdAt: atLocalNoon(2026, 9, 4) },
    { id: 'three', goalId: 'japanese', owner: 'teacher', kind: 'lesson', title: 'Three', summary: '', sections: [], createdAt: atLocalNoon(2026, 9, 5) },
  ] });

  assert.equal(activityStreak(current, new Date(2026, 8, 5, 18)), 3);
  assert.equal(activityStreak(current, new Date(2026, 8, 8, 18)), 0);
});

test('returns diagnostic dimensions only when the selected course has diagnostics', () => {
  const current = workspace({ assessments: [{ id: 'assessment', goalId: 'japanese', title: 'Assessment', questions: [], score: 70, diagnostics: { strengths: [], focusAreas: [], dimensionScores: [{ dimension: 'Vocabulary', correct: 7, total: 10, percentage: 70 }] }, completedAt: atLocalNoon(2026, 8, 20), createdAt: atLocalNoon(2026, 8, 20) }] });

  assert.deepEqual(skillBreakdown(current, 'japanese'), [{ subject: 'Vocabulary', score: 70 }]);
  assert.deepEqual(skillBreakdown(current, 'empty'), []);
});
