import {
  ArrowForwardRounded,
  AutoStoriesRounded,
  BoltRounded,
  CheckRounded,
  CloudUploadRounded,
  DescriptionRounded,
  TrackChangesRounded,
  SearchRounded,
} from '@mui/icons-material';
import { motion } from 'motion/react';
import type { AgentId, LearningMaterial, LearningWorkspace, ResearchSuggestion } from '../../shared/contracts';

type Props = {
  workspace: LearningWorkspace;
  activeAgent?: AgentId;
  onAddGoal: () => void;
  onMemory: () => void;
  onAgentAction: (agent: 'teacher' | 'builder' | 'assessor' | 'researcher') => void;
  onOpenMaterial: (material: LearningMaterial) => void;
  onAcceptSuggestion: (suggestion: ResearchSuggestion) => void;
  onUpload: () => void;
};

export function WorkspaceCanvas({ workspace, activeAgent, onAddGoal, onMemory, onAgentAction, onOpenMaterial, onAcceptSuggestion, onUpload }: Props) {
  const goal = workspace.goals.find((item) => item.status === 'active');
  const materials = workspace.materials.filter((item) => !goal || item.goalId === goal.id);
  const suggestions = workspace.suggestions.filter((item) => item.status === 'suggested' && (!goal || item.goalId === goal.id));
  return (
    <div className="workspace-canvas">
      <section className="coordinator-card">
        <div className="coordinator-icon"><TrackChangesRounded /></div>
        <div><span>YOUR CURRENT DIRECTION</span><h1>{goal ? goal.title : 'What would you like to become better at?'}</h1><p>{goal ? `${goal.targetOutcome || goal.motivation || 'Your active learning goal'} · Your context and progress will stay connected as you learn.` : 'Start with a goal and a little background. AdaptLearn will shape the right next steps around you.'}</p></div>
        <button onClick={onMemory}>View profile</button>
      </section>

      {goal && <section className="goal-strip"><div><span>ACTIVE GOAL</span><strong>{goal.title}</strong></div><p>{goal.motivation || 'No motivation recorded yet.'}</p><div className="goal-progress"><span>{workspace.progress.level}</span><b>{workspace.progress.xp} XP</b></div></section>}

      <section className="materials-section">
        <div className="section-heading"><div><span>LESSON LIBRARY</span><h2>{materials.length ? 'Ready to learn' : 'No lessons yet'}</h2></div><div><button onClick={onUpload}><CloudUploadRounded /> Add documentation</button>{goal && <button className="primary-small" disabled={Boolean(activeAgent)} onClick={() => onAgentAction('teacher')}><SearchRounded /> Find &amp; create lesson</button>}</div></div>
        {workspace.documents.length > 0 && <div className="knowledge-strip"><DescriptionRounded /><div><strong>{workspace.documents.length} uploaded {workspace.documents.length === 1 ? 'document' : 'documents'} ready</strong><span>{workspace.documents.slice(0, 3).map((document) => document.name).join(' · ')}{workspace.documents.length > 3 ? ` · +${workspace.documents.length - 3} more` : ''}</span><small>Text is extracted locally. Relevant excerpts are sent to OpenAI only when creating a lesson.</small></div></div>}
        {materials.length === 0 ? <div className="empty-materials"><span><AutoStoriesRounded /></span><h3>Create something you can learn from.</h3><p>The lesson library starts empty. The app will search current public sources and combine them with any relevant documentation you upload.</p>{!goal && <button onClick={onAddGoal}>Add your first goal <ArrowForwardRounded /></button>}{goal && <div><button disabled={Boolean(activeAgent)} onClick={() => onAgentAction('teacher')}><SearchRounded /> Find &amp; create lesson</button><button disabled={Boolean(activeAgent)} onClick={() => onAgentAction('builder')}><BoltRounded /> Create practice activity</button></div>}</div> : <div className="material-grid">{materials.map((material) => <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} onClick={() => onOpenMaterial(material)} className={`material-card ${material.owner}`} key={material.id}><span>{material.kind === 'practice-lab' ? 'PRACTICE ACTIVITY' : 'SOURCED LESSON'}</span><strong>{material.title}</strong><p>{material.summary}</p><small>{material.sections.length} sections{material.sources?.length ? ` · ${material.sources.length} sources` : ''} <ArrowForwardRounded /></small></motion.button>)}</div>}
      </section>

      <section className="research-section">
        <div className="section-heading"><div><span>FRESH IDEAS</span><h2>Optional, until you approve</h2></div>{goal && <button disabled={Boolean(activeAgent)} onClick={() => onAgentAction('researcher')}><SearchRounded /> What&apos;s new?</button>}</div>
        {!goal ? <p className="quiet-state">Suggestions begin after you add a goal, so they stay relevant.</p> : suggestions.length === 0 ? <p className="quiet-state">{activeAgent === 'researcher' ? 'Checking current sources…' : 'No pending suggestions. Use “What’s new?” whenever you want a fresh check.'}</p> : <div className="suggestion-list">{suggestions.map((suggestion) => <article key={suggestion.id}><div><span>CURRENT · OPTIONAL</span><h3>{suggestion.title}</h3><p>{suggestion.summary}</p><small>{suggestion.whyRelevant}</small>{suggestion.sourceUrl && <a href={suggestion.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}</div><button disabled={Boolean(activeAgent)} onClick={() => onAcceptSuggestion(suggestion)}><CheckRounded /> Add to learning path</button></article>)}</div>}
      </section>
    </div>
  );
}
