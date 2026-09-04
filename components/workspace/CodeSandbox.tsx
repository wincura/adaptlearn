'use client';

import { useState } from 'react';
import {
  ArrowForwardRounded,
  CheckCircleOutlineRounded,
  CodeRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  HelpOutlineRounded,
  LightbulbOutlined,
  PlayArrowRounded,
  RefreshRounded,
  TerminalRounded,
} from '@mui/icons-material';
import { CircularProgress } from '@mui/material';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import type { CodeEvaluationResponse, CodingChallenge, ExecutionResult, LearningWorkspace } from '../../shared/contracts';

type CodeSandboxProps = {
  challenge: CodingChallenge;
  learnerId?: string;
  goalId?: string;
  onCompleted?: (result: CodeEvaluationResponse, updatedWorkspace?: LearningWorkspace) => void;
};

export function CodeSandbox({ challenge, learnerId, goalId, onCompleted }: CodeSandboxProps) {
  const [code, setCode] = useState(challenge.starterCode);
  const [isRunning, setIsRunning] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [runResult, setRunResult] = useState<ExecutionResult | null>(null);
  const [evaluation, setEvaluation] = useState<CodeEvaluationResponse | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'feedback' | 'output'>(
    evaluation ? 'feedback' : 'output'
  );
  const [copyNotice, setCopyNotice] = useState(false);

  const resetCode = () => {
    if (window.confirm('Reset code back to the initial starter template?')) {
      setCode(challenge.starterCode);
      setRunResult(null);
      setEvaluation(null);
    }
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopyNotice(true);
    setTimeout(() => setCopyNotice(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const val = target.value;
      setCode(val.substring(0, start) + '  ' + val.substring(end));
      setTimeout(() => {
        target.selectionStart = target.selectionEnd = start + 2;
      }, 0);
    }
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    try {
      const result = await api.runCode(challenge.language, code);
      setRunResult(result);
      setActiveConsoleTab('output');
    } catch (err) {
      setRunResult({
        status: 'runtime_error',
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: 0,
      });
      setActiveConsoleTab('output');
    } finally {
      setIsRunning(false);
    }
  };

  const handleEvaluate = async () => {
    setIsEvaluating(true);
    try {
      const response = await api.evaluateCode(challenge, code, learnerId, goalId);
      setEvaluation(response.evaluation);
      setRunResult(response.evaluation.execution);
      setActiveConsoleTab('feedback');

      if (response.evaluation.passed && onCompleted) {
        onCompleted(response.evaluation, response.workspace);
      }
    } catch (err) {
      setEvaluation({
        passed: false,
        status: 'runtime_error',
        feedback: `Evaluation failed to complete: ${err instanceof Error ? err.message : String(err)}`,
        execution: {
          status: 'runtime_error',
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          exitCode: 1,
          durationMs: 0,
        },
      });
      setActiveConsoleTab('feedback');
    } finally {
      setIsEvaluating(false);
    }
  };

  const lineCount = Math.max(code.split('\n').length, 8);

  return (
    <section className="sandbox-panel">
      {/* Header */}
      <div className="sandbox-header">
        <div className="sandbox-title-wrap">
          <span className="sandbox-badge">
            <CodeRounded fontSize="inherit" /> {challenge.language.toUpperCase()} PRACTICAL TEST
          </span>
          <h3 className="sandbox-title">{challenge.title}</h3>
        </div>
        <div className="sandbox-actions">
          <button
            type="button"
            className="sandbox-ghost-btn"
            onClick={copyCode}
            title="Copy code to clipboard"
          >
            <ContentCopyRounded fontSize="small" />
            <span>{copyNotice ? 'Copied!' : 'Copy'}</span>
          </button>
          <button
            type="button"
            className="sandbox-ghost-btn"
            onClick={resetCode}
            title="Reset starter template"
          >
            <RefreshRounded fontSize="small" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Challenge Description */}
      <div className="sandbox-prompt-box">
        <div className="sandbox-prompt-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{challenge.prompt}</ReactMarkdown>
        </div>

        {/* Test Cases preview if present */}
        {challenge.testCases && challenge.testCases.length > 0 && (
          <div className="sandbox-testcases">
            <span className="sandbox-subhead">Verification Scenarios</span>
            <div className="sandbox-cases-grid">
              {challenge.testCases.map((tc, idx) => (
                <div key={tc.id || idx} className="sandbox-case-card">
                  <strong>Case {idx + 1}: {tc.description}</strong>
                  {tc.input && <code>Input: {tc.input}</code>}
                  {tc.expectedOutput && <code>Expected: {tc.expectedOutput}</code>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Hints toggle */}
        {challenge.hints && challenge.hints.length > 0 && (
          <div className="sandbox-hints-toggle">
            <button
              type="button"
              className="sandbox-hint-btn"
              onClick={() => setShowHints(!showHints)}
            >
              <LightbulbOutlined fontSize="small" />
              <span>{showHints ? 'Hide Socratic Hints' : `Need a hint? (${challenge.hints.length} available)`}</span>
            </button>
            <AnimatePresence>
              {showHints && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="sandbox-hints-list"
                >
                  {challenge.hints.map((hint, idx) => (
                    <div key={idx} className="sandbox-hint-item">
                      <HelpOutlineRounded fontSize="small" />
                      <p>{hint}</p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Editor & Controls */}
      <div className="sandbox-editor-wrap">
        <div className="sandbox-editor-bar">
          <span className="editor-lang-tag">solution.{challenge.language === 'python' ? 'py' : challenge.language === 'javascript' ? 'js' : challenge.language}</span>
          <span className="editor-lines-tag">{lineCount} lines</span>
        </div>
        <div className="sandbox-code-area">
          <div className="sandbox-line-numbers" aria-hidden="true">
            {Array.from({ length: lineCount }).map((_, i) => (
              <span key={i}>{i + 1}</span>
            ))}
          </div>
          <textarea
            className="sandbox-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Code editor"
            rows={Math.max(lineCount, 10)}
          />
        </div>
      </div>

      {/* Run & Evaluate Buttons */}
      <div className="sandbox-controls">
        <button
          type="button"
          className="sandbox-btn-secondary"
          onClick={handleRunCode}
          disabled={isRunning || isEvaluating}
        >
          {isRunning ? (
            <>
              <CircularProgress size={16} color="inherit" />
              <span>Running…</span>
            </>
          ) : (
            <>
              <PlayArrowRounded />
              <span>Run Code</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="sandbox-btn-primary"
          onClick={handleEvaluate}
          disabled={isRunning || isEvaluating}
        >
          {isEvaluating ? (
            <>
              <CircularProgress size={16} color="inherit" />
              <span>AI Tutor is evaluating…</span>
            </>
          ) : (
            <>
              <ArrowForwardRounded />
              <span>Test &amp; Get AI Feedback</span>
            </>
          )}
        </button>
      </div>

      {/* Output Console & AI Feedback Tabs */}
      {(runResult || evaluation) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="sandbox-console-panel"
        >
          <div className="console-tabs-bar">
            {evaluation && (
              <button
                type="button"
                className={`console-tab ${activeConsoleTab === 'feedback' ? 'active' : ''}`}
                onClick={() => setActiveConsoleTab('feedback')}
              >
                <LightbulbOutlined fontSize="small" />
                <span>AI Tutor Socratic Feedback</span>
              </button>
            )}
            <button
              type="button"
              className={`console-tab ${activeConsoleTab === 'output' ? 'active' : ''}`}
              onClick={() => setActiveConsoleTab('output')}
            >
              <TerminalRounded fontSize="small" />
              <span>Terminal Output {runResult?.durationMs ? `(${runResult.durationMs}ms)` : ''}</span>
            </button>
          </div>

          <div className="console-content">
            {activeConsoleTab === 'feedback' && evaluation && (
              <div className={`feedback-container ${evaluation.passed ? 'passed' : 'failed'}`}>
                <div className="feedback-status-banner">
                  {evaluation.passed ? (
                    <>
                      <CheckCircleOutlineRounded className="status-icon success" />
                      <div>
                        <strong>All Verification Tests Passed!</strong>
                        <span>Awesome work! {evaluation.xpAwarded ? `+${evaluation.xpAwarded} XP awarded` : ''}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ErrorOutlineRounded className="status-icon warning" />
                      <div>
                        <strong>Needs Adjustment ({evaluation.status})</strong>
                        <span>Review the Socratic guidance below to refine your solution.</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="feedback-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {evaluation.feedback}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {activeConsoleTab === 'output' && runResult && (
              <div className="terminal-container">
                <div className="terminal-header-meta">
                  <span className={`terminal-badge ${runResult.status}`}>
                    STATUS: {runResult.status.toUpperCase()} (code {runResult.exitCode})
                  </span>
                  <span>Execution time: {runResult.durationMs}ms</span>
                </div>

                {runResult.stdout ? (
                  <div className="terminal-section">
                    <span className="terminal-label">STDOUT:</span>
                    <pre className="terminal-pre stdout">{runResult.stdout}</pre>
                  </div>
                ) : null}

                {runResult.stderr ? (
                  <div className="terminal-section">
                    <span className="terminal-label">STDERR / DIAGNOSTICS:</span>
                    <pre className="terminal-pre stderr">{runResult.stderr}</pre>
                  </div>
                ) : null}

                {!runResult.stdout && !runResult.stderr && (
                  <p className="terminal-empty">Process finished with no standard output.</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </section>
  );
}
