'use client';

import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  ArrowForwardRounded,
  CheckCircleOutlineRounded,
  CheckCircleRounded,
  CodeRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  HelpOutlineRounded,
  LightbulbOutlined,
  LockOutlined,
  PlayArrowRounded,
  RefreshRounded,
  RuleRounded,
  TerminalRounded,
} from '@mui/icons-material';
import { CircularProgress } from '@mui/material';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../lib/api';
import type {
  CodeEvaluationResponse,
  CodingChallenge,
  ExecutionResult,
  LearningWorkspace,
  SupportedCodeLanguage,
  TestCaseResult,
} from '../../shared/contracts';

type CodeSandboxProps = {
  challenge: CodingChallenge;
  learnerId?: string;
  goalId?: string;
  onCompleted?: (result: CodeEvaluationResponse, updatedWorkspace?: LearningWorkspace) => void;
};

function getLanguageExtension(lang: SupportedCodeLanguage) {
  switch (lang) {
    case 'python':
      return [python()];
    case 'javascript':
      return [javascript({ jsx: true })];
    case 'typescript':
      return [javascript({ typescript: true, jsx: true })];
    case 'cpp':
      return [cpp()];
    case 'java':
      return [java()];
    case 'sql':
      return [sql()];
    default:
      return [python()];
  }
}

