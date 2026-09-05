'use client';

import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import Image from 'next/image';
import {
  AddRounded,
  ArrowBackRounded,
  ArrowForwardRounded,
  AutoAwesomeRounded,
  CheckRounded,
  ChevronRightRounded,
  DiamondRounded,
  EmojiEventsRounded,
  GridViewRounded,
  InsightsRounded,
  ManageAccountsRounded,
  MenuBookRounded,
  RadioButtonCheckedRounded,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { LearnerProfile, LearnerWorkspaceSummary, LearningGoal, LearningMaterial, LearningWorkspace, ResearchSuggestion } from '../../shared/contracts';
import { COURSE_TEMPLATES, type CourseCategory, type CourseTemplate, courseTemplate } from '../../lib/course-catalog';
import { activityStreak, assessmentHistory, goalProgress, latestCompletedAssessment, memberSince, overallMastery, skillBreakdown, weeklyActivity } from '../../lib/learning-metrics';

export type StudioView = 'workspace' | 'courses' | 'progress' | 'profile' | 'course-detail';
export type PageView = Exclude<StudioView, 'course-detail'>;

type PageProps = {
  workspace: LearningWorkspace;
  profiles: LearnerWorkspaceSummary[];
  onNavigate: (view: PageView) => void;
  onAddGoal: () => void;
  onOpenGoal: (goalId: string, returnView: PageView) => void;
  onOpenTemplate: (template: CourseTemplate) => void;
  onManageProfiles: () => void;
  onSaveProfile: (profile: LearnerProfile) => Promise<void>;
};

type SidebarProps = {
  active: StudioView;
  workspace: LearningWorkspace;
  onNavigate: (view: PageView) => void;
  onManageProfiles: () => void;
};

const navItems: Array<{ id: PageView; label: string; icon: typeof GridViewRounded }> = [
  { id: 'workspace', label: 'Workspace', icon: GridViewRounded },
  { id: 'courses', label: 'Courses', icon: AutoAwesomeRounded },
  { id: 'progress', label: 'Progress', icon: DiamondRounded },
  { id: 'profile', label: 'Profile', icon: RadioButtonCheckedRounded },
];

const categoryFilters: Array<'All' | CourseCategory | 'Custom'> = ['All', 'Languages', 'Coding', 'Math', 'Science'];

const colorSet = ['#ef4935', '#2e71a8', '#7650d8', '#138462', '#a36628'];

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'L';

const customColor = (title: string) => {
  const value = [...title].reduce((total, character) => total + character.charCodeAt(0), 0);
  return colorSet[value % colorSet.length];
};

const goalTemplate = (goal: LearningGoal) => courseTemplate(goal.courseTemplateId);
const goalReferenceTemplate = (goal: LearningGoal) => {
  const savedTemplate = goalTemplate(goal);
  if (savedTemplate) return savedTemplate;
  const title = goal.title.toLocaleLowerCase();
  return COURSE_TEMPLATES.find((template) => title.includes(template.title.toLocaleLowerCase()));
};

function Sidebar({ active, workspace, onNavigate, onManageProfiles }: SidebarProps) {
  return <aside className="reference-sidebar">
    <div className="reference-brand"><Image className="reference-brand-image" src="/brand/adaptlearn-app-icon.png" alt="AdaptLearn" width={1536} height={1024} priority /></div>
    <nav aria-label="Primary navigation">{navItems.map(({ id, label, icon: Icon }) => <button className={active === id || (active === 'course-detail' && id === 'courses') ? 'active' : ''} key={id} onClick={() => onNavigate(id)}><Icon />{label}</button>)}</nav>
    <button className="reference-user" onClick={onManageProfiles} aria-label="Manage learner profiles"><span>{initials(workspace.profile.displayName)}</span><div><strong>{workspace.profile.displayName}</strong><small>Learner</small></div></button>
  </aside>;
}

export function ReferenceShell({ active, workspace, children, onNavigate, onManageProfiles }: SidebarProps & { children: ReactNode }) {
  return <div className="reference-shell"><Sidebar active={active} workspace={workspace} onNavigate={onNavigate} onManageProfiles={onManageProfiles} /><main className="reference-main">{children}</main></div>;
}

function CourseMedia({ color, image, icon }: { color: string; image?: string; icon: string }) {
  return <div className="reference-course-media" style={{ backgroundColor: color, backgroundImage: image ? `linear-gradient(90deg, ${color}dd 0%, ${color}35 100%), url(${image})` : `linear-gradient(135deg, ${color}, ${color}88)` }}><span>{icon}</span></div>;
}

function DataCourseCard({ workspace, goal, template, onOpen, onEnroll, compact = false }: { workspace: LearningWorkspace; goal?: LearningGoal; template?: CourseTemplate; onOpen?: () => void; onEnroll?: () => void; compact?: boolean }) {
  const title = goal?.title ?? template?.title ?? 'Personal course';
  const referenceTemplate = goal ? goalReferenceTemplate(goal) ?? template : template;
  const color = template?.color ?? referenceTemplate?.color ?? customColor(title);
  const progress = goal ? goalProgress(workspace, goal.id) : undefined;
  const latest = goal ? latestCompletedAssessment(workspace, goal.id) : undefined;
  const action = goal ? onOpen : onEnroll;
  return <article className={`reference-course-card${compact ? ' compact' : ''}`} {...(goal ? { role: 'button' as const, tabIndex: 0, onClick: action, onKeyDown: (event: KeyboardEvent<HTMLElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action?.(); } } } : {})}>
    <CourseMedia color={color} image={referenceTemplate?.image} icon={referenceTemplate?.icon ?? '✦'} />
    <div className="reference-course-body"><div className="reference-course-title"><h3>{title}</h3>{goal && <span className="reference-course-progress">{progress === undefined ? '—' : `${progress}%`}</span>}</div><p className="reference-course-meta">{template && !goal ? `${template.category} · ${template.lessons} lessons · ${template.duration}` : 'CUSTOM COURSE'}</p>{goal ? <div className="reference-course-progress-line">{progress !== undefined && <span style={{ width: `${progress}%`, backgroundColor: color }} />}</div> : <p className="reference-course-description">{template?.description}</p>}<div className="reference-course-footer"><small>{latest?.level ?? (goal ? 'Unassessed' : template?.level)}</small>{goal ? <span><MenuBookRounded />{progress === undefined ? 'Start placement' : 'Open course'}<ChevronRightRounded /></span> : <button type="button" onClick={(event) => { event.stopPropagation(); action?.(); }}>Enroll <ArrowForwardRounded /></button>}</div></div>
  </article>;
}

