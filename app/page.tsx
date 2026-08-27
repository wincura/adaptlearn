'use client';

import { ChangeEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  IconButton,
  LinearProgress,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  AddRounded,
  ArrowForwardRounded,
  AttachFileRounded,
  AutoAwesomeRounded,
  BarChartRounded,
  CheckRounded,
  CloseRounded,
  CodeRounded,
  HomeRounded,
  LanguageRounded,
  LocalFireDepartmentRounded,
  LockRounded,
  MenuBookRounded,
  MoreHorizRounded,
  NotificationsRounded,
  PsychologyRounded,
  ScienceRounded,
  SendRounded,
  TableChartRounded,
  UploadFileRounded,
  WorkspacePremiumRounded,
} from '@mui/icons-material';
import { AnimatePresence, motion } from 'motion/react';

type NavView = 'home' | 'courses' | 'progress' | 'badges';
type ChatMode = 'Teacher' | 'Conversation';
type Message = { role: 'coach' | 'user'; text: string };

const navItems = [
  { id: 'home' as const, label: 'Home', icon: HomeRounded },
  { id: 'courses' as const, label: 'Learning paths', icon: MenuBookRounded },
  { id: 'progress' as const, label: 'Progress', icon: BarChartRounded },
  { id: 'badges' as const, label: 'Achievements', icon: WorkspacePremiumRounded },
];

const modules = [
  { label: 'Variables & types', meta: 'Completed · +80 XP', state: 'done' },
  { label: 'Making decisions', meta: 'Lesson 3 of 5', state: 'active' },
  { label: 'Loops that work for you', meta: 'Unlock at 420 XP', state: 'locked' },
];

const tracks = [
  { title: 'Python foundations', note: 'Active · 42% complete', icon: CodeRounded, tone: 'forest' },
  { title: 'French for real life', note: 'Suggested for you', icon: LanguageRounded, tone: 'coral' },
  { title: 'Excel essentials', note: '12 practical projects', icon: TableChartRounded, tone: 'blue' },
  { title: 'SQL from zero', note: 'Beginner · 6 weeks', icon: ScienceRounded, tone: 'gold' },
];

const fallbackReply = (input: string, mode: ChatMode) => {
  const lower = input.toLowerCase();
  if (lower.includes('and') || lower.includes(' or')) {
    return mode === 'Teacher'
      ? '`and` needs both conditions to be true; `or` needs only one. Try this: would `rainy or cold` be true on a warm rainy day?'
      : 'Think of it this way: “coffee and cake” means both, while “coffee or cake” lets you pick one. Want to try your own example?';
  }
  if (lower.includes('stuck') || lower.includes('help')) {
    return 'Let’s shrink the problem. Tell me what you expected, what actually happened, and the smallest line that feels confusing.';
  }
  return mode === 'Teacher'
    ? 'Good question. I’ll connect it to your current lesson and keep the explanation practical. What part would you like to try first?'
    : 'Let’s explore that together. Explain how you currently understand it—even a rough answer is useful.';
};

