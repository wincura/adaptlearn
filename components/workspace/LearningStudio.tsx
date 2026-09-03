'use client';

import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AddRounded, AutoAwesomeRounded, HubRounded, MemoryRounded } from '@mui/icons-material';
import { Snackbar } from '@mui/material';
import { api } from '../../lib/api';
import type { AgentId, LearnerProfile, LearningMaterial, LearningWorkspace, PublicPlacementAssessment, ResearchSuggestion } from '../../shared/contracts';
import { LearningChat } from './LearningChat';
import { GoalDialog, GoalInput, MaterialDialog, MemoryDialog, PlacementDialog } from './WorkspaceDialogs';
import { WorkspaceCanvas } from './WorkspaceCanvas';

const learnerId = 'local-learner';
const offlineWorkspace: LearningWorkspace = { learnerId, profile: { displayName: 'Learner', background: '', preferences: '' }, goals: [], documents: [], materials: [], suggestions: [], assessments: [], conversation: [], progress: { xp: 0, level: 'Unassessed', badges: [], completedAssessments: 0 }, updatedAt: new Date(0).toISOString() };

export function LearningStudio() {
  const [workspace, setWorkspace] = useState<LearningWorkspace>(offlineWorkspace);
  const [online, setOnline] = useState(false);
  const [aiConnected, setAIConnected] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentId>();
  const [goalOpen, setGoalOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [material, setMaterial] = useState<LearningMaterial>();
  const [placement, setPlacement] = useState<PublicPlacementAssessment>();
  const [placementResult, setPlacementResult] = useState<{ score: number; level: string; xpAwarded: number; badgeAwarded?: string }>();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const startupResearchAttempted = useRef(false);

  useEffect(() => {
    Promise.all([api.workspace(learnerId), api.health()]).then(([current, health]) => { setWorkspace(current); setOnline(true); setAIConnected(health.aiConfigured); }).catch((error) => setToast(error instanceof Error ? error.message : 'The local API is offline.'));
  }, []);

  const activeGoal = workspace.goals.find((goal) => goal.status === 'active');
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

  const runResearch = useCallback(async (silent = false) => {
    if (!activeGoal || activeAgent) return;
    setActiveAgent('researcher');
    try {
      const result = await api.research(learnerId, activeGoal.id);
      setWorkspace(result.workspace);
      if (!silent) setToast(result.workspace.suggestions.length ? 'Fresh suggestions are ready.' : 'No material updates were useful enough to suggest.');
    } catch (error) {
      if (!silent) setToast(error instanceof Error ? error.message : 'The update search could not be completed.');
    } finally { setActiveAgent(undefined); }
  }, [activeAgent, activeGoal]);

  useEffect(() => {
    if (!online || !aiConnected || !activeGoal || startupResearchAttempted.current) return;
    if (workspace.suggestions.some((suggestion) => suggestion.goalId === activeGoal.id && suggestion.status === 'suggested')) return;
    startupResearchAttempted.current = true;
    const timeout = window.setTimeout(() => void runResearch(true), 500);
    return () => window.clearTimeout(timeout);
  }, [activeGoal, aiConnected, online, runResearch, workspace.suggestions]);

  const addGoal = async (input: GoalInput) => {
    setBusy(true);
    let goalSaved = false;
    try {
      const current = await api.addGoal(learnerId, input);
      setWorkspace(current);
      startupResearchAttempted.current = false;
      setGoalOpen(false);
      goalSaved = true;
      const newGoal = current.goals.find((goal) => goal.status === 'active');
      if (!newGoal) throw new Error('The new active goal could not be found.');
      setActiveAgent('assessor');
      const assessment = await api.createPlacement(learnerId, newGoal.id);
      setPlacementResult(undefined);
      setPlacement(assessment);
      setToast('Goal saved. Start with this short placement check.');
    } catch (error) {
      setToast(goalSaved
        ? `Goal saved, but the placement check could not be prepared: ${error instanceof Error ? error.message : 'unknown error'}`
        : error instanceof Error ? error.message : 'Could not save the goal.');
    } finally { setBusy(false); setActiveAgent(undefined); }
  };

  const saveProfile = async (profile: LearnerProfile) => {
    setBusy(true);
    try {
      setWorkspace(await api.updateProfile(learnerId, profile));
      setToast('Profile updated. Future lessons will use these details.');
      setMemoryOpen(false);
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update the profile.'); }
    finally { setBusy(false); }
  };

  const runAgentAction = async (agent: 'teacher' | 'builder' | 'assessor' | 'researcher') => {
    if (!activeGoal) { setGoalOpen(true); return; }
    if (agent === 'researcher') { await runResearch(); return; }
    if (agent === 'teacher' && !completedPlacement) {
      try {
        await openPlacementForGoal();
        setToast('Complete this placement check first so the lesson matches your current level.');
      } catch (error) { setToast(error instanceof Error ? error.message : 'The placement check could not be prepared.'); }
      return;
    }
    setActiveAgent(agent);
    try {
      if (agent === 'assessor') { const assessment = await api.createPlacement(learnerId, activeGoal.id); setPlacementResult(undefined); setPlacement(assessment); }
      else { const result = await api.generateMaterial(learnerId, activeGoal.id, agent, agent === 'builder' ? 'practice-lab' : 'lesson'); setWorkspace(result.workspace); setMaterial(result.material); setToast(agent === 'teacher' ? 'Your researched lesson is ready.' : 'Your practice activity is ready.'); }
    } catch (error) { setToast(error instanceof Error ? error.message : 'That request could not be completed.'); }
    finally { setActiveAgent(undefined); }
  };

  const submitPlacement = async (answers: number[]) => {
    if (!placement) return;
    setBusy(true); setActiveAgent('assessor');
    try { const result = await api.submitPlacement(learnerId, placement.id, answers); setWorkspace(result.workspace); setPlacementResult(result); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The placement check could not be scored.'); }
    finally { setBusy(false); setActiveAgent(undefined); }
  };

  const acceptSuggestion = async (suggestion: ResearchSuggestion) => {
    if (!activeGoal || suggestion.goalId !== activeGoal.id) return;
    if (!completedPlacement) {
      try {
        await openPlacementForGoal();
        setToast('Complete this placement check first so the suggested lesson matches your current level.');
      } catch (error) { setToast(error instanceof Error ? error.message : 'The placement check could not be prepared.'); }
      return;
    }
    setActiveAgent('teacher');
    try { const result = await api.acceptSuggestion(learnerId, suggestion.id); setWorkspace(result.workspace); setMaterial(result.material); setToast('Added. Your sourced optional lesson is ready.'); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The optional learning page could not be created.'); }
    finally { setActiveAgent(undefined); }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { const result = await api.uploadDocument(learnerId, file); setWorkspace(result.workspace); setToast(`${result.document.name} is ready to ground future lessons.`); }
    catch (error) { setToast(error instanceof Error ? error.message : 'The source could not be stored.'); }
    event.target.value = '';
  };

  return <main className="studio-shell"><aside className="studio-nav"><button className="studio-logo" aria-label="AdaptLearn"><span>A</span></button><nav><button className="active"><HubRounded /> Workspace</button><button onClick={() => setMemoryOpen(true)}><MemoryRounded /> Profile &amp; progress</button></nav><div className="nav-profile"><span>{workspace.profile.displayName.slice(0,2).toUpperCase()}</span><div><strong>{workspace.profile.displayName}</strong><small>Local workspace</small></div></div></aside><section className="studio-main"><header className="studio-header"><div><p>ADAPTLEARN · PERSONAL WORKSPACE</p><h2>Build only what helps you learn</h2></div><div><span className={`connection-pill ${online && aiConnected ? 'online' : ''}`}>● {online ? aiConnected ? 'AI connected' : 'AI key unavailable' : 'Service offline'}</span><button onClick={() => setGoalOpen(true)}><AddRounded /> {activeGoal ? 'New goal' : 'Add goal'}</button><button className="whats-new" disabled={!activeGoal || Boolean(activeAgent)} onClick={() => void runResearch()}><AutoAwesomeRounded /> What&apos;s new?</button></div></header><WorkspaceCanvas workspace={workspace} activeAgent={activeAgent} onAddGoal={() => setGoalOpen(true)} onMemory={() => setMemoryOpen(true)} onAgentAction={(agent) => void runAgentAction(agent)} onOpenMaterial={setMaterial} onAcceptSuggestion={(suggestion) => void acceptSuggestion(suggestion)} onUpload={() => fileInput.current?.click()} /></section><LearningChat workspace={workspace} online={online && aiConnected} onWorkspace={setWorkspace} onWorking={(working) => setActiveAgent(working ? 'coordinator' : undefined)} onError={setToast} /><input ref={fileInput} hidden type="file" accept=".pdf,.docx,.txt,.md,.csv" onChange={upload} />{goalOpen && <GoalDialog open busy={busy} profile={workspace.profile} onClose={() => setGoalOpen(false)} onSubmit={addGoal} />}{memoryOpen && <MemoryDialog open busy={busy} workspace={workspace} onClose={() => setMemoryOpen(false)} onSave={saveProfile} />}<MaterialDialog material={material} onClose={() => setMaterial(undefined)} /><PlacementDialog key={placement?.id ?? 'no-placement'} assessment={placement} busy={busy} result={placementResult} onClose={() => { setPlacement(undefined); setPlacementResult(undefined); }} onSubmit={submitPlacement} /><Snackbar open={Boolean(toast)} autoHideDuration={5200} onClose={() => setToast('')} message={toast} /></main>;
}