export function WorkspacePage({ workspace, onNavigate, onAddGoal, onOpenGoal }: Pick<PageProps, 'workspace' | 'onNavigate' | 'onAddGoal' | 'onOpenGoal'>) {
  const goals = workspace.goals.filter((goal) => goal.status !== 'complete');
  const suggestions = workspace.suggestions.filter((suggestion) => suggestion.status === 'suggested').slice(0, 3);
  const activeGoal = goals.find((goal) => goal.status === 'active');
  const recentMaterials = [...workspace.materials].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 3);
  const latestAssessment = [...workspace.assessments].filter((assessment) => assessment.completedAt).sort((left, right) => (right.completedAt ?? '').localeCompare(left.completedAt ?? ''))[0];
  return <div className="reference-page workspace-page">
    <section className="reference-hero"><div className="reference-orb orb-one" /><div className="reference-orb orb-two" /><span className="reference-kicker">YOUR CURRENT DIRECTION</span><h1>{activeGoal ? activeGoal.title : 'What would you like to become better at?'}</h1><p>{activeGoal?.targetOutcome || 'AdaptLearn shapes lessons around your goals. Pick a subject, set a target, and the system adjusts difficulty as you improve.'}</p><div className="reference-hero-actions"><button className="reference-primary" onClick={onAddGoal}><AddRounded /> Add goal</button><button className="reference-ghost" onClick={() => onNavigate('progress')}>View progress <ArrowForwardRounded /></button></div></section>
    <section className="reference-section-block"><div className="reference-section-heading"><div><span className="reference-kicker">ACTIVE SUBJECTS</span><h2>Your learning path</h2></div><button className="reference-text-button" onClick={() => onNavigate('courses')}>Browse all <ArrowForwardRounded /></button></div>{goals.length ? <div className="reference-course-grid">{goals.slice(0, 4).map((goal) => <DataCourseCard key={goal.id} workspace={workspace} goal={goal} template={goalTemplate(goal)} onOpen={() => onOpenGoal(goal.id, 'workspace')} compact />)}</div> : <div className="reference-empty"><MenuBookRounded /><h3>Start with a course that matters to you.</h3><p>Add a goal and AdaptLearn will turn it into a focused, adaptive course.</p><button className="reference-primary" onClick={onAddGoal}>Add your first goal <ArrowForwardRounded /></button></div>}</section>
    <section className="reference-section-block reference-recent-block"><div className="reference-section-heading"><div><span className="reference-kicker">RECENT EVIDENCE</span><h2>What you have been working on</h2></div>{activeGoal && <button className="reference-text-button" onClick={() => onOpenGoal(activeGoal.id, 'workspace')}>Open current course <ArrowForwardRounded /></button>}</div><div className="reference-recent-content"><div className="reference-latest-assessment"><span className="reference-kicker">{latestAssessment ? 'LATEST CHECK-IN' : 'NEXT CHECK-IN'}</span><strong>{latestAssessment ? `${latestAssessment.score ?? 0}% · ${latestAssessment.level ?? 'Unassessed'}` : 'No completed assessment yet'}</strong><p>{latestAssessment ? 'Your latest completed assessment is shaping the next course activity.' : activeGoal ? 'Complete placement to give your first lesson an honest starting point.' : 'Add a goal to begin collecting learning evidence.'}</p></div>{recentMaterials.length ? <div className="reference-material-list">{recentMaterials.map((material) => <MaterialPreview key={material.id} workspace={workspace} material={material} />)}</div> : <div className="reference-quiet">No lessons or practice activities yet. They will appear here after you create your first one.</div>}</div></section>
    <section className="reference-section-block reference-updates"><div className="reference-section-heading"><div><span className="reference-kicker">UPDATES &amp; REFRESHERS</span><h2>Useful next, until you approve</h2></div>{activeGoal && <button className="reference-text-button" onClick={() => onNavigate('courses')}>Course library <ArrowForwardRounded /></button>}</div>{suggestions.length ? <div className="reference-update-list">{suggestions.map((suggestion) => <UpdateRow key={suggestion.id} suggestion={suggestion} />)}</div> : <div className="reference-quiet">{activeGoal ? 'No pending suggestions. Use “What’s new?” inside a course to look for a useful next step.' : 'Suggestions begin after you add a goal, so they stay relevant.'}</div>}</section>
  </div>;
}

