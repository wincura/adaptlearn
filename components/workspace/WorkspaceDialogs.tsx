'use client';

import { FormEvent, useState } from 'react';
import { ArrowForwardRounded, CheckRounded, CloseRounded, DeleteOutlineRounded, DescriptionRounded, PersonAddRounded, QuizRounded, ReplayRounded } from '@mui/icons-material';
import { Dialog, DialogContent, IconButton, LinearProgress } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { KnowledgeDocument, LearnerProfile, LearnerWorkspaceSummary, LearningMaterial, LearningWorkspace, LessonQuizQuestion, PlacementResult, PublicPlacementAssessment } from '../../shared/contracts';

export type GoalInput = { title: string; motivation: string; targetOutcome: string; background: string; preferences: string };

export function GoalDialog({ open, busy, profile, initial, onClose, onSubmit }: { open: boolean; busy: boolean; profile: LearnerProfile; initial?: Partial<GoalInput>; onClose: () => void; onSubmit: (input: GoalInput) => Promise<void> }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState<GoalInput>({ title: initial?.title ?? '', motivation: initial?.motivation ?? '', targetOutcome: initial?.targetOutcome ?? '', background: initial?.background ?? profile.background, preferences: initial?.preferences ?? profile.preferences });
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSubmit(form); };
  return <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}><IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton><DialogContent><span className="dialog-kicker">{editing ? 'LEARNING GOAL' : 'YOUR LEARNING PROFILE'}</span><h2>{editing ? 'Edit this learning goal' : 'Shape your learning goal'}</h2><p>{editing ? 'Changes apply to future lessons while your existing progress remains attached to this goal.' : 'This gives AdaptLearn enough context to personalize your experience. No materials are created until you ask.'}</p><form className="goal-form" onSubmit={submit}><label>What do you want to learn?<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Lead clearer project meetings" /></label><label>What exactly do you want to focus on?<textarea value={form.motivation} onChange={(event) => setForm({ ...form, motivation: event.target.value })} placeholder="Specific skills, situations, features, or topics to prioritize" /></label><label>What would success look like?<textarea value={form.targetOutcome} onChange={(event) => setForm({ ...form, targetOutcome: event.target.value })} placeholder="A practical outcome you want to reach" /></label>{!editing && <div className="form-pair"><label>Your current background<textarea value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} placeholder="What you already know" /></label><label>How you prefer to learn<textarea value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} placeholder="Examples, practice, conversation…" /></label></div>}<button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save goal'} <ArrowForwardRounded /></button></form></DialogContent></Dialog>;
}