export default function Home() {
  const [activeView, setActiveView] = useState<NavView>('home');
  const [mode, setMode] = useState<ChatMode>('Teacher');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'coach', text: 'Before you continue—want a quick refresher on how `and` differs from `or`?' },
  ]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [topic, setTopic] = useState('Python');
  const [level, setLevel] = useState('Absolute beginner');
  const [style, setStyle] = useState('Learn by doing');
  const [quizAnswer, setQuizAnswer] = useState<string | null>(null);
  const [xp, setXp] = useState(360);
  const [profileReady, setProfileReady] = useState(false);
  const [toast, setToast] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const hydrateProfile = window.setTimeout(() => {
      const saved = window.localStorage.getItem('adaptlearn-profile');
      if (saved) {
        const profile = JSON.parse(saved) as { topic?: string; level?: string; style?: string; xp?: number };
        if (profile.topic) setTopic(profile.topic);
        if (profile.level) setLevel(profile.level);
        if (profile.style) setStyle(profile.style);
        if (profile.xp) setXp(profile.xp);
        setProfileReady(true);
      } else {
        setOnboardingOpen(true);
      }
    }, 0);
    return () => window.clearTimeout(hydrateProfile);
  }, []);

  useEffect(() => {
    if (!profileReady) return;
    window.localStorage.setItem('adaptlearn-profile', JSON.stringify({ topic, level, style, xp }));
  }, [profileReady, topic, level, style, xp]);

  const completeOnboarding = () => {
    setProfileReady(true);
    setOnboardingOpen(false);
    setOnboardingStep(0);
    setToast(`Your ${topic} path is ready — placement set to ${level}.`);
  };

  const sendMessage = async (override?: string) => {
    const text = (override ?? message).trim();
    if (!text || sending) return;
    setMessage('');
    setMessages((current) => [...current, { role: 'user', text }]);
    setSending(true);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, mode, profile: { topic, level, style, xp } }),
      });
      if (!response.ok) throw new Error('Local API unavailable');
      const data = (await response.json()) as { reply: string };
      setMessages((current) => [...current, { role: 'coach', text: data.reply }]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 450));
      setMessages((current) => [...current, { role: 'coach', text: fallbackReply(text, mode) }]);
    } finally {
      setSending(false);
    }
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setToast(`${file.name} added to this learning path.`);
    setMessages((current) => [
      ...current,
      { role: 'coach', text: `I’ve indexed “${file.name}”. I’ll use it as a trusted source and clearly distinguish it from public documentation.` },
    ]);
    event.target.value = '';
  };

  const checkAnswer = (answer: string) => {
    setQuizAnswer(answer);
    if (answer === 'both') {
      setXp((current) => current + 40);
      setToast('Correct — +40 XP. Your next activity just adapted.');
    }
  };

  const renderHome = () => (
    <motion.div key="home" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <section className="course-hero">
        <div className="course-copy">
          <div className="course-kicker"><span>PYTHON FOUNDATIONS</span><span>{level.toUpperCase()}</span></div>
          <h2>Make your code<br />make decisions.</h2>
          <p>Next up: Combine conditions to solve a real-world delivery problem.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => setLessonOpen(true)}>Continue learning <ArrowForwardRounded /></button>
            <span>12 min · hands-on</span>
          </div>
        </div>
        <div className="code-art" aria-hidden="true">
          <div><i>if</i> weather == <b>&quot;rain&quot;</b>:</div>
          <div className="indent">bring(<b>&quot;umbrella&quot;</b>)</div>
          <div><i>else</i>:</div>
          <div className="indent">enjoy_the_day()</div>
          <span className="cursor" />
        </div>
      </section>

      <section className="pulse-row" aria-label="Learning summary">
        <div><span className="pulse-icon lime"><PsychologyRounded /></span><p><strong>Learn by doing</strong><small>Your adaptive style</small></p></div>
        <div><span className="pulse-icon peach"><LocalFireDepartmentRounded /></span><p><strong>7 day streak</strong><small>Personal best: 12</small></p></div>
        <div><span className="pulse-icon sky"><AutoAwesomeRounded /></span><p><strong>{xp} XP</strong><small>140 until next level</small></p></div>
      </section>

      <div className="section-heading">
        <div><p className="eyebrow">YOUR PATH</p><h3>Python Foundations</h3></div>
        <button onClick={() => setCurriculumOpen(true)}>View curriculum</button>
      </div>
      <section className="module-list">
        {modules.map((module, index) => (
          <article className={`module-row ${module.state}`} key={module.label}>
            <div className="module-index">{module.state === 'done' ? <CheckRounded /> : module.state === 'locked' ? <LockRounded /> : index + 1}</div>
            <div className="module-info"><strong>{module.label}</strong><span>{module.meta}</span></div>
            {module.state === 'active' && <div className="mini-progress"><span /></div>}
            <button aria-label={`Open ${module.label}`} onClick={() => module.state !== 'locked' && setLessonOpen(true)}><ArrowForwardRounded /></button>
          </article>
        ))}
      </section>
    </motion.div>
  );

  const renderCourses = () => (
    <motion.div className="view-page" key="courses" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="page-title"><p className="eyebrow">LEARNING LIBRARY</p><h2>Your learning paths</h2><p>Each path adjusts its pace, examples, and practice to your progress.</p></div>
      <div className="track-grid">
        {tracks.map(({ title, note, icon: Icon, tone }) => (
          <button className="track-card" key={title} onClick={() => title.startsWith('Python') ? setActiveView('home') : setToast(`${title} added to your shortlist.`)}>
            <span className={`track-icon ${tone}`}><Icon /></span><small>{note}</small><strong>{title}</strong><span>Explore path <ArrowForwardRounded /></span>
          </button>
        ))}
        <button className="track-card add-track" onClick={() => setOnboardingOpen(true)}><AddRounded /><strong>Start a new path</strong><small>Tell us what you want to learn</small></button>
      </div>
      <section className="source-card">
        <div><UploadFileRounded /><span><strong>Teach from your own sources</strong><small>Upload documentation for specialist or proprietary tools.</small></span></div>
        <button onClick={() => fileInput.current?.click()}>Upload documentation</button>
      </section>
    </motion.div>
  );

  const renderProgress = () => (
    <motion.div className="view-page" key="progress" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="page-title"><p className="eyebrow">YOUR MOMENTUM</p><h2>Progress, with context</h2><p>Your assessor updates your level from demonstrated skills—not time spent.</p></div>
      <div className="metric-grid"><div><span>Current level</span><strong>Beginner 2</strong><small>↑ one level this month</small></div><div><span>Total XP</span><strong>{xp}</strong><small>Top 28% this week</small></div><div><span>Mastery</span><strong>74%</strong><small>Across 6 skills</small></div></div>
      <section className="chart-card"><div className="chart-head"><div><strong>Skill confidence</strong><small>Assessed from exercises and conversations</small></div><span>Last 30 days</span></div>
        {[['Variables', 92], ['Data types', 84], ['Conditions', 68], ['Debugging', 57], ['Loops', 24]].map(([label, value]) => <div className="skill-bar" key={label}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><b>{value}%</b></div>)}
      </section>
    </motion.div>
  );

  const renderBadges = () => (
    <motion.div className="view-page" key="badges" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="page-title"><p className="eyebrow">MILESTONES</p><h2>Achievements</h2><p>Small signals that show real learning momentum.</p></div>
      <div className="badge-grid">
        {[['🔥','On a roll','Learned 7 days in a row'],['◇','First principles','Explained a concept in your own words'],['⚡','Bug hunter','Fixed five code errors'],['↗','Level up','Advanced from absolute beginner'],['⌁','Curious mind','Asked 25 follow-up questions'],['?','Next badge','Complete your first project']].map(([symbol,title,note], index) => <article className={index === 5 ? 'locked-badge' : ''} key={title}><span>{symbol}</span><strong>{title}</strong><small>{note}</small></article>)}
      </div>
    </motion.div>
  );

  return (
    <main className="app-shell">
      <aside className="rail">
        <button className="brand-mark" onClick={() => setActiveView('home')} aria-label="AdaptLearn home">A</button>
        <nav aria-label="Primary navigation">
          {navItems.map(({ id, label, icon: Icon }) => <Tooltip title={label} placement="right" key={id}><button className={`rail-button ${activeView === id ? 'active' : ''}`} onClick={() => setActiveView(id)} aria-label={label}><Icon /></button></Tooltip>)}
        </nav>
        <button className="avatar" aria-label="Profile">MW</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">THURSDAY, 27 AUGUST</p><h1>Ready for your next win, Maya?</h1></div>
          <div className="top-actions">
            <button className="whats-new" onClick={() => setNewsOpen(true)}><AutoAwesomeRounded /> What&apos;s new?</button>
            <button className="new-path" onClick={() => setOnboardingOpen(true)}><AddRounded /> New path</button>
            <button className="streak" onClick={() => setToast('Your next check-in is scheduled for tomorrow at 6:00 PM.')}><LocalFireDepartmentRounded /><strong>7</strong><span>day streak</span></button>
            <IconButton className="notification-button" aria-label="Notifications" onClick={() => setToast('You’re all caught up.')}><NotificationsRounded /></IconButton>
          </div>
        </header>

        <div className="main-grid">
          <section className="learning-column"><AnimatePresence mode="wait">{activeView === 'home' ? renderHome() : activeView === 'courses' ? renderCourses() : activeView === 'progress' ? renderProgress() : renderBadges()}</AnimatePresence></section>

          <aside className="coach-panel">
            <div className="coach-header"><div className="coach-avatar">L</div><div><strong>Learning coach</strong><span><i /> online · knows your path</span></div><IconButton aria-label="Coach options"><MoreHorizRounded /></IconButton></div>
            <div className="agent-strip"><span><PsychologyRounded /> Coordinator</span><i>routes to</i><span>Teacher</span></div>
            <div className="chat-thread">
              {messages.map((item, index) => <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`message ${item.role}`} key={`${item.role}-${index}`}><p>{item.text}</p>{index === 0 && <div className="choice-row"><button onClick={() => sendMessage('Yes, refresh me on and versus or.')}>Yes, refresh me</button><button onClick={() => setLessonOpen(true)}>I&apos;m good</button></div>}</motion.div>)}
              {sending && <div className="typing"><i /><i /><i /></div>}
              <div className="insight-card"><span>ADAPTIVE NOTE</span><p>You learn fastest by trying first. Explanations will stay short and sandboxes will appear early.</p></div>
            </div>
            <div className="prompt-box">
              <textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} aria-label="Ask your learning coach" placeholder={mode === 'Teacher' ? 'Ask about this lesson…' : 'Start a free conversation…'} />
              <div><IconButton aria-label="Attach documentation" onClick={() => fileInput.current?.click()}><AttachFileRounded /></IconButton><button className="mode-switch" onClick={() => setMode(mode === 'Teacher' ? 'Conversation' : 'Teacher')}>{mode} mode</button><IconButton className="send" disabled={!message.trim() || sending} aria-label="Send message" onClick={() => sendMessage()}><SendRounded /></IconButton></div>
            </div>
            <input ref={fileInput} onChange={handleUpload} type="file" accept=".pdf,.doc,.docx,.txt,.md,.csv,.zip" hidden />
          </aside>
        </div>
      </section>

      <Dialog open={lessonOpen} onClose={() => setLessonOpen(false)} maxWidth="md" fullWidth slotProps={{ paper: { className: 'app-dialog lesson-dialog' } }}>
        <IconButton className="dialog-close" onClick={() => setLessonOpen(false)} aria-label="Close lesson"><CloseRounded /></IconButton>
        <DialogContent>
          <p className="eyebrow">LESSON 3 · MAKING DECISIONS</p><h2>When two things need to be true</h2><p className="lesson-lead">Use <code>and</code> when a decision should only happen after every condition passes.</p>
          <div className="lesson-split"><div className="explanation"><span>PLAIN ENGLISH</span><p>“Deliver the package if the address is valid <b>and</b> someone is home.” Both checks protect the decision.</p><div className="tip"><AutoAwesomeRounded /><p><strong>Why this example?</strong><br />You retain concepts 18% better with concrete scenarios.</p></div></div><pre><code><i>address_valid</i> = True{`\n`}<i>someone_home</i> = True{`\n\n`}if address_valid <b>and</b> someone_home:{`\n`}    deliver_package()</code></pre></div>
          <div className="quick-check"><span>QUICK CHECK</span><h3>When does <code>A and B</code> evaluate to true?</h3><div>{[['a','When A is true'],['either','When either is true'],['both','When both are true']].map(([id, label]) => <button className={`${quizAnswer === id ? 'selected' : ''} ${quizAnswer && id === 'both' ? 'correct' : ''}`} onClick={() => checkAnswer(id)} key={id}>{label}{quizAnswer && id === 'both' && <CheckRounded />}</button>)}</div>{quizAnswer && quizAnswer !== 'both' && <p className="feedback">Almost. With <code>and</code>, neither condition can be false. Try once more.</p>}</div>
        </DialogContent>
      </Dialog>

      <Dialog open={onboardingOpen} onClose={() => setOnboardingOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'app-dialog onboarding-dialog' } }}>
        <IconButton className="dialog-close" onClick={() => setOnboardingOpen(false)} aria-label="Close onboarding"><CloseRounded /></IconButton>
        <DialogContent>
          <div className="onboarding-progress"><span>SET UP YOUR PATH</span><b>{onboardingStep + 1} / 3</b></div><LinearProgress variant="determinate" value={[33, 66, 100][onboardingStep]} />
          {onboardingStep === 0 && <div className="onboarding-step"><h2>What do you want to learn?</h2><p>Choose a starting point. Your curriculum can expand with you.</p><div className="option-grid">{['Python','French','Excel','SQL','Java OOP'].map((item) => <button className={topic === item ? 'selected' : ''} onClick={() => setTopic(item)} key={item}>{item}</button>)}<button className="upload-option" onClick={() => fileInput.current?.click()}><UploadFileRounded /> Proprietary tool</button></div></div>}
          {onboardingStep === 1 && <div className="onboarding-step"><h2>Meet us where you are.</h2><p>A short placement check will confirm this starting point.</p><label>Current familiarity</label><div className="option-stack">{['Absolute beginner','Beginner','Intermediate','Professional'].map((item) => <button className={level === item ? 'selected' : ''} onClick={() => setLevel(item)} key={item}><span>{item}</span>{level === item && <CheckRounded />}</button>)}</div><label>Preferred learning style</label><div className="style-row">{['Learn by doing','Visual examples','Conversation'].map((item) => <button className={style === item ? 'selected' : ''} onClick={() => setStyle(item)} key={item}>{item}</button>)}</div></div>}
          {onboardingStep === 2 && <div className="onboarding-step ready-step"><span className="ready-icon"><PsychologyRounded /></span><h2>Your path is ready to calibrate.</h2><p>The Assessor will start with a brief, low-pressure placement activity. You can skip anything unfamiliar.</p><div className="profile-summary"><div><span>Track</span><strong>{topic}</strong></div><div><span>Starting point</span><strong>{level}</strong></div><div><span>Style</span><strong>{style}</strong></div></div></div>}
          <div className="dialog-actions">{onboardingStep > 0 && <button className="secondary-button" onClick={() => setOnboardingStep((step) => step - 1)}>Back</button>}<button className="primary-button" onClick={() => onboardingStep === 2 ? completeOnboarding() : setOnboardingStep((step) => step + 1)}>{onboardingStep === 2 ? 'Start placement check' : 'Continue'} <ArrowForwardRounded /></button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={newsOpen} onClose={() => setNewsOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'app-dialog news-dialog' } }}><IconButton className="dialog-close" onClick={() => setNewsOpen(false)} aria-label="Close"><CloseRounded /></IconButton><DialogContent><p className="eyebrow">FROM YOUR RESEARCHER</p><h2>What’s new in your field</h2><p>Suggestions stay separate from your curriculum until you approve them.</p><article><span>PYTHON · 4 MIN READ</span><h3>Type hints are becoming a practical beginner skill</h3><p>They can make your early programs easier to understand without changing how Python runs them.</p><button onClick={() => { setNewsOpen(false); setToast('Added to your learning suggestions — your Teacher will keep it scoped.'); }}>Add as an optional lesson <ArrowForwardRounded /></button></article><article><span>TOOLING · OPTIONAL</span><h3>A gentler way to debug in VS Code</h3><p>Learn breakpoints after your first loop project, when the concept becomes useful.</p><button onClick={() => setToast('Saved for later.')} >Save for later</button></article></DialogContent></Dialog>

      <Dialog open={curriculumOpen} onClose={() => setCurriculumOpen(false)} maxWidth="sm" fullWidth slotProps={{ paper: { className: 'app-dialog curriculum-dialog' } }}><IconButton className="dialog-close" onClick={() => setCurriculumOpen(false)} aria-label="Close"><CloseRounded /></IconButton><DialogContent><p className="eyebrow">FIXED CORE · ADAPTIVE EXTENSIONS</p><h2>Python Foundations</h2><p>Your core sequence stays coherent. The Teacher adds refreshers and stretch activities when your evidence calls for them.</p>{['How programs think','Variables & types','Making decisions','Loops that work for you','Functions & reuse','Your first useful project'].map((item,index) => <div className={index < 2 ? 'complete' : index === 2 ? 'current' : ''} key={item}><span>{index < 2 ? <CheckRounded /> : index + 1}</span><strong>{item}</strong><small>{index === 2 ? 'You are here' : index < 2 ? 'Complete' : 'Upcoming'}</small></div>)}</DialogContent></Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={3600} onClose={() => setToast('')} message={toast} />
    </main>
  );
}