function MaterialPreview({ workspace, material }: { workspace: LearningWorkspace; material: LearningMaterial }) {
  const goal = workspace.goals.find((item) => item.id === material.goalId);
  return <article><span>{material.kind === 'lesson' ? 'SOURCED LESSON' : 'PRACTICE ACTIVITY'}</span><strong>{material.title}</strong><small>{goal?.title ?? 'Custom course'} · {new Date(material.createdAt).toLocaleDateString()}</small></article>;
}

function UpdateRow({ suggestion }: { suggestion: ResearchSuggestion }) {
  return <article className="reference-update-row"><div><span>{suggestion.purpose === 'update' ? 'NEW OR CHANGED' : suggestion.purpose === 'refresh' ? 'TARGETED REFRESH' : 'NEXT TOPIC'} · OPTIONAL</span><h3>{suggestion.title}</h3><p>{suggestion.summary}</p></div>{suggestion.sourceUrl && <a href={suggestion.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}</article>;
}

export function CoursesPage({ workspace, onOpenGoal, onOpenTemplate }: Pick<PageProps, 'workspace' | 'onOpenGoal' | 'onOpenTemplate'>) {
  const customGoals = workspace.goals.filter((goal) => !goal.courseTemplateId && goal.status !== 'complete');
  const [filter, setFilter] = useState<'All' | CourseCategory | 'Custom'>('All');
  const enrolled = useMemo(() => new Map(workspace.goals.filter((goal) => goal.courseTemplateId).map((goal) => [goal.courseTemplateId as string, goal])), [workspace.goals]);
  const filters = customGoals.length ? [...categoryFilters, 'Custom' as const] : categoryFilters;
  const templates = COURSE_TEMPLATES.filter((template) => filter === 'All' || filter === 'Custom' || template.category === filter);
  const customVisible = filter === 'All' || filter === 'Custom';
  return <div className="reference-page"><div className="reference-page-header"><span className="reference-kicker">COURSE LIBRARY</span><h1>Explore Courses</h1><p>Choose a direction, then let AdaptLearn shape the next lesson around you.</p></div><div className="reference-filter-row">{filters.map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>{customVisible && customGoals.length > 0 && <section className="reference-section-block compact-block"><div className="reference-section-heading"><div><span className="reference-kicker">YOUR COURSES</span><h2>Personalized paths</h2></div></div><div className="reference-course-grid catalog-grid">{customGoals.map((goal) => <DataCourseCard key={goal.id} workspace={workspace} goal={goal} onOpen={() => onOpenGoal(goal.id, 'courses')} />)}</div></section>}<section className="reference-section-block compact-block"><div className="reference-section-heading"><div><span className="reference-kicker">ADAPTLEARN LIBRARY</span><h2>{filter === 'All' ? 'Find your next subject' : filter}</h2></div></div><div className="reference-course-grid catalog-grid">{templates.map((template) => { const goal = enrolled.get(template.id); return <DataCourseCard key={template.id} workspace={workspace} template={template} goal={goal} onOpen={goal ? () => onOpenGoal(goal.id, 'courses') : undefined} onEnroll={() => onOpenTemplate(template)} />; })}</div></section></div>;
}

const chartTooltip = ({ active, payload, label }: TooltipContentProps) => active && payload?.length ? <div className="reference-tooltip"><strong>{String(label ?? '')}</strong>{payload.map((item, index) => <span key={`${String(item.name)}-${index}`}><i style={{ backgroundColor: item.color }} />{String(item.name)}: {String(item.value)}</span>)}</div> : null;

export function ProgressPage({ workspace }: Pick<PageProps, 'workspace'>) {
  const goals = workspace.goals.filter((goal) => goal.status !== 'complete');
  const [selectedGoalId, setSelectedGoalId] = useState(goals[0]?.id ?? '');
  const [filterGoalId, setFilterGoalId] = useState('all');
  const mastery = overallMastery(workspace);
  const lessons = workspace.materials.filter((material) => material.owner === 'teacher' && material.kind === 'lesson').length;
  const streak = activityStreak(workspace);
  const events = weeklyActivity(workspace);
  const chartGoals = filterGoalId === 'all' ? goals : goals.filter((goal) => goal.id === filterGoalId);
  const history = assessmentHistory(workspace);
  const skills = skillBreakdown(workspace, selectedGoalId);
  const hasEvents = events.some((day) => day.total > 0);
  return <div className="reference-page"><div className="reference-page-header"><span className="reference-kicker">LEARNING ANALYTICS</span><h1>Your Progress</h1><p>See the evidence AdaptLearn has collected across your learning paths.</p></div><div className="reference-kpi-grid"><Metric value={mastery === undefined ? '—' : `${mastery}%`} label="Overall mastery" note={mastery === undefined ? 'Complete an assessment to begin' : 'From latest course assessments'} tone="positive" /><Metric value={String(lessons)} label="Lessons created" note={lessons ? 'Real learning materials' : 'Create your first lesson'} tone="positive" /><Metric value={streak ? `${streak}d` : '—'} label="Activity streak" note={streak ? 'Consecutive active days' : 'No recent activity yet'} tone="positive" /><Metric value={`${workspace.progress.xp} XP`} label="Earned evidence" note={`${workspace.progress.completedAssessments} completed assessment${workspace.progress.completedAssessments === 1 ? '' : 's'}`} tone="neutral" /></div><section className="reference-chart-card"><ChartHeader eyebrow="THIS WEEK" title="Learning activity" controls={<div className="reference-chart-filters"><button className={filterGoalId === 'all' ? 'active' : ''} onClick={() => setFilterGoalId('all')}>All</button>{goals.map((goal) => <button key={goal.id} className={filterGoalId === goal.id ? 'active' : ''} onClick={() => setFilterGoalId(goal.id)}>{goal.title}</button>)}</div>} />{hasEvents ? <div className="reference-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={events} barGap={3} barCategoryGap="28%"><CartesianGrid strokeDasharray="3 3" stroke="#d7d1c7" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#817b72', fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#817b72', fontSize: 12 }} /><Tooltip content={chartTooltip} />{chartGoals.map((goal, index) => <Bar key={goal.id} dataKey={goal.id} name={goal.title} fill={colorSet[index % colorSet.length]} radius={[5, 5, 0, 0]} />)}{filterGoalId === 'all' && <Bar dataKey="general" name="General learning" fill="#9b9b94" radius={[5, 5, 0, 0]} />}</BarChart></ResponsiveContainer></div> : <ChartEmpty title="No activity recorded this week" description="Create a lesson, complete an assessment, or ask the Learning Guide to see activity here." />}</section><div className="reference-two-column"><section className="reference-chart-card"><ChartHeader eyebrow="ASSESSMENT HISTORY" title="Mastery over time" />{history.length ? <div className="reference-chart small-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={history}><CartesianGrid strokeDasharray="3 3" stroke="#d7d1c7" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#817b72', fontSize: 11 }} /><YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#817b72', fontSize: 11 }} /><Tooltip content={chartTooltip} /><Line type="monotone" dataKey="score" name="Score" stroke="#1c3a2c" strokeWidth={3} dot={{ r: 4, fill: '#bef135', stroke: '#1c3a2c', strokeWidth: 2 }} /></LineChart></ResponsiveContainer></div> : <ChartEmpty title="No assessment history yet" description="Placement and assessment results will appear here." />}</section><section className="reference-chart-card"><ChartHeader eyebrow="COURSE DIAGNOSTICS" title={selectedGoalId ? `${workspace.goals.find((goal) => goal.id === selectedGoalId)?.title ?? 'Course'} skills` : 'Course skills'} controls={goals.length ? <select className="reference-select" value={selectedGoalId} onChange={(event) => setSelectedGoalId(event.target.value)}>{goals.map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}</select> : undefined} />{skills.length ? <div className="reference-radar"><ResponsiveContainer width="100%" height="100%"><RadarChart data={skills} outerRadius="70%"><PolarGrid stroke="#d7d1c7" /><PolarAngleAxis dataKey="subject" tick={{ fill: '#6b6860', fontSize: 11 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name="Mastery" dataKey="score" stroke="#1c3a2c" fill="#bef135" fillOpacity={0.54} /></RadarChart></ResponsiveContainer></div> : <ChartEmpty title="No diagnostics yet" description="Complete a placement or assessment test to see skill-level evidence." />}</section></div></div>;
}

function Metric({ value, label, note, tone }: { value: string; label: string; note: string; tone: 'positive' | 'neutral' }) {
  return <div className="reference-metric"><strong>{value}</strong><span>{label}</span><small className={tone}>{note}</small></div>;
}

function ChartHeader({ eyebrow, title, controls }: { eyebrow: string; title: string; controls?: ReactNode }) {
  return <div className="reference-chart-header"><div><span className="reference-kicker">{eyebrow}</span><h2>{title}</h2></div>{controls}</div>;
}

function ChartEmpty({ title, description }: { title: string; description: string }) {
  return <div className="reference-chart-empty"><InsightsRounded /><strong>{title}</strong><p>{description}</p></div>;
}

export function ProfilePage({ workspace, onManageProfiles, onSaveProfile, onOpenGoal }: Pick<PageProps, 'workspace' | 'onManageProfiles' | 'onSaveProfile' | 'onOpenGoal'>) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LearnerProfile>(workspace.profile);
  const goals = workspace.goals.filter((goal) => goal.status !== 'complete');
  const lessons = workspace.materials.filter((material) => material.owner === 'teacher' && material.kind === 'lesson').length;
  const save = async (event: FormEvent) => { event.preventDefault(); await onSaveProfile(form); setEditing(false); };
  return <div className="reference-page profile-page"><section className="reference-profile-hero"><div className="reference-profile-photo" /><div className="reference-avatar">{initials(workspace.profile.displayName)}</div><div className="reference-profile-copy"><h1>{workspace.profile.displayName}</h1><p>{workspace.profile.background || 'Curious learner, building a path that fits.'}</p><small>{workspace.progress.level} <i>·</i> Member since {memberSince(workspace)}</small></div><button className="reference-hero-outline" onClick={() => { setForm(workspace.profile); setEditing((value) => !value); }}>{editing ? 'Cancel' : 'Edit profile'}</button></section>{editing && <form className="reference-edit-card" onSubmit={save}><div><span className="reference-kicker">EDIT PROFILE</span><h2>Keep your learning context current</h2></div><label>Display name<input required maxLength={100} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label>Background<textarea maxLength={1500} value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} /></label><label>Learning preferences<textarea maxLength={1000} value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} /></label><div className="reference-edit-actions"><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="reference-primary">Save profile <CheckRounded /></button></div></form>}<div className="reference-kpi-grid profile-stats"><Metric value={String(goals.length)} label="Active courses" note="Personalized learning paths" tone="neutral" /><Metric value={activityStreak(workspace) ? `${activityStreak(workspace)}d` : '—'} label="Activity streak" note="Derived from real activity" tone="positive" /><Metric value={String(lessons)} label="Lessons created" note="Stored in your workspace" tone="neutral" /><Metric value={String(workspace.progress.badges.length)} label="Badges earned" note="Assessment evidence" tone="positive" /></div><section className="reference-section-block profile-goals"><div className="reference-section-heading"><div><span className="reference-kicker">LEARNING GOALS</span><h2>Courses shaped around you</h2></div><button className="reference-outline-button" onClick={onManageProfiles}><ManageAccountsRounded /> Manage profiles</button></div>{goals.length ? <div className="reference-goal-list">{goals.map((goal) => { const progress = goalProgress(workspace, goal.id); return <button key={goal.id} onClick={() => onOpenGoal(goal.id, 'profile')}><span><strong>{goal.title}</strong><small>{goalTemplate(goal)?.category ?? 'Custom course'}</small></span><div className="reference-goal-bar"><i style={{ width: `${progress ?? 0}%`, backgroundColor: goalTemplate(goal)?.color ?? customColor(goal.title) }} /></div><b>{progress === undefined ? '—' : `${progress}%`}</b></button>; })}</div> : <div className="reference-quiet">No learning goals yet. Add one from Workspace to start a course.</div>}</section><section className="reference-section-block profile-badges"><div className="reference-section-heading"><div><span className="reference-kicker">BADGES</span><h2>Evidence worth celebrating</h2></div></div>{workspace.progress.badges.length ? <div className="reference-badge-grid">{workspace.progress.badges.map((badge) => <div key={badge}><span><EmojiEventsRounded /></span><strong>{badge}</strong><small>Earned through assessment evidence</small></div>)}</div> : <div className="reference-quiet">Complete your first placement test to earn your first badge.</div>}</section></div>;
}

export function CourseDetailHeader({ workspace, online, aiConnected, onBack, onAddGoal }: { workspace: LearningWorkspace; online: boolean; aiConnected: boolean; onBack: () => void; onAddGoal: () => void }) {
  const status = !online ? 'Service offline' : aiConnected ? 'AI connected' : 'AI key unavailable';
  return <header className="reference-detail-header"><button className="reference-back-button" onClick={onBack}><ArrowBackRounded /> Back</button><div className="reference-detail-status"><span className={`reference-status-dot${online && aiConnected ? '' : ' offline'}`} /> {status} · {workspace.goals.find((goal) => goal.status === 'active')?.title ?? 'Course workspace'}</div><button className="reference-outline-button" onClick={onAddGoal}><AddRounded /> Add goal</button></header>;
}
