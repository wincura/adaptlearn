import type { KnowledgeRepository } from '../knowledge/contracts.ts';
import type { WorkspaceRepository } from '../storage/workspace-repository.ts';
import type { LearningWorkspace } from '../../shared/contracts.ts';
import { HttpError, type PrivateWorkspace } from './ownership.ts';

const combine = <T extends { id: string }>(account: T[], guest: T[]) => {
  const ids = new Set(account.map((item) => item.id));
  return [...account, ...guest.filter((item) => !ids.has(item.id))];
};
export function mergeGuest(account: PrivateWorkspace, guest: LearningWorkspace): PrivateWorkspace {
  if (account.auth?.importedGuests?.includes(guest.learnerId)) return account;
  const hasActive = account.goals.some((goal) => goal.status === 'active');
  account.goals = combine(account.goals, guest.goals.map((goal) => hasActive && goal.status === 'active' ? { ...goal, status: 'paused' as const } : goal));
  account.materials = combine(account.materials, guest.materials);
  account.assessments = combine(account.assessments, guest.assessments);
  account.suggestions = combine(account.suggestions, guest.suggestions);
  account.documents = combine(account.documents, guest.documents);
  account.conversation = combine(account.conversation, guest.conversation).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  account.profile.background ||= guest.profile.background;
  account.profile.preferences ||= guest.profile.preferences;
  account.progress.xp += guest.progress.xp;
  account.progress.completedAssessments += guest.progress.completedAssessments;
  account.progress.badges = [...new Set([...account.progress.badges, ...guest.progress.badges])];
  if (account.progress.level === 'Unassessed') account.progress.level = guest.progress.level;
  account.auth = { ...account.auth, pendingGuests: account.auth?.pendingGuests?.filter((id) => id !== guest.learnerId), importedGuests: [...(account.auth?.importedGuests ?? []), guest.learnerId] };
  return account;
}

export async function importGuest(store: WorkspaceRepository, knowledge: KnowledgeRepository, guestId: string, accountId: string) {
  await store.update(accountId, (workspace: PrivateWorkspace) => {
    if (!workspace.auth?.importedGuests?.includes(guestId)) workspace.auth = { ...workspace.auth, pendingGuests: [...new Set([...(workspace.auth?.pendingGuests ?? []), guestId])] };
  });
  const guest = await store.update(guestId, (workspace: PrivateWorkspace) => {
    if (workspace.auth?.importingTo && workspace.auth.importingTo !== accountId) throw new HttpError(409, 'This guest workspace is already linked to another account.');
    workspace.auth = { ...workspace.auth, importingTo: accountId };
  });
  if ((await store.get(accountId) as PrivateWorkspace).auth?.importedGuests?.includes(guestId)) return;
  const documents: LearningWorkspace['documents'] = [];
  for (const document of guest.documents) {
    if (!knowledge.copyTo) throw new Error('Document import is unavailable for this storage provider.');
    documents.push(await knowledge.copyTo(document, accountId));
  }
  await store.update(accountId, (account: PrivateWorkspace) => mergeGuest(account, { ...guest, documents }));
}
