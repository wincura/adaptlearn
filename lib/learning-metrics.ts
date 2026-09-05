import type { LearningWorkspace, PlacementAssessment } from '../shared/contracts';

export type ActivityEvent = {
  at: string;
  goalId?: string;
  kind: 'lesson' | 'assessment' | 'chat';
};

export type ActivityPoint = Record<string, string | number> & {
  date: string;
  label: string;
  total: number;
};

const localDayKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const shortDate = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function latestCompletedAssessment(workspace: LearningWorkspace, goalId: string): PlacementAssessment | undefined {
  return workspace.assessments
    .filter((assessment) => assessment.goalId === goalId && assessment.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
}

export function goalProgress(workspace: LearningWorkspace, goalId: string): number | undefined {
  return latestCompletedAssessment(workspace, goalId)?.score;
}

export function overallMastery(workspace: LearningWorkspace): number | undefined {
  const scores = workspace.goals.map((goal) => goalProgress(workspace, goal.id)).filter((score): score is number => score !== undefined);
  if (!scores.length) return undefined;
  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

export function activityEvents(workspace: LearningWorkspace): ActivityEvent[] {
  return [
    ...workspace.materials.filter((material) => material.kind === 'lesson').map((material) => ({ at: material.createdAt, goalId: material.goalId, kind: 'lesson' as const })),
    ...workspace.assessments.filter((assessment) => assessment.completedAt).map((assessment) => ({ at: assessment.completedAt as string, goalId: assessment.goalId, kind: 'assessment' as const })),
    ...workspace.conversation.filter((turn) => turn.role === 'user').map((turn) => ({ at: turn.createdAt, kind: 'chat' as const })),
  ].filter((event) => Boolean(event.at));
}

export function activityStreak(workspace: LearningWorkspace, now = new Date()): number {
  const dates = new Set(activityEvents(workspace).map((event) => localDayKey(new Date(event.at))));
  if (!dates.size) return 0;
  const cursor = new Date(now);
  if (!dates.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  if (!dates.has(localDayKey(cursor))) return 0;
  let streak = 0;
  while (dates.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function weeklyActivity(workspace: LearningWorkspace, now = new Date()): ActivityPoint[] {
  const end = new Date(now);
  const mondayOffset = (end.getDay() + 6) % 7;
  end.setDate(end.getDate() - mondayOffset);
  end.setHours(0, 0, 0, 0);
  const events = activityEvents(workspace);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() + index);
    const key = localDayKey(date);
    const row: ActivityPoint = { date: key, label: date.toLocaleDateString(undefined, { weekday: 'short' }), total: 0 };
    events.filter((event) => localDayKey(new Date(event.at)) === key).forEach((event) => {
      const bucket = event.goalId ?? 'general';
      row[bucket] = Number(row[bucket] ?? 0) + 1;
      row.total += 1;
    });
    return row;
  });
}

export function assessmentHistory(workspace: LearningWorkspace) {
  return workspace.assessments
    .filter((assessment) => assessment.completedAt && assessment.score !== undefined)
    .sort((left, right) => (left.completedAt ?? '').localeCompare(right.completedAt ?? ''))
    .map((assessment) => ({
      date: assessment.completedAt as string,
      label: shortDate(new Date(assessment.completedAt as string)),
      score: assessment.score as number,
      goalId: assessment.goalId,
    }));
}

export function skillBreakdown(workspace: LearningWorkspace, goalId?: string) {
  const assessment = goalId ? latestCompletedAssessment(workspace, goalId) : undefined;
  return assessment?.diagnostics?.dimensionScores.map((area) => ({ subject: area.dimension, score: area.percentage })) ?? [];
}

export function memberSince(workspace: LearningWorkspace): string {
  const timestamps = [
    workspace.updatedAt,
    ...workspace.goals.map((goal) => goal.createdAt),
    ...workspace.materials.map((material) => material.createdAt),
    ...workspace.assessments.map((assessment) => assessment.createdAt),
    ...workspace.conversation.map((turn) => turn.createdAt),
  ].filter(Boolean).sort();
  const first = timestamps[0];
  return first ? new Date(first).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'Today';
}

export function activityDate(key: string): Date {
  return dateFromKey(key);
}
