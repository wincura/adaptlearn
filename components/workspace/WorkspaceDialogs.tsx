'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowForwardRounded, CheckRounded, CloseRounded, CodeRounded, DeleteOutlineRounded, DescriptionRounded, QuizRounded, ReplayRounded } from '@mui/icons-material';
import { CircularProgress, Dialog, DialogContent, IconButton, LinearProgress } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import type { KnowledgeDocument, LearnerProfile, LearningMaterial, LearningWorkspace, LessonQuizQuestion, PlacementResult, PublicPlacementAssessment } from '../../shared/contracts';
import { CodeSandbox } from './CodeSandbox';

export type GoalInput = { title: string; motivation: string; targetOutcome: string; background: string; preferences: string; courseTemplateId?: string };

export function GoalDialog({ open, busy, profile, initial, editing: editingProp, templateName, onClose, onSubmit }: { open: boolean; busy: boolean; profile: LearnerProfile; initial?: Partial<GoalInput>; editing?: boolean; templateName?: string; onClose: () => void; onSubmit: (input: GoalInput) => Promise<void> }) {
  const editing = editingProp ?? Boolean(initial);
  const [form, setForm] = useState<GoalInput>({ courseTemplateId: initial?.courseTemplateId, title: initial?.title ?? '', motivation: initial?.motivation ?? '', targetOutcome: initial?.targetOutcome ?? '', background: initial?.background ?? profile.background, preferences: initial?.preferences ?? profile.preferences });
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSubmit(form); };
  return <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}><IconButton className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton><DialogContent><span className="dialog-kicker">{editing ? 'LEARNING GOAL' : templateName ? 'COURSE ENROLLMENT' : 'YOUR LEARNING PROFILE'}</span><h2>{editing ? 'Edit this learning goal' : templateName ? `Start ${templateName}` : 'Shape your learning goal'}</h2><p>{editing ? 'Changes apply to future lessons while your existing progress remains attached to this goal.' : templateName ? 'Save this course as a learning goal, then take a placement test so AdaptLearn can personalize it.' : 'This gives AdaptLearn enough context to personalize your experience. No materials are created until you ask.'}</p><form className="goal-form" onSubmit={submit}><label>What do you want to learn?<input required minLength={2} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Lead clearer project meetings" /></label><label>What exactly do you want to focus on?<textarea value={form.motivation} onChange={(event) => setForm({ ...form, motivation: event.target.value })} placeholder="Specific skills, situations, features, or topics to prioritize" /></label><label>What would success look like?<textarea value={form.targetOutcome} onChange={(event) => setForm({ ...form, targetOutcome: event.target.value })} placeholder="A practical outcome you want to reach" /></label>{!editing && <div className="form-pair"><label>Your current background<textarea value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} placeholder="What you already know" /></label><label>How you prefer to learn<textarea value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} placeholder="Examples, practice, conversation…" /></label></div>}<button className="dialog-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save goal'} <ArrowForwardRounded /></button></form></DialogContent></Dialog>;
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

export function MemoryDialog({ open, busy, workspace, needsName, onClose, onSave }: { open: boolean; busy: boolean; workspace: LearningWorkspace; needsName?: boolean; onClose: () => void; onSave: (profile: LearnerProfile) => Promise<void> }) {
  const [form, setForm] = useState<LearnerProfile>({ ...workspace.profile, displayName: needsName ? '' : workspace.profile.displayName });
  const submit = async (event: FormEvent) => { event.preventDefault(); await onSave({ ...form, displayName: form.displayName.trim() }); };
  return <Dialog open={open} onClose={busy || needsName ? undefined : onClose} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'studio-dialog' } }}>
    {!needsName && <IconButton aria-label="Close profile" className="dialog-close" disabled={busy} onClick={onClose}><CloseRounded /></IconButton>}
    <DialogContent><span className="dialog-kicker">YOUR PROFILE</span><h2>{needsName ? 'What should we call you?' : 'Learning preferences'}</h2><p>{needsName ? 'Cognito only collected your email. Add a name so your workspace is personal. You can set learning preferences later.' : 'Update your name and how you prefer to learn.'}</p>
      <form className="goal-form profile-form" onSubmit={submit}>
        <label>Display name<input autoFocus required minLength={2} maxLength={100} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="e.g. Kai" /></label>
        {!needsName && <>
          <label>Your current background<textarea maxLength={1500} value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} /></label>
          <label>How you prefer to learn<textarea maxLength={1000} value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} /></label>
        </>}
        <button className="dialog-primary" disabled={busy || form.displayName.trim().length < 2}>{busy ? 'Saving…' : needsName ? 'Continue' : 'Save profile'} <CheckRounded /></button>
      </form>
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

