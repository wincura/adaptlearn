'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, Snackbar } from '@mui/material';
import { api, type AuthSession } from '../../lib/api';
import type { CourseTemplate } from '../../lib/course-catalog';
import type { AgentId, KnowledgeDocument, LearnerProfile, LearningGoal, LearningMaterial, LearningWorkspace, PlacementResult, PublicPlacementAssessment, ResearchSuggestion } from '../../shared/contracts';
import { LearningChat } from './LearningChat';
import { CourseDetailHeader, CoursesPage, ProfilePage, ProgressPage, ReferenceShell, type PageView, type StudioView, useGoalBannerImage, WorkspacePage } from './ReferencePages';
import { DocumentsDialog, GoalDialog, GoalInput, LessonRequestDialog, MaterialDialog, MemoryDialog, PlacementDialog } from './WorkspaceDialogs';
import { WorkspaceCanvas } from './WorkspaceCanvas';

const defaultLearnerId = 'local-learner';
const offlineWorkspace: LearningWorkspace = { learnerId: defaultLearnerId, profile: { displayName: 'Learner', background: '', preferences: '' }, goals: [], documents: [], materials: [], suggestions: [], assessments: [], conversation: [], progress: { xp: 0, level: 'Unassessed', badges: [], completedAssessments: 0 }, updatedAt: new Date(0).toISOString() };

