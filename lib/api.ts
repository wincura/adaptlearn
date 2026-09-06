import type { ChatResponse, KnowledgeDocument, LearnerProfile, LearningWorkspace, PlacementResult, PublicPlacementAssessment } from '../shared/contracts';

// Local development uses Vite's same-origin proxy. Leave this unset in
// production when CloudFront routes /api and /health to API Gateway.
const API_URL = import.meta.env.VITE_API_URL ?? '';

let csrfToken: string = import.meta.hot?.data.csrfToken ?? '';
if (import.meta.hot) import.meta.hot.dispose((data) => { data.csrfToken = csrfToken; });
const accountHintKey = 'adaptlearn.session-kind';
const rememberKind = (kind: string) => { try { window.localStorage.setItem(accountHintKey, kind); } catch { /* Private browser storage can be disabled. */ } };
const previousKind = () => { try { return window.localStorage.getItem(accountHintKey); } catch { return null; } };
export type AuthSession = { kind: 'guest' | 'account'; learnerId: string; csrfToken: string; signInAvailable: boolean; needsName: boolean; importPending: boolean; displayName: string };

async function request<T>(path: string, init?: RequestInit, retries = 2): Promise<T> {
  try {
    const headers = new Headers(init?.headers);
    if (init?.method && !['GET', 'HEAD'].includes(init.method)) {
      headers.set('X-CSRF-Token', csrfToken);
      headers.set('X-Requested-With', 'AdaptLearn');
    }
    const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
    if (response.status === 401) window.dispatchEvent(new Event('adaptlearn:session-expired'));
    if (!response.ok) {
      if ((response.status === 502 || response.status === 503) && retries > 0) {
        await new Promise((r) => setTimeout(r, 300));
        return request<T>(path, init, retries - 1);
      }
      const body = await response.json().catch(() => ({ error: `Request failed (${response.status})` })) as { error?: string };
      throw new Error(body.error ?? `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  } catch (err) {
    if (retries > 0 && err instanceof Error && (err.message.includes('fetch failed') || err.message.includes('ECONNRESET') || err.message.includes('network'))) {
      await new Promise((r) => setTimeout(r, 300));
      return request<T>(path, init, retries - 1);
    }
    throw err;
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let sessionRequest: Promise<AuthSession> | undefined;

export const api = {
  session: () => {
    sessionRequest ??= request<AuthSession>('/api/auth/session').then((session) => {
      if (session.kind === 'guest' && previousKind() === 'account') {
        window.dispatchEvent(new Event('adaptlearn:session-expired'));
        throw new Error('Sign in again to restore your account progress.');
      }
      csrfToken = session.csrfToken; rememberKind(session.kind); return session;
    }).finally(() => { sessionRequest = undefined; });
    return sessionRequest;
  },
  login: () => { window.location.assign(`${API_URL}/api/auth/login`); },
  logout: async () => { const result = await request<{ redirect: string }>('/api/auth/logout', { method: 'POST' }, 0); rememberKind('guest'); window.location.assign(result.redirect); },
  importGuest: () => request<{ success: boolean }>('/api/auth/import', { method: 'POST' }, 0),
  health: () => request<{ status: string; storage: string; knowledge: string; ai: string; aiConfigured: boolean }>('/health'),
  courseImage: (query: string) => request<{ image?: string }>(`/api/course-image?query=${encodeURIComponent(query)}`),
  workspace: (learnerId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}`),
  updateProfile: (learnerId: string, profile: LearnerProfile) => request<LearningWorkspace>(`/api/workspace/${learnerId}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) }),
  addGoal: (learnerId: string, body: { title: string; motivation: string; targetOutcome: string; background: string; preferences: string; courseTemplateId?: string }) => request<LearningWorkspace>(`/api/workspace/${learnerId}/goals`, json(body)),
  activateGoal: (learnerId: string, goalId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}/goals/${goalId}/activate`, { method: 'PUT' }),
  updateGoal: (learnerId: string, goalId: string, body: { title: string; motivation: string; targetOutcome: string }) => request<LearningWorkspace>(`/api/workspace/${learnerId}/goals/${goalId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  deleteGoal: (learnerId: string, goalId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}/goals/${goalId}`, { method: 'DELETE' }),
  chat: (learnerId: string, message: string) => request<ChatResponse>('/api/chat', json({ learnerId, message })),
  clearChat: (learnerId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}/conversation`, { method: 'DELETE' }),
  generateMaterial: (learnerId: string, goalId: string, owner: 'teacher' | 'builder', kind?: 'lesson' | 'practice-lab', topics?: string[]) => request<{ material: import('../shared/contracts').LearningMaterial; workspace: LearningWorkspace }>('/api/materials/generate', json({ learnerId, goalId, owner, kind, topics })),
  createPlacement: (learnerId: string, goalId: string) => request<PublicPlacementAssessment>('/api/assessments/placement', json({ learnerId, goalId })),
  submitPlacement: (learnerId: string, assessmentId: string, answers: number[]) => request<PlacementResult & { workspace: LearningWorkspace }>(`/api/assessments/${assessmentId}/submit`, json({ learnerId, answers })),
  research: (learnerId: string, goalId: string) => request<{ workspace: LearningWorkspace }>('/api/research/suggestions', json({ learnerId, goalId })),
  acceptSuggestion: (learnerId: string, suggestionId: string) => request<{ material: import('../shared/contracts').LearningMaterial; workspace: LearningWorkspace }>(`/api/research/suggestions/${suggestionId}/accept`, json({ learnerId })),
  uploadDocument: async (learnerId: string, file: File) => {
    const form = new FormData();
    form.append('learnerId', learnerId);
    form.append('document', file);
    return request<{ document: KnowledgeDocument; workspace: LearningWorkspace }>('/api/documents', { method: 'POST', body: form });
  },
  deleteDocument: (learnerId: string, documentId: string) => request<LearningWorkspace>(`/api/workspace/${learnerId}/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),
  runCode: (language: import('../shared/contracts').SupportedCodeLanguage, code: string, harness?: string) =>
    request<import('../shared/contracts').ExecutionResult>('/api/sandbox/run', json({ language, code, harness })),
  runTestCases: (challenge: import('../shared/contracts').CodingChallenge, studentCode: string) =>
    request<{ execution: import('../shared/contracts').ExecutionResult }>('/api/sandbox/run-tests', json({ challenge, studentCode })),
  evaluateCode: (challenge: import('../shared/contracts').CodingChallenge, studentCode: string, learnerId?: string, goalId?: string) =>
    request<{ evaluation: import('../shared/contracts').CodeEvaluationResponse; workspace?: LearningWorkspace }>('/api/sandbox/evaluate', json({ challenge, studentCode, learnerId, goalId })),
  generateCodingChallenge: (learnerId: string, materialId: string, forceNew?: boolean) =>
    request<{ challenge: import('../shared/contracts').CodingChallenge; workspace: LearningWorkspace }>(`/api/materials/${materialId}/coding-challenge`, json({ learnerId, forceNew })),
};