export function MaterialDialog({ material: initialMaterial, learnerId, onClose, onWorkspaceUpdated }: { material?: LearningMaterial; learnerId?: string; onClose: () => void; onWorkspaceUpdated?: (workspace: LearningWorkspace) => void }) {
  const [material, setMaterial] = useState<LearningMaterial | undefined>(initialMaterial);
  const [generatingChallenge, setGeneratingChallenge] = useState(false);

  useEffect(() => {
    setMaterial(initialMaterial);
  }, [initialMaterial]);

  const handleGenerateChallenge = useCallback(async () => {
    if (!material || !learnerId || generatingChallenge) return;
    setGeneratingChallenge(true);
    try {
      const res = await api.generateCodingChallenge(learnerId, material.id);
      setMaterial((prev) => prev ? {
        ...prev,
        codingChallenge: res.challenge,
        codingChallenges: [res.challenge],
        isCodeTopic: true,
      } : prev);
      if (onWorkspaceUpdated) onWorkspaceUpdated(res.workspace);
    } catch (err) {
      console.error('Could not generate coding challenge:', err);
    } finally {
      setGeneratingChallenge(false);
    }
  }, [material, learnerId, generatingChallenge, onWorkspaceUpdated]);

  // Auto-generate coding challenge for practice activities and code topics so user does not need to click redundant button
  useEffect(() => {
    if (material && material.isCodeTopic && !material.codingChallenge && !generatingChallenge && learnerId) {
      handleGenerateChallenge();
    }
  }, [material, generatingChallenge, learnerId, handleGenerateChallenge]);

  const handleNextChallenge = async () => {
    if (!material || !learnerId) return;
    const res = await api.generateCodingChallenge(learnerId, material.id, true);
    const existingList = material.codingChallenges ?? (material.codingChallenge ? [material.codingChallenge] : []);
    const updatedList = [...existingList, res.challenge];
    setMaterial({
      ...material,
      codingChallenge: res.challenge,
      codingChallenges: updatedList,
      isCodeTopic: true,
    });
    if (onWorkspaceUpdated) onWorkspaceUpdated(res.workspace);
    return res.challenge;
  };

  const label = material?.kind === 'practice-lab' ? 'PRACTICE ACTIVITY' : 'SOURCED LESSON';
  return <Dialog open={Boolean(material)} onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { className: 'studio-dialog material-dialog' } }}><IconButton className="dialog-close" onClick={onClose}><CloseRounded /></IconButton>{material && <DialogContent><span className="dialog-kicker">{label}</span><h2>{material.title}</h2><p>{material.summary}</p>{material.kind === 'lesson' && (material.assessedLevel || material.topics?.length) && <div className="lesson-state"><div><span>ADAPTED LEVEL</span><strong>{material.assessedLevel ?? 'Legacy lesson'}</strong>{material.diagnosticFocus?.length ? <small>Extra support: {material.diagnosticFocus.join(' · ')}</small> : null}</div>{material.topics && <div><span>TOPICS COVERED</span><p>{material.topics.join(' · ')}</p></div>}</div>}<div className="material-sections">{material.sections.map((section, index) => <section key={`${section.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><div className="lesson-content"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a> }}>{section.content}</ReactMarkdown></div>{material.kind === 'practice-lab' && section.activities && section.activities.length > 0 && <div className="lesson-activities"><strong>Activities</strong><ul>{section.activities.map((activity) => <li key={activity}>{activity}</li>)}</ul></div>}</div></section>)}</div>{material.codingChallenge ? <CodeSandbox challenge={material.codingChallenge} challenges={material.codingChallenges ?? (material.codingChallenge ? [material.codingChallenge] : [])} materialId={material.id} learnerId={learnerId} goalId={material.goalId} onRequestNextChallenge={handleNextChallenge} onCompleted={(_, ws) => ws && onWorkspaceUpdated?.(ws)} /> : material.isCodeTopic && learnerId ? <div className="generate-challenge-banner"><div><span className="sandbox-badge"><CodeRounded fontSize="inherit" /> PRACTICAL CODING CHALLENGE</span><h3 style={{ margin: '6px 0 2px', fontSize: 17, color: '#f3f7f5' }}>Preparing Hands-on Coding Practice…</h3><p style={{ margin: 0, fontSize: 13.5, color: '#9cb3aa' }}>Generating an interactive challenge tailored to your skill level.</p></div><button type="button" className="dialog-primary" disabled style={{ whiteSpace: 'nowrap' }}><CircularProgress size={16} color="inherit" style={{ marginRight: 6 }} /> Generating practice question…</button></div> : null}{material.quiz?.length ? <LessonQuiz key={material.id} questions={material.quiz} /> : null}{material.sources && material.sources.length > 0 && <section className="lesson-sources"><span>SOURCES USED</span><h3>Where this lesson came from</h3><div>{material.sources.map((source, index) => <article key={`${source.title}-${index}`}><small>{source.origin === 'uploaded-document' ? 'YOUR UPLOADED DOCUMENT' : 'PUBLIC WEB'}</small>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : <strong>{source.title}</strong>}</article>)}</div></section>}</DialogContent>}</Dialog>;
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