export function LessonRequestDialog({ open, busy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (topics: string[]) => Promise<void> }) {
  const [mode, setMode] = useState<'auto' | 'topics'>('auto');
  const [ideas, setIdeas] = useState(['', '', '']);
  const topics = ideas.map((idea) => idea.trim()).filter(Boolean);
  const distinctTopics = new Set(topics.map((topic) => topic.toLocaleLowerCase()));
  const hasDuplicates = distinctTopics.size !== topics.length;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === 'topics' && (!topics.length || hasDuplicates)) return;
    await onSubmit(mode === 'auto' ? [] : topics);
  };
  return <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}>
    <IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton>
    <DialogContent>
      <span className="dialog-kicker teacher">NEXT LESSON</span>
      <h2>What should this lesson cover?</h2>
      <p>Choose up to three ideas, or let AdaptLearn choose what comes next.</p>
      <form className="lesson-request-form" onSubmit={submit}>
        <div className="lesson-choice-grid">
          <label className={mode === 'auto' ? 'selected' : ''}><input type="radio" name="lesson-mode" checked={mode === 'auto'} onChange={() => setMode('auto')} /><span><strong>Let the app decide</strong><small>Continue with a suitable next topic.</small></span></label>
          <label className={mode === 'topics' ? 'selected' : ''}><input type="radio" name="lesson-mode" checked={mode === 'topics'} onChange={() => setMode('topics')} /><span><strong>Choose the focus</strong><small>Enter one to three distinct ideas.</small></span></label>
        </div>
        {mode === 'topics' && <div className="lesson-topic-fields">{ideas.map((idea, index) => <label key={index}>Idea {index + 1}{index > 0 ? ' (optional)' : ''}<input autoFocus={index === 0} required={index === 0} maxLength={120} value={idea} onChange={(event) => setIdeas(ideas.map((current, ideaIndex) => ideaIndex === index ? event.target.value : current))} placeholder={index === 0 ? 'e.g. Asking for directions' : 'Add another distinct idea'} /></label>)}{hasDuplicates && <p>Please enter distinct ideas only.</p>}</div>}
        <div className="lesson-request-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="dialog-primary" disabled={busy || (mode === 'topics' && (!topics.length || hasDuplicates))}>{busy ? 'Creating…' : 'Create lesson'} <ArrowForwardRounded /></button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function MemoryDialog({ open, busy, workspace, profiles, onClose, onSwitch, onCreate, onDelete, onSave }: { open: boolean; busy: boolean; workspace: LearningWorkspace; profiles: LearnerWorkspaceSummary[]; onClose: () => void; onSwitch: (learnerId: string) => Promise<void>; onCreate: (profile: LearnerProfile) => Promise<void>; onDelete: () => Promise<void>; onSave: (profile: LearnerProfile) => Promise<void> }) {
  const goal = workspace.goals.find((item) => item.status === 'active');
  const [form, setForm] = useState<LearnerProfile>(workspace.profile);
  const [creating, setCreating] = useState(false);
  const [newProfile, setNewProfile] = useState<LearnerProfile>({ displayName: '', background: '', preferences: '' });
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave(form); };
  const create = async (event: FormEvent) => { event.preventDefault(); await onCreate(newProfile); };
  return <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}>
    <IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton>
    <DialogContent>
      <span className="dialog-kicker">PROFILES &amp; PROGRESS</span>
      <h2>{creating ? 'Create a learner profile' : 'Manage learner profiles'}</h2>
      <p>Choose who is learning or update their details.</p>
      {creating ? (
        <form className="goal-form profile-form" onSubmit={create}>
          <label>Display name<input required maxLength={100} value={newProfile.displayName} onChange={(event) => setNewProfile({ ...newProfile, displayName: event.target.value })} placeholder="Learner name" /></label>
          <label>Current background<textarea maxLength={1500} value={newProfile.background} onChange={(event) => setNewProfile({ ...newProfile, background: event.target.value })} placeholder="Experience, role, or what this learner already knows" /></label>
          <label>How this learner prefers to learn<textarea maxLength={1000} value={newProfile.preferences} onChange={(event) => setNewProfile({ ...newProfile, preferences: event.target.value })} placeholder="Examples, guided practice, conversation…" /></label>
          <div className="profile-form-actions"><button type="button" disabled={busy} onClick={() => setCreating(false)}>Cancel</button><button className="dialog-primary" disabled={busy}>{busy ? 'Creating…' : 'Create profile'} <ArrowForwardRounded /></button></div>
        </form>
      ) : <>
        <div className="profile-selector">
          <div><span>CURRENT LEARNER</span><strong>Choose a profile</strong></div>
          <select aria-label="Select learner profile" disabled={busy} value={workspace.learnerId} onChange={(event) => void onSwitch(event.target.value)}>{profiles.map((profile) => <option value={profile.learnerId} key={profile.learnerId}>{profile.displayName} · {profile.xp} XP · {profile.goalCount} goals</option>)}</select>
          <button className="new-profile-button" type="button" disabled={busy} onClick={() => setCreating(true)}><PersonAddRounded /> New profile</button>
        </div>
        <form className="goal-form profile-form" onSubmit={submit}>
          <label>Display name<input required maxLength={100} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label>Your current background<textarea maxLength={1500} value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} placeholder="Experience, role, or what you already know" /></label>
          <label>How you prefer to learn<textarea maxLength={1000} value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} placeholder="Examples, guided practice, conversation…" /></label>
          <div className="profile-form-actions"><button type="button" className="danger-button" disabled={busy || profiles.length <= 1} onClick={() => void onDelete()}>Delete profile</button><button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'} <CheckRounded /></button></div>
        </form>
        <div className="memory-grid compact"><div><span>Current level</span><strong>{workspace.progress.level}</strong></div><div><span>XP evidence</span><strong>{workspace.progress.xp} XP</strong></div><div className="wide"><span>Active goal</span><strong>{goal?.title ?? 'No goal yet'}</strong></div><div><span>Assessments</span><strong>{workspace.progress.completedAssessments}</strong></div><div><span>Documents</span><strong>{workspace.documents.length}</strong></div></div>
      </>}
    </DialogContent>
  </Dialog>;
}