export function CodeSandbox({ challenge, learnerId, goalId, onCompleted }: CodeSandboxProps) {
  const [mounted, setMounted] = useState(false);
  const [code, setCode] = useState(challenge.starterCode);
  const [isRunning, setIsRunning] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [runResult, setRunResult] = useState<ExecutionResult | null>(null);
  const [evaluation, setEvaluation] = useState<CodeEvaluationResponse | null>(null);
  const [showHints, setShowHints] = useState(false);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'testcases' | 'feedback' | 'output'>('testcases');
  const [selectedCaseIndex, setSelectedCaseIndex] = useState(0);
  const [copyNotice, setCopyNotice] = useState(false);
  const [lastMode, setLastMode] = useState<'run' | 'submit' | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const allCases = challenge.testCases ?? [];
  const publicCases = allCases.filter((tc) => !tc.isHidden);
  const privateCases = allCases.filter((tc) => tc.isHidden);
  const privateCount = privateCases.length;

  const resetCode = () => {
    if (window.confirm('Reset code back to the initial starter template?')) {
      setCode(challenge.starterCode);
      setRunResult(null);
      setEvaluation(null);
      setLastMode(null);
    }
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(code);
    setCopyNotice(true);
    setTimeout(() => setCopyNotice(false), 2000);
  };

  const handleRunCode = async () => {
    setIsRunning(true);
    setLastMode('run');
    try {
      const res = await api.runTestCases(challenge, code);
      setRunResult(res.execution);
      setActiveConsoleTab('testcases');
      setSelectedCaseIndex(0);
    } catch (err) {
      setRunResult({
        status: 'runtime_error',
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: 0,
        testResults: publicCases.map((tc, idx) => ({
          testCaseId: tc.id,
          name: tc.description || `Case ${idx + 1}`,
          passed: false,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          error: err instanceof Error ? err.message : String(err),
          isHidden: false,
        })),
        passedCount: 0,
        totalCount: publicCases.length,
      });
      setActiveConsoleTab('testcases');
    } finally {
      setIsRunning(false);
    }
  };

  const handleEvaluate = async () => {
    setIsEvaluating(true);
    setLastMode('submit');
    try {
      const response = await api.evaluateCode(challenge, code, learnerId, goalId);
      setEvaluation(response.evaluation);
      setRunResult(response.evaluation.execution);
      setSelectedCaseIndex(0);

      if (response.evaluation.passed) {
        setActiveConsoleTab('feedback');
        if (onCompleted) {
          onCompleted(response.evaluation, response.workspace);
        }
      } else {
        setActiveConsoleTab('testcases');
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      setEvaluation({
        passed: false,
        status: 'runtime_error',
        feedback: `Evaluation failed to complete: ${errMessage}`,
        execution: {
          status: 'runtime_error',
          stdout: '',
          stderr: errMessage,
          exitCode: 1,
          durationMs: 0,
          testResults: allCases.map((tc, idx) => ({
            testCaseId: tc.id,
            name: tc.description || `Case ${idx + 1}`,
            passed: false,
            input: tc.input,
            expectedOutput: tc.expectedOutput,
            error: errMessage,
            isHidden: tc.isHidden,
          })),
          passedCount: 0,
          totalCount: allCases.length,
        },
      });
      setActiveConsoleTab('feedback');
    } finally {
      setIsEvaluating(false);
    }
  };

  const lineCount = Math.max(code.split('\n').length, 8);
  const testResults: TestCaseResult[] = runResult?.testResults ?? [];
  const activeTestCase = testResults[selectedCaseIndex] ?? testResults[0];

  const extName =
    challenge.language === 'python'
      ? 'py'
      : challenge.language === 'javascript'
      ? 'js'
      : challenge.language === 'typescript'
      ? 'ts'
      : challenge.language === 'cpp'
      ? 'cpp'
      : challenge.language === 'java'
      ? 'java'
      : challenge.language === 'sql'
      ? 'sql'
      : 'txt';

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

        {/* Test Cases preview: show public test cases + note about hidden private cases */}
        {publicCases.length > 0 && (
          <div className="sandbox-testcases">
            <div className="sandbox-testcases-header">
              <span className="sandbox-subhead">Verification Scenarios (Public Cases)</span>
              {privateCount > 0 && (
                <span className="sandbox-private-tag">
                  <LockOutlined fontSize="inherit" /> +{privateCount} hidden private test case{privateCount > 1 ? 's' : ''} evaluated on submission
                </span>
              )}
            </div>
            <div className="sandbox-cases-grid">
              {publicCases.map((tc, idx) => (
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

      {/* Language-Specific Code Editor */}
      <div className="sandbox-editor-wrap">
        <div className="sandbox-editor-bar">
          <span className="editor-lang-tag">solution.{extName}</span>
          <span className="editor-lines-tag">{lineCount} lines</span>
        </div>
        <div className="sandbox-code-area">
          {mounted ? (
            <CodeMirror
              value={code}
              height="auto"
              minHeight="260px"
              theme={oneDark}
              extensions={getLanguageExtension(challenge.language)}
              onChange={(val) => setCode(val)}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightSpecialChars: true,
                history: true,
                foldGutter: true,
                drawSelection: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                syntaxHighlighting: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: true,
                crosshairCursor: true,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                closeBracketsKeymap: true,
                defaultKeymap: true,
                searchKeymap: true,
                historyKeymap: true,
                foldKeymap: true,
                completionKeymap: true,
                lintKeymap: true,
              }}
              className="sandbox-codemirror"
            />
          ) : (
            <pre className="sandbox-editor-ssr-placeholder">{code}</pre>
          )}
        </div>
      </div>

      {/* LeetCode-style Action Controls */}
      <div className="sandbox-controls">
        <button
          type="button"
          className="sandbox-btn-secondary"
          onClick={handleRunCode}
          disabled={isRunning || isEvaluating}
          title="Run solution against public test cases"
        >
          {isRunning ? (
            <>
              <CircularProgress size={16} color="inherit" />
              <span>Running Public Tests…</span>
            </>
          ) : (
            <>
              <PlayArrowRounded />
              <span>Run Code (Public Tests)</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="sandbox-btn-primary"
          onClick={handleEvaluate}
          disabled={isRunning || isEvaluating}
          title="Submit solution to evaluate public & hidden private cases"
        >
          {isEvaluating ? (
            <>
              <CircularProgress size={16} color="inherit" />
              <span>Submitting &amp; Evaluating…</span>
            </>
          ) : (
            <>
              <ArrowForwardRounded />
              <span>Submit Solution</span>
            </>
          )}
        </button>
      </div>

      {/* Output Console, Testcase Results & AI Feedback Tabs */}
      {(runResult || evaluation) && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="sandbox-console-panel"
        >
          <div className="console-tabs-bar">
            {testResults.length > 0 && (
              <button
                type="button"
                className={`console-tab ${activeConsoleTab === 'testcases' ? 'active' : ''}`}
                onClick={() => setActiveConsoleTab('testcases')}
              >
                <RuleRounded fontSize="small" />
                <span>
                  Testcase Results
                  {runResult?.totalCount !== undefined
                    ? ` (${runResult.passedCount ?? 0}/${runResult.totalCount})`
                    : ''}
                </span>
              </button>
            )}

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
            {/* LeetCode-style Testcase Results Tab */}
            {activeConsoleTab === 'testcases' && testResults.length > 0 && (
              <div className="testcases-viewer">
                {/* Status Summary Banner */}
                <div
                  className={`testcase-summary-banner ${
                    runResult?.status === 'passed' ? 'passed' : 'failed'
                  }`}
                >
                  {runResult?.status === 'passed' ? (
                    <CheckCircleRounded className="status-icon success" />
                  ) : (
                    <ErrorOutlineRounded className="status-icon warning" />
                  )}
                  <div>
                    <strong>
                      {lastMode === 'submit'
                        ? runResult?.status === 'passed'
                          ? `Accepted! All ${runResult?.totalCount ?? 0} Test Cases Passed`
                          : `Submission Incomplete (${runResult?.passedCount ?? 0} / ${runResult?.totalCount ?? 0} Passed)`
                        : runResult?.status === 'passed'
                        ? `All Public Test Cases Passed (${runResult?.passedCount ?? 0}/${runResult?.totalCount ?? 0})`
                        : `${runResult?.passedCount ?? 0} / ${runResult?.totalCount ?? 0} Public Test Cases Passed`}
                    </strong>
                    <span>
                      {lastMode === 'submit'
                        ? runResult?.status === 'passed'
                          ? `All public & private edge cases verified. +25 XP awarded!`
                          : `Review the failing testcase or check the AI Tutor feedback for guidance.`
                        : runResult?.status === 'passed'
                        ? `Looking good! Click 'Submit Solution' to test against hidden private edge cases.`
                        : `Adjust your code to handle the failing public case before submitting.`}
                    </span>
                  </div>
                </div>

                {/* Case Chips Strip */}
                <div className="testcase-chips-strip">
                  {testResults.map((tc, idx) => (
                    <button
                      key={tc.testCaseId || idx}
                      type="button"
                      className={`testcase-chip ${selectedCaseIndex === idx ? 'active' : ''} ${
                        tc.passed ? 'passed' : 'failed'
                      }`}
                      onClick={() => setSelectedCaseIndex(idx)}
                    >
                      <span className="testcase-chip-icon">
                        {tc.passed ? '✓' : '✗'}
                      </span>
                      <span>
                        {tc.isHidden ? `Private Case ${idx + 1}` : `Case ${idx + 1}`}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Selected Testcase Details Card */}
                {activeTestCase && (
                  <div className="testcase-detail-card">
                    <div className="testcase-detail-header">
                      <div className="testcase-detail-title">
                        <strong>
                          {activeTestCase.isHidden ? 'Private Edge Case' : 'Public Test Case'}:{' '}
                          {activeTestCase.name}
                        </strong>
                        <div className="testcase-badges">
                          {activeTestCase.isHidden ? (
                            <span className="testcase-pill hidden">
                              <LockOutlined fontSize="inherit" /> Hidden Private Case
                            </span>
                          ) : (
                            <span className="testcase-pill public">Public Case</span>
                          )}
                          <span
                            className={`testcase-pill ${
                              activeTestCase.passed ? 'passed' : 'failed'
                            }`}
                          >
                            {activeTestCase.passed ? 'PASSED' : 'WRONG ANSWER / FAILED'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="testcase-io-grid">
                      {activeTestCase.input && (
                        <div className="testcase-io-block">
                          <span className="testcase-io-label">Input:</span>
                          <pre className="testcase-io-pre">{activeTestCase.input}</pre>
                        </div>
                      )}

                      {activeTestCase.expectedOutput && (
                        <div className="testcase-io-block">
                          <span className="testcase-io-label">Expected Output:</span>
                          <pre className="testcase-io-pre">{activeTestCase.expectedOutput}</pre>
                        </div>
                      )}

                      <div
                        className={`testcase-io-block ${
                          activeTestCase.passed ? 'actual-success' : 'actual-fail'
                        }`}
                      >
                        <span className="testcase-io-label">
                          {activeTestCase.passed ? 'Actual Output:' : 'Error / Difference:'}
                        </span>
                        <pre className="testcase-io-pre">
                          {activeTestCase.passed
                            ? activeTestCase.actualOutput || activeTestCase.expectedOutput || 'Passed assertions'
                            : activeTestCase.error || 'Failed assertion'}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI Tutor Socratic Feedback Tab */}
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

            {/* Terminal Output Tab */}
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
