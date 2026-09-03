import type { AgentId, ChatResponse, KnowledgeDocument, LearnerProfile, LearningWorkspace, PublicPlacementAssessment } from '../shared/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Request failed (${response.status})` })) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string; ai: 'openai'; aiConfigured: boolean }>('/health'),
  workspace: (learnerId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}`),
  updateProfile: (learnerId: string, profile: LearnerProfile) => request<LearningWorkspace>(`/api/workspace/${learnerId}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }),
  addGoal: (learnerId: string, body: { title: string; motivation: string; targetOutcome: string; background: string; preferences: string }) => request<LearningWorkspace>(`/api/workspace/${learnerId}/goals`, json(body)),
  chat: (learnerId: string, message: string, requestedAgent?: AgentId) => request<ChatResponse>('/api/chat', json({ learnerId, message, requestedAgent })),
  clearChat: (learnerId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}/conversation`, { method: 'DELETE' }),
  generateMaterial: (learnerId: string, goalId: string, owner: 'teacher' | 'builder', kind?: 'lesson' | 'practice-lab') => request<{ material: import('../shared/contracts').LearningMaterial; workspace: LearningWorkspace }>('/api/materials/generate', json({ learnerId, goalId, owner, kind })),
  createPlacement: (learnerId: string, goalId: string) => request<PublicPlacementAssessment>('/api/assessments/placement', json({ learnerId, goalId })),
  submitPlacement: (learnerId: string, assessmentId: string, answers: number[]) => request<{ score: number; level: string; xpAwarded: number; badgeAwarded?: string; workspace: LearningWorkspace }>(`/api/assessments/${assessmentId}/submit`, json({ learnerId, answers })),
  research: (learnerId: string, goalId: string) => request<{ workspace: LearningWorkspace }>('/api/research/suggestions', json({ learnerId, goalId })),
  acceptSuggestion: (learnerId: string, suggestionId: string) => request<{ material: import('../shared/contracts').LearningMaterial; workspace: LearningWorkspace }>(`/api/research/suggestions/${suggestionId}/accept`, json({ learnerId })),
  uploadDocument: async (learnerId: string, file: File) => {
    const form = new FormData();
    form.append('learnerId', learnerId);
    form.append('document', file);
    return request<{ document: KnowledgeDocument; workspace: LearningWorkspace }>('/api/documents', { method: 'POST', body: form });
  },
};