export function DocumentsDialog({ open, busy, documents, onClose, onDelete }: { open: boolean; busy: boolean; documents: KnowledgeDocument[]; onClose: () => void; onDelete: (document: KnowledgeDocument) => Promise<void> }) {
  const sizeLabel = (size: number) => size >= 1_048_576 ? `${(size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  return <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}><IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton><DialogContent><span className="dialog-kicker">UPLOADED KNOWLEDGE</span><h2>Browse documentation</h2><p>These documents can ground future lessons for this learner profile. Deleting one removes its original upload and extracted local text.</p>{documents.length ? <div className="document-browser">{documents.map((document) => <article key={document.id}><span><DescriptionRounded /></span><div><strong>{document.name}</strong><p>{sizeLabel(document.size)} · {document.status === 'processing' ? 'Indexing' : document.status === 'failed' ? 'Failed' : 'Ready'} · uploaded {new Date(document.uploadedAt).toLocaleDateString()}</p><small>{document.scope?.visibility === 'goal' ? 'Limited to one learning goal' : 'Available across this learner profile'}</small></div><button aria-label={`Delete ${document.name}`} title="Delete document" disabled={busy} onClick={() => void onDelete(document)}><DeleteOutlineRounded /></button></article>)}</div> : <div className="document-empty">No documentation has been uploaded for this profile.</div>}</DialogContent></Dialog>;
}

function LessonQuiz({ questions }: { questions: LessonQuizQuestion[] }) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const answered = answers.filter((answer) => answer >= 0).length;
  const correct = submitted ? questions.reduce((total, question, index) => total + (answers[index] === question.correctIndex ? 1 : 0), 0) : 0;
  const choose = (questionIndex: number, optionIndex: number) => {
    if (submitted) return;
    const next = [...answers];
    next[questionIndex] = optionIndex;
    setAnswers(next);
  };
  const retry = () => { setAnswers([]); setSubmitted(false); };
  return <section className="lesson-quiz"><div className="quiz-heading"><span><QuizRounded /></span><div><small>KNOWLEDGE CHECK</small><h3>Test what you learned</h3><p>Choose one answer for each question. Corrections appear after you check your answers.</p></div></div>{submitted && <div className="quiz-score"><strong>{correct}/{questions.length} correct</strong><span>{Math.round((correct / questions.length) * 100)}%</span></div>}<div className="quiz-questions">{questions.map((question, questionIndex) => <article key={question.id}><small>QUESTION {questionIndex + 1}</small><h4>{question.prompt}</h4><div>{question.options.map((option, optionIndex) => { const selected = answers[questionIndex] === optionIndex; const correctOption = optionIndex === question.correctIndex; const state = submitted ? correctOption ? 'correct' : selected ? 'incorrect' : '' : selected ? 'selected' : ''; return <button type="button" aria-pressed={selected} disabled={submitted} className={state} onClick={() => choose(questionIndex, optionIndex)} key={`${option}-${optionIndex}`}><span>{String.fromCharCode(65 + optionIndex)}</span>{option}{submitted && correctOption && <CheckRounded />}</button>; })}</div>{submitted && <div className={answers[questionIndex] === question.correctIndex ? 'quiz-feedback correct' : 'quiz-feedback incorrect'}><strong>{answers[questionIndex] === question.correctIndex ? 'Correct.' : `Correction: ${question.options[question.correctIndex]}`}</strong><p>{question.explanation}</p></div>}</article>)}</div><div className="quiz-actions">{submitted ? <button type="button" onClick={retry}><ReplayRounded /> Try again</button> : <button type="button" disabled={answered !== questions.length} onClick={() => setSubmitted(true)}>Check my answers <ArrowForwardRounded /></button>}<span>{answered}/{questions.length} answered</span></div></section>;
}

export function MaterialDialog({ material, onClose }: { material?: LearningMaterial; onClose: () => void }) {
  const label = material?.kind === 'practice-lab' ? 'PRACTICE ACTIVITY' : 'SOURCED LESSON';
  return <Dialog open={Boolean(material)} onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { className: 'studio-dialog material-dialog' } }}><IconButton className="dialog-close" onClick={onClose}><CloseRounded /></IconButton>{material && <DialogContent><span className="dialog-kicker">{label}</span><h2>{material.title}</h2><p>{material.summary}</p>{material.kind === 'lesson' && (material.assessedLevel || material.topics?.length) && <div className="lesson-state"><div><span>ADAPTED LEVEL</span><strong>{material.assessedLevel ?? 'Legacy lesson'}</strong>{material.diagnosticFocus?.length ? <small>Extra support: {material.diagnosticFocus.join(' · ')}</small> : null}</div>{material.topics && <div><span>TOPICS COVERED</span><p>{material.topics.join(' · ')}</p></div>}</div>}<div className="material-sections">{material.sections.map((section, index) => <section key={`${section.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><div className="lesson-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a> }}>{section.content}</ReactMarkdown></div>{material.kind === 'practice-lab' && section.activities && section.activities.length > 0 && <div className="lesson-activities"><strong>Activities</strong><ul>{section.activities.map((activity) => <li key={activity}>{activity}</li>)}</ul></div>}</div></section>)}</div>{material.quiz?.length ? <LessonQuiz key={material.id} questions={material.quiz} /> : null}{material.sources && material.sources.length > 0 && <section className="lesson-sources"><span>SOURCES USED</span><h3>Where this lesson came from</h3><div>{material.sources.map((source, index) => <article key={`${source.title}-${index}`}><small>{source.origin === 'uploaded-document' ? 'YOUR UPLOADED DOCUMENT' : 'PUBLIC WEB'}</small>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : <strong>{source.title}</strong>}</article>)}</div></section>}</DialogContent>}</Dialog>;
}

export function PlacementDialog({ assessment, busy, result, onClose, onSubmit }: { assessment?: PublicPlacementAssessment; busy: boolean; result?: PlacementResult; onClose: () => void; onSubmit: (answers: number[]) => Promise<void> }) {
  const [answers, setAnswers] = useState<number[]>([]);
  if (!assessment) return null;
  const testType = assessment.testType ?? ((assessment.attemptNumber ?? 1) > 1 ? 'assessment' : 'placement');
  const testLabel = testType === 'placement' ? 'PLACEMENT TEST' : 'ASSESSMENT TEST';
  const answered = answers.filter((value) => value >= 0).length;
  const choose = (questionIndex: number, optionIndex: number) => { const next = [...answers]; next[questionIndex] = optionIndex; setAnswers(next); };
  return <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth slotProps={{ paper: { className: 'studio-dialog placement-dialog' } }}><IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton><DialogContent><span className="dialog-kicker">{testLabel}</span>{result ? <div className="placement-result detailed"><span><CheckRounded /></span><h2>{result.level}</h2><p>{result.score}% demonstrated · +{result.xpAwarded} XP</p>{result.badgeAwarded && <strong>Badge earned: {result.badgeAwarded}</strong>}<div className="diagnostic-results"><h3>What your future lessons will adapt to</h3>{result.diagnostics.dimensionScores.map((area) => <div key={area.dimension}><header><span>{area.dimension}</span><b>{area.correct}/{area.total}</b></header><i><b style={{ width: `${area.percentage}%` }} /></i></div>)}<section><div><small>DEMONSTRATED STRENGTHS</small><p>{result.diagnostics.strengths.join(' · ') || 'No area is established yet—that is completely fine.'}</p></div><div><small>FOCUS AREAS</small><p>{result.diagnostics.focusAreas.join(' · ') || 'No specific gaps identified.'}</p></div></section></div><button className="dialog-primary" onClick={onClose}>Return to workspace</button></div> : <><h2>{assessment.title}</h2><p>{testType === 'placement' ? 'This first test establishes your starting point across several skill areas and difficulty levels.' : 'This follow-up test reassesses your current knowledge with fresh questions and updates how future lessons adapt.'}</p><LinearProgress variant="determinate" value={(answered / assessment.questions.length) * 100} /><div className="placement-questions">{assessment.questions.map((question, questionIndex) => <section key={question.id}><span>QUESTION {questionIndex + 1}{question.dimension ? ` · ${question.dimension}` : ''}{question.difficulty ? ` · ${question.difficulty}` : ''}</span><h3>{question.prompt}</h3><div>{question.options.map((option, optionIndex) => <button className={answers[questionIndex] === optionIndex ? 'selected' : ''} onClick={() => choose(questionIndex, optionIndex)} key={`${option}-${optionIndex}`}>{option}</button>)}</div></section>)}</div><button className="dialog-primary submit-placement" disabled={busy || answered !== assessment.questions.length} onClick={() => onSubmit(answers)}>{busy ? 'Scoring…' : 'See my result'} <ArrowForwardRounded /></button></>}</DialogContent></Dialog>;
}
