import {
  ArrowForwardRounded,
  AddRounded,
  AutoStoriesRounded,
  BoltRounded,
  CheckRounded,
  CloudUploadRounded,
  DescriptionRounded,
  DeleteOutlineRounded,
  EditRounded,
  ReplayRounded,
  TrackChangesRounded,
  SearchRounded,
} from '@mui/icons-material';
import { motion } from 'motion/react';
import type { AgentId, LearningMaterial, LearningWorkspace, ResearchSuggestion } from '../../shared/contracts';

type Props = {
  workspace: LearningWorkspace;
  activeAgent?: AgentId;
  onAddGoal: () => void;
  onActivateGoal: (goalId: string) => void;
  onEditGoal: () => void;
  onDeleteGoal: () => void;
  onDocuments: () => void;
  onMemory: () => void;
  onCreateLesson: () => void;
  onAgentAction: (agent: 'builder' | 'assessor' | 'researcher') => void;
  onOpenMaterial: (material: LearningMaterial) => void;
  onAcceptSuggestion: (suggestion: ResearchSuggestion) => void;
  onUpload: () => void;
};

export function WorkspaceCanvas({ workspace, activeAgent, onAddGoal, onActivateGoal, onEditGoal, onDeleteGoal, onDocuments, onMemory, onCreateLesson, onAgentAction, onOpenMaterial, onAcceptSuggestion, onUpload }: Props) {
  const goal = workspace.goals.find((item) => item.status === 'active');
  const readyDocuments = workspace.documents.filter((document) => document.status === 'ready');
  const processingDocuments = workspace.documents.filter((document) => document.status === 'processing');
  const materials = workspace.materials.filter((item) => !goal || item.goalId === goal.id);
  const completedPlacement = goal && workspace.assessments
    .filter((assessment) => assessment.goalId === goal.id && assessment.completedAt)
    .sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
  const coveredTopics = [...new Set(materials
    .filter((material) => material.kind === 'lesson')
    .flatMap((material) => material.topics?.length ? material.topics : [material.title]))];
  const suggestions = workspace.suggestions.filter((item) => item.status === 'suggested' && (!goal || item.goalId === goal.id));
  return (
    <div className="workspace-canvas">
      <section className="coordinator-card">
        <div className="coordinator-icon"><TrackChangesRounded /></div>
        <div><span>YOUR CURRENT DIRECTION</span><h1>{goal ? goal.title : 'What would you like to become better at?'}</h1><p>{goal ? goal.targetOutcome || goal.motivation || 'Your active learning goal' : 'Start with a goal and a little background. AdaptLearn will shape the right next steps around you.'}</p></div>
        <button onClick={onMemory}>View profile</button>
      </section>

      {goal && <section className="goal-strip"><div className="goal-switcher"><span>ACTIVE GOAL · {workspace.goals.length} SAVED</span><div><select aria-label="Switch active learning goal" disabled={Boolean(activeAgent)} value={goal.id} onChange={(event) => onActivateGoal(event.target.value)}>{workspace.goals.map((savedGoal) => <option value={savedGoal.id} key={savedGoal.id}>{savedGoal.title}</option>)}</select><button aria-label="Edit active learning goal" title="Edit goal" disabled={Boolean(activeAgent)} onClick={onEditGoal}><EditRounded /></button><button className="danger" aria-label="Delete active learning goal" title="Delete goal" disabled={Boolean(activeAgent)} onClick={onDeleteGoal}><DeleteOutlineRounded /></button></div></div><div className="goal-progress"><span>{completedPlacement?.level ?? 'Placement test needed'}</span><b>{workspace.progress.xp} XP</b><button className="assessment-test-button" disabled={Boolean(activeAgent)} onClick={() => onAgentAction('assessor')}>{completedPlacement ? <ReplayRounded /> : <TrackChangesRounded />}{completedPlacement ? 'Take assessment test' : 'Take placement test'}</button></div></section>}

      <section className="materials-section">
        <div className="section-heading"><div><span>LESSON LIBRARY</span><h2>{materials.length ? 'Ready to learn' : 'No lessons yet'}</h2></div><div><button onClick={onUpload}><CloudUploadRounded /> Add documentation</button>{goal && <button className="primary-small" disabled={Boolean(activeAgent)} onClick={onCreateLesson}>{completedPlacement ? <AddRounded /> : <TrackChangesRounded />} {completedPlacement ? 'Create next lesson' : 'Take placement test first'}</button>}</div></div>
        {workspace.documents.length > 0 && <div className="knowledge-strip"><DescriptionRounded /><div><strong>{readyDocuments.length} uploaded {readyDocuments.length === 1 ? 'document' : 'documents'} ready{processingDocuments.length ? ` · ${processingDocuments.length} indexing` : ''}</strong><span>{workspace.documents.slice(0, 3).map((document) => document.name).join(' · ')}{workspace.documents.length > 3 ? ` · +${workspace.documents.length - 3} more` : ''}</span></div><button onClick={onDocuments}>Browse documents</button></div>}
        {coveredTopics.length > 0 && <div className="topic-history"><span>COVERED SO FAR</span><div>{coveredTopics.map((topic) => <small key={topic}>{topic}</small>)}</div></div>}
        {materials.length === 0 ? <div className="empty-materials"><span><AutoStoriesRounded /></span><h3>Create something you can learn from.</h3><p>{completedPlacement ? 'Choose the focus for your first lesson, or let AdaptLearn decide.' : 'Start with the placement test. Its result determines the difficulty and teaching style of every lesson for this goal.'}</p>{!goal && <button onClick={onAddGoal}>Add your first goal <ArrowForwardRounded /></button>}{goal && <div><button disabled={Boolean(activeAgent)} onClick={onCreateLesson}>{completedPlacement ? <AddRounded /> : <TrackChangesRounded />} {completedPlacement ? 'Create first lesson' : 'Take placement test'}</button><button disabled={Boolean(activeAgent)} onClick={() => onAgentAction('builder')}><BoltRounded /> Create practice activity</button></div>}</div> : <div className="material-grid">{materials.map((material) => <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={() => onOpenMaterial(material)} className={`material-card ${material.owner}`} key={material.id}><span>{material.kind === 'practice-lab' ? 'PRACTICE ACTIVITY' : 'SOURCED LESSON'}</span><strong>{material.title}</strong><p>{material.summary}</p><small>{material.assessedLevel ? `${material.assessedLevel} · ` : ''}{material.sections.length} sections{material.sources?.length ? ` · ${material.sources.length} sources` : ''} <ArrowForwardRounded /></small></motion.button>)}</div>}
      </section>

      <section className="research-section">
        <div className="section-heading"><div><span>FRESH IDEAS</span><h2>Optional, until you approve</h2></div>{goal && <button disabled={Boolean(activeAgent)} onClick={() => onAgentAction('researcher')}><SearchRounded /> What&apos;s new?</button>}</div>
        {!goal ? <p className="quiet-state">Suggestions begin after you add a goal, so they stay relevant.</p> : suggestions.length === 0 ? <p className="quiet-state">{activeAgent === 'researcher' ? 'Checking current sources…' : 'No pending suggestions. Use “What’s new?” whenever you want a fresh check.'}</p> : <div className="suggestion-list">{suggestions.map((suggestion) => <article key={suggestion.id}><div><span>CURRENT · OPTIONAL</span><h3>{suggestion.title}</h3><p>{suggestion.summary}</p><small>{suggestion.whyRelevant}</small>{suggestion.sourceUrl && <a href={suggestion.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}</div><button disabled={Boolean(activeAgent)} onClick={() => onAcceptSuggestion(suggestion)}><CheckRounded /> Add to learning path</button></article>)}</div>}
      </section>
    </div>
  );
}
