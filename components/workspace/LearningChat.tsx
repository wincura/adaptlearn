'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AutoAwesomeRounded, ChatRounded, DeleteSweepRounded, KeyboardArrowDownRounded, NorthRounded } from '@mui/icons-material';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import type { LearningWorkspace } from '../../shared/contracts';

type Props = {
  workspace: LearningWorkspace;
  online: boolean;
  onWorkspace: (workspace: LearningWorkspace) => void;
  onWorking: (active: boolean) => void;
  onError: (message: string) => void;
};

export function LearningChat({ workspace, online, onWorkspace, onWorking, onError }: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeGoal = workspace.goals.find((goal) => goal.status === 'active');

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [sending, workspace.conversation.length]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setMessage('');
    onWorking(true);
    try {
      const result = await api.chat(workspace.learnerId, text);
      onWorkspace(result.workspace);
    } catch (error) {
      setMessage(text);
      onError(error instanceof Error ? error.message : 'Your learning guide could not respond.');
    } finally {
      setSending(false);
      onWorking(false);
    }
  };

  const clearConversation = async () => {
    if (!workspace.conversation.length || sending) return;
    if (!window.confirm('Clear this chat history? Your profile, goals, lessons, documents, assessments, XP, and badges will be kept.')) return;
    setSending(true);
    try { onWorkspace(await api.clearChat(workspace.learnerId)); }
    catch (error) { onError(error instanceof Error ? error.message : 'The chat could not be cleared.'); }
    finally { setSending(false); }
  };

  return (
    <div className={`chat-widget ${open ? 'open' : 'minimized'}`}>
      {!open && <button className="chat-launcher" onClick={() => setOpen(true)} aria-label="Open learning guide"><ChatRounded /><span>Ask for an explanation</span><i className={online ? 'online' : ''} /></button>}
      {open && <aside className="learning-chat">
      <header className="chat-title"><span><AutoAwesomeRounded /></span><div><strong>Learning guide</strong><small>{online ? activeGoal ? `Current goal: ${activeGoal.title}` : 'No active goal' : 'Local service offline'}</small></div><button className="clear-chat" disabled={!workspace.conversation.length || sending} onClick={() => void clearConversation()} title="Clear chat" aria-label="Clear chat"><DeleteSweepRounded /></button><button className="minimize-chat" onClick={() => setOpen(false)} title="Minimize chat" aria-label="Minimize chat"><KeyboardArrowDownRounded /></button><i className={online ? 'online' : ''} /></header>
      <div className="chat-body">
        {workspace.conversation.length === 0 && <div className="chat-empty"><span>ASK FOR CLARITY</span><p>{activeGoal ? `Ask for an explanation related to “${activeGoal.title}” or about any concept you want clarified.` : 'Choose a learning goal, then ask about a concept you want explained in more detail.'} You’ll also get keywords you can use when creating your next lesson.</p></div>}
        {workspace.conversation.map((turn) => <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`chat-turn ${turn.role}`} key={turn.id}>{turn.role === 'assistant' ? <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a> }}>{turn.text}</ReactMarkdown></div> : <p>{turn.text}</p>}</motion.div>)}
        {sending && <div className="assistant-thinking"><i /><i /><i /><span>Thinking…</span></div>}
        <div ref={endRef} />
      </div>
      <form className="chat-compose" onSubmit={(event) => void send(event)}><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={activeGoal ? `Ask about ${activeGoal.title}` : 'What would you like explained?'} aria-label="Message your learning guide" /><div><span>Shift + Enter for a new line</span><button disabled={!online || !message.trim() || sending} aria-label="Send message"><NorthRounded /></button></div></form>
    </aside>}
    </div>
  );
}
