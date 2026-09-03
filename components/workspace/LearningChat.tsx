'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { AutoAwesomeRounded, DeleteSweepRounded, NorthRounded } from '@mui/icons-material';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import type { AgentId, LearningWorkspace } from '../../shared/contracts';

type Props = {
  workspace: LearningWorkspace;
  online: boolean;
  onWorkspace: (workspace: LearningWorkspace) => void;
  onWorking: (active: boolean) => void;
  onError: (message: string) => void;
};

const shortcuts: Array<{ label: string; prompt: string; route?: AgentId }> = [
  { label: 'Shape my goal', prompt: 'Help me turn my interests into a focused learning goal.' },
  { label: 'Explain a topic', prompt: 'Teach me one focused concept for my active goal with clear examples.', route: 'teacher' },
  { label: 'Give me practice', prompt: 'Create a hands-on practice idea for my active goal.', route: 'builder' },
  { label: 'Check my level', prompt: 'Help me assess my current level for my active goal.', route: 'assessor' },
  { label: 'Find updates', prompt: 'Find useful current developments related to my active goal.', route: 'researcher' },
];

export function LearningChat({ workspace, online, onWorkspace, onWorking, onError }: Props) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [sending, workspace.conversation.length]);

  const send = async (event?: FormEvent, shortcut?: typeof shortcuts[number]) => {
    event?.preventDefault();
    const text = (shortcut?.prompt ?? message).trim();
    const route = shortcut?.route;
    if (!text || sending) return;
    setSending(true);
    setMessage('');
    onWorking(true);
    try {
      const result = await api.chat(workspace.learnerId, text, route);
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
    <aside className="learning-chat">
      <header className="chat-title"><span><AutoAwesomeRounded /></span><div><strong>Learning guide</strong><small>{online ? 'AI connected · remembers this workspace' : 'Local service offline'}</small></div><button className="clear-chat" disabled={!workspace.conversation.length || sending} onClick={() => void clearConversation()} title="Clear chat" aria-label="Clear chat"><DeleteSweepRounded /></button><i className={online ? 'online' : ''} /></header>
      <div className="chat-shortcuts">{shortcuts.map((shortcut) => <button disabled={!online || sending} onClick={() => void send(undefined, shortcut)} key={shortcut.label}>{shortcut.label}</button>)}</div>
      <div className="chat-body">
        {workspace.conversation.length === 0 && <div className="chat-empty"><span>START HERE</span><p>Tell me what you want to become better at. I’ll remember the context and help create the right next step.</p></div>}
        {workspace.conversation.map((turn) => <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={`chat-turn ${turn.role}`} key={turn.id}>{turn.role === 'assistant' ? <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, title, children }) => <a href={href} title={title} target="_blank" rel="noreferrer">{children}</a> }}>{turn.text}</ReactMarkdown></div> : <p>{turn.text}</p>}</motion.div>)}
        {sending && <div className="assistant-thinking"><i /><i /><i /><span>Thinking…</span></div>}
        <div ref={endRef} />
      </div>
      <form className="chat-compose" onSubmit={(event) => void send(event)}><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask anything about your learning…" aria-label="Message your learning guide" /><div><span>Shift + Enter for a new line</span><button disabled={!online || !message.trim() || sending} aria-label="Send message"><NorthRounded /></button></div></form>
    </aside>
  );
}