export function LearningStudio() {
  const [workspace, setWorkspace] = useState<LearningWorkspace>(offlineWorkspace);
  const [session, setSession] = useState<AuthSession>();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<StudioView>('workspace');
  const [detailReturnView, setDetailReturnView] = useState<PageView>('workspace');
  const [online, setOnline] = useState(false);
  const [aiConnected, setAIConnected] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId>();
  const [goalOpen, setGoalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<LearningGoal>();
  const [enrollmentTemplate, setEnrollmentTemplate] = useState<CourseTemplate>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [lessonRequestOpen, setLessonRequestOpen] = useState(false);
  const [material, setMaterial] = useState<LearningMaterial>();
  const [placement, setPlacement] = useState<PublicPlacementAssessment>();
  const [placementResult, setPlacementResult] = useState<PlacementResult>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const applyWorkspace = useCallback((current: LearningWorkspace) => {
    setWorkspace(current);

  }, []);

  useEffect(() => {
    const expired = () => setSessionExpired(true);
    window.addEventListener('adaptlearn:session-expired', expired);
    let cancelled = false;
    const initialize = async () => {
      try {
        const [auth, health] = await Promise.all([api.session(), api.health()]);
        const current = await api.workspace(auth.learnerId);
        if (cancelled) return;
        setSession(auth);
        setWorkspace(current);
        setOnline(true);
        setAIConnected(health.aiConfigured);
        if (auth.needsName) setMemoryOpen(true);
        const params = new URLSearchParams(window.location.search);
        const error = params.get('authError');
        if (error) setToast(error === 'import' ? 'Signed in. Your guest progress still needs to be imported. Please retry below.' : error === 'canceled' ? 'Sign-in canceled. Your guest work is still here.' : 'Sign-in could not be completed. Please try again.');
        else if (params.has('signedIn')) setToast('Signed in. Your progress is saved to your account.');
        if (error || params.has('signedIn')) window.history.replaceState(null, '', window.location.pathname);
      } catch (error) { if (!cancelled) setToast(error instanceof Error ? error.message : 'Could not load your session.'); }
      finally { if (!cancelled) setInitializing(false); }
    };
    void initialize();
    return () => { cancelled = true; window.removeEventListener('adaptlearn:session-expired', expired); };
  }, []);

  const retryImport = async () => {
    setBusy(true);
    try {
      await api.importGuest();
      const auth = await api.session();
      setSession(auth);
      applyWorkspace(await api.workspace(auth.learnerId));
      setToast('Your guest progress is now saved to your account.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Import failed. Your guest work is safe; please retry.'); }
    finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    try { await api.logout(); }
    catch (error) { setToast(error instanceof Error ? error.message : 'Could not sign out.'); setBusy(false); }
  };

  const learnerId = workspace.learnerId;

  const activeGoal = workspace.goals.find((goal) => goal.status === 'active');
  const activeGoalBannerImage = useGoalBannerImage(activeGoal);
  const completedPlacement = activeGoal && workspace.assessments
    .filter((assessment) => assessment.goalId === activeGoal.id && assessment.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];

  const openPlacementForGoal = async () => {
    if (!activeGoal) return;
    setActiveAgent('assessor');
    try {
      const assessment = await api.createPlacement(learnerId, activeGoal.id);
      setPlacementResult(undefined);
      setPlacement(assessment);
    } finally { setActiveAgent(undefined); }
  };

  const runResearch = useCallback(async () => {
    if (!activeGoal || activeAgent) return;
    setActiveAgent('researcher');
    try {
      const result = await api.research(learnerId, activeGoal.id);
      applyWorkspace(result.workspace);
      setToast(result.workspace.suggestions.length ? 'Useful updates or refreshers are ready.' : 'No update or refresher was useful enough to suggest.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'The update search could not be completed.');
    } finally { setActiveAgent(undefined); }
  }, [activeAgent, activeGoal, applyWorkspace, learnerId]);

  const addGoal = async (input: GoalInput) => {
    setBusy(true);
    let goalSaved = false;
    try {
      const current = await api.addGoal(learnerId, input);
      applyWorkspace(current);
      setGoalOpen(false);
      goalSaved = true;
      const newGoal = current.goals.find((goal) => goal.status === 'active');
      if (!newGoal) throw new Error('The new active goal could not be found.');
      if (input.courseTemplateId) { setDetailReturnView('courses'); setView('course-detail'); }
      setActiveAgent('assessor');
      const assessment = await api.createPlacement(learnerId, newGoal.id);
      setPlacementResult(undefined);
      setPlacement(assessment);
      setToast('Goal saved. Start with this placement test.');
    } catch (error) {
      setToast(goalSaved
        ? `Goal saved, but the placement test could not be prepared: ${error instanceof Error ? error.message : 'unknown error'}`
        : error instanceof Error ? error.message : 'Could not save the goal.');
    } finally { setBusy(false); setActiveAgent(undefined); }
  };

  const updateGoal = async (input: GoalInput) => {
    if (!editingGoal) return;
    setBusy(true);
    try {
      applyWorkspace(await api.updateGoal(learnerId, editingGoal.id, input));
      setGoalOpen(false);
      setEditingGoal(undefined);
      setToast('Learning goal updated. Future lessons will use the new focus.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update the learning goal.'); }
    finally { setBusy(false); }
  };

  const deleteGoal = async () => {
    if (!activeGoal || activeAgent) return;
    if (!window.confirm(`Delete “${activeGoal.title}” and its lessons, suggestions, and assessments? This cannot be undone.`)) return;
    setBusy(true);
    try {
      applyWorkspace(await api.deleteGoal(learnerId, activeGoal.id));
      setMaterial(undefined);
      setPlacement(undefined);
      setPlacementResult(undefined);
      setToast('Learning goal and its progress were deleted.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not delete the learning goal.'); }
    finally { setBusy(false); }
  };

  const saveProfile = async (profile: LearnerProfile) => {
    setBusy(true);
    try {
      applyWorkspace(await api.updateProfile(learnerId, profile));
      setSession((current) => current ? { ...current, needsName: false, displayName: profile.displayName } : current);
      setToast('Profile updated. Future lessons will use these details.');
      setMemoryOpen(false);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update the profile.'); }
    finally { setBusy(false); }
  };

  const activateGoal = async (goalId: string) => {
    if (goalId === activeGoal?.id || activeAgent) return;
    setBusy(true);
    try {
      const current = await api.activateGoal(learnerId, goalId);
      applyWorkspace(current);
      setMaterial(undefined);
      setPlacement(undefined);
      setPlacementResult(undefined);
      const selected = current.goals.find((goal) => goal.id === goalId);
      setToast(`${selected?.title ?? 'Learning goal'} is now active.`);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not switch learning goals.'); }
    finally { setBusy(false); }
  };

  const openGoalDetail = async (goalId: string, returnView: PageView) => {
    setDetailReturnView(returnView);
    if (goalId !== activeGoal?.id) await activateGoal(goalId);
    setView('course-detail');
  };

  const openTemplate = (template: CourseTemplate) => {
    const enrolledGoal = workspace.goals.find((goal) => goal.courseTemplateId === template.id);
    if (enrolledGoal) { void openGoalDetail(enrolledGoal.id, 'courses'); return; }
    setEnrollmentTemplate(template);
    setEditingGoal(undefined);
    setGoalOpen(true);
  };

  const requestLesson = async () => {
    if (!activeGoal) { setGoalOpen(true); return; }
    if (!completedPlacement) {
      try {
        await openPlacementForGoal();
        setToast('Complete this placement test first so the lesson matches your current level.');
      } catch (error) { setToast(error instanceof Error ? error.message : 'The placement test could not be prepared.'); }
      return;
    }
    setLessonRequestOpen(true);
  };

  const createLesson = async (topics: string[]) => {
    if (!activeGoal || !completedPlacement) return;
    setBusy(true);
    setActiveAgent('teacher');
    try {
      const result = await api.generateMaterial(learnerId, activeGoal.id, 'teacher', 'lesson', topics);
      applyWorkspace(result.workspace);
      setLessonRequestOpen(false);
      setMaterial(result.material);
      setToast('Your researched lesson and quiz are ready.');
    } catch (error) { setToast(error instanceof Error ? error.message : 'The lesson could not be completed.'); }
    finally { setBusy(false); setActiveAgent(undefined); }
  };

  const runAgentAction = async (agent: 'builder' | 'assessor' | 'researcher') => {
    if (!activeGoal) { setGoalOpen(true); return; }
    if (agent === 'researcher') { await runResearch(); return; }
    setActiveAgent(agent);
    try {
      if (agent === 'assessor') { const assessment = await api.createPlacement(learnerId, activeGoal.id); setPlacementResult(undefined); setPlacement(assessment); }
      else { const result = await api.generateMaterial(learnerId, activeGoal.id, 'builder', 'practice-lab'); applyWorkspace(result.workspace); setMaterial(result.material); setToast('Your practice activity is ready.'); }
    } catch (error) { setToast(error instanceof Error ? error.message : 'That request could not be completed.'); }
    finally { setActiveAgent(undefined); }
  };

  const submitPlacement = async (answers: number[]) => {
    if (!placement) return;
    setBusy(true); setActiveAgent('assessor');
    try { const result = await api.submitPlacement(learnerId, placement.id, answers); applyWorkspace(result.workspace); setPlacementResult(result); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The test could not be scored.'); }
    finally { setBusy(false); setActiveAgent(undefined); }
  };

  const acceptSuggestion = async (suggestion: ResearchSuggestion) => {
    if (!activeGoal || suggestion.goalId !== activeGoal.id) return;
    if (!completedPlacement) {
      try {
        await openPlacementForGoal();
        setToast('Complete this placement test first so the suggested lesson matches your current level.');
      } catch (error) { setToast(error instanceof Error ? error.message : 'The placement test could not be prepared.'); }
      return;
    }
    setActiveAgent('teacher');
    try { const result = await api.acceptSuggestion(learnerId, suggestion.id); applyWorkspace(result.workspace); setMaterial(result.material); setToast('Added. Your sourced optional lesson and quiz are ready.'); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The optional learning page could not be created.'); }
    finally { setActiveAgent(undefined); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { const result = await api.uploadDocument(learnerId, file); applyWorkspace(result.workspace); setToast(`${result.document.name} is ready to ground future lessons.`); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The source could not be stored.'); }
    event.target.value = '';
  };

  const deleteDocument = async (document: KnowledgeDocument) => {
    if (busy) return;
    if (!window.confirm(`Delete “${document.name}” from this learner profile? It will no longer be available to ground lessons.`)) return;
    setBusy(true);
    try {
      applyWorkspace(await api.deleteDocument(learnerId, document.id));
      setToast(`${document.name} was deleted.`);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not delete the document.'); }
    finally { setBusy(false); }
  };

  const openNewGoal = () => { setEditingGoal(undefined); setEnrollmentTemplate(undefined); setGoalOpen(true); };
  const openGoalEditor = () => { if (activeGoal) { setEditingGoal(activeGoal); setEnrollmentTemplate(undefined); setGoalOpen(true); } };

  const page = view === 'workspace' ? <WorkspacePage workspace={workspace} onNavigate={setView} onAddGoal={openNewGoal} onOpenGoal={openGoalDetail} />
    : view === 'courses' ? <CoursesPage workspace={workspace} onOpenGoal={openGoalDetail} onOpenTemplate={openTemplate} />
    : view === 'progress' ? <ProgressPage workspace={workspace} />
    : view === 'profile' ? <ProfilePage workspace={workspace} onManageProfiles={() => setMemoryOpen(true)} onSaveProfile={saveProfile} onOpenGoal={openGoalDetail} />
    : <div className="reference-course-detail"><CourseDetailHeader workspace={workspace} online={online} aiConnected={aiConnected} onBack={() => setView(detailReturnView)} onAddGoal={openNewGoal} /><WorkspaceCanvas workspace={workspace} bannerImage={activeGoalBannerImage} activeAgent={activeAgent} onAddGoal={openNewGoal} onActivateGoal={(goalId) => void activateGoal(goalId)} onEditGoal={openGoalEditor} onDeleteGoal={() => void deleteGoal()} onDocuments={() => setDocumentsOpen(true)} onMemory={() => setMemoryOpen(true)} onCreateLesson={() => void requestLesson()} onAgentAction={(agent) => void runAgentAction(agent)} onOpenMaterial={setMaterial} onAcceptSuggestion={(suggestion) => void acceptSuggestion(suggestion)} onUpload={() => fileInput.current?.click()} /></div>;

  return <ReferenceShell active={view} workspace={workspace} session={session} onSignIn={api.login} onSignOut={() => void logout()} onNavigate={setView} onManageProfiles={() => setMemoryOpen(true)}>{initializing ? <div className="auth-notice" role="status">Loading your learning workspace…</div> : !session && !sessionExpired ? <div className="auth-notice" role="alert">Could not load your workspace. <button onClick={() => window.location.reload()}>Retry</button></div> : page}{session?.importPending && <div className="auth-notice" role="alert">Your guest work has not finished importing. <button disabled={busy} onClick={() => void retryImport()}>{busy ? 'Importing…' : 'Retry import'}</button></div>}{sessionExpired && <Dialog open aria-labelledby="session-expired-title"><DialogTitle id="session-expired-title">Your session expired</DialogTitle><DialogContent className="auth-session-card"><p>Sign in again to continue with your saved progress.</p><button onClick={api.login}>Sign up / Sign in</button><button disabled={busy} onClick={() => void logout()}>Start a new guest session</button></DialogContent></Dialog>}<LearningChat workspace={workspace} online={online && aiConnected} onWorkspace={applyWorkspace} onWorking={(working) => setActiveAgent(working ? 'coordinator' : undefined)} onError={setToast} /><input ref={fileInput} hidden type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={upload} />{goalOpen && <GoalDialog open busy={busy} profile={workspace.profile} editing={Boolean(editingGoal)} templateName={enrollmentTemplate?.title} initial={editingGoal ? { title: editingGoal.title, motivation: editingGoal.motivation, targetOutcome: editingGoal.targetOutcome } : enrollmentTemplate ? { title: enrollmentTemplate.title, motivation: enrollmentTemplate.motivation, targetOutcome: enrollmentTemplate.targetOutcome, courseTemplateId: enrollmentTemplate.id } : undefined} onClose={() => { setGoalOpen(false); setEditingGoal(undefined); setEnrollmentTemplate(undefined); }} onSubmit={editingGoal ? updateGoal : addGoal} />}{lessonRequestOpen && <LessonRequestDialog open busy={busy} onClose={() => setLessonRequestOpen(false)} onSubmit={createLesson} />}{memoryOpen && <MemoryDialog open busy={busy} needsName={session?.needsName} workspace={workspace} onClose={() => setMemoryOpen(false)} onSave={saveProfile} />}{documentsOpen && <DocumentsDialog open busy={busy} documents={workspace.documents} onClose={() => setDocumentsOpen(false)} onDelete={deleteDocument} />}<MaterialDialog material={material} learnerId={learnerId} onWorkspaceUpdated={applyWorkspace} onClose={() => setMaterial(undefined)} /><PlacementDialog key={placement?.id ?? 'no-placement'} assessment={placement} busy={busy} result={placementResult} onClose={() => { setPlacement(undefined); setPlacementResult(undefined); }} onSubmit={submitPlacement} /><Snackbar open={Boolean(toast)} autoHideDuration={5200} onClose={() => setToast('')} message={toast} /></ReferenceShell>;
}
