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
  ChevronLeftRounded,
  ChevronRightRounded,
  CodeRounded,
  ContentCopyRounded,
  ErrorOutlineRounded,
  ExpandMoreRounded,
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
  challenges?: CodingChallenge[];
  materialId?: string;
  learnerId?: string;
  goalId?: string;
  onRequestNextChallenge?: () => Promise<CodingChallenge | void>;
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

export function formatPromptMarkdown(prompt: string): string {
  if (!prompt) return '';
  let text = prompt.trim();

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n');

  // Convert common section keywords into clean, professional Markdown H3 headings (no emojis)
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Task(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Task\n\n');
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Problem Statement(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Problem Statement\n\n');
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Input\s*[\/&]\s*Output(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Input & Output Format\n\n');
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Constraints?(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Constraints\n\n');
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Examples?(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Examples\n\n');
  text = text.replace(/(?:^|\n)(?:#{1,4}\s*)?(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*)?Notes?(?:\s*:)?\s*(?=\n|$)/gui, '\n\n### Notes\n\n');

  // Strip any remaining emojis from Markdown headings
  text = text.replace(/(^|\n)(#{1,4}\s*)[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/gu, '$1$2');

  // Format function signatures: e.g. "Implement the function my_func(a: int) -> int"
  text = text.replace(/(Implement (?:the )?function\s+)([a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)(?:\s*->\s*[^\n.]+)?)/gi, '$1`$2`');

  // Format single-quoted identifiers as inline code (e.g. 'lst_changed' -> `lst_changed`)
  text = text.replace(/(?<!`)(?:'([a-zA-Z_][a-zA-Z0-9_]*)')(?!`)/g, '`$1`');

  // Process line by line to add bullet points and blockquotes in appropriate sections
  const rawLines = text.split('\n');
  const resultLines: string[] = [];
  let currentSection = '';

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    const line = rawLine.trim();

    if (!line) {
      resultLines.push('');
      continue;
    }

    if (line.startsWith('### Task') || line.startsWith('### Problem Statement')) {
      currentSection = 'task';
      resultLines.push(line);
      continue;
    } else if (line.startsWith('### Constraints')) {
      currentSection = 'constraints';
      resultLines.push(line);
      continue;
    } else if (line.startsWith('### Input & Output')) {
      currentSection = 'io';
      resultLines.push(line);
      continue;
    } else if (line.startsWith('### Examples')) {
      currentSection = 'examples';
      resultLines.push(line);
      continue;
    } else if (line.startsWith('###')) {
      currentSection = '';
      resultLines.push(line);
      continue;
    }

    if (currentSection === 'constraints') {
      if (!line.startsWith('-') && !line.startsWith('*') && !/^\d+\./.test(line)) {
        resultLines.push(`- ${line}`);
        continue;
      }
    }

    if (currentSection === 'io') {
      if (line.startsWith('Input:') || line.startsWith('Output:')) {
        const colon = line.indexOf(':');
        resultLines.push(`**${line.slice(0, colon + 1)}** ${line.slice(colon + 1).trim()}`);
        continue;
      }
      if (!line.startsWith('-') && !line.startsWith('*') && (line.startsWith('`') || line.includes(':'))) {
        resultLines.push(`- ${line}`);
        continue;
      }
    }

    if (currentSection === 'task') {
      if (
        !line.startsWith('-') &&
        !line.startsWith('*') &&
        !line.startsWith('`') &&
        !line.toLowerCase().startsWith('implement') &&
        !line.toLowerCase().startsWith('inside') &&
        (line.startsWith('the ') || line.startsWith('whether ') || line.startsWith('how ') || line.startsWith('return ') || line.startsWith('must '))
      ) {
        resultLines.push(`- ${line}`);
        continue;
      }
    }

    if (currentSection === 'examples') {
      if (line.startsWith('Input:') || line.startsWith('Output:') || line.startsWith('Explanation:')) {
        const colon = line.indexOf(':');
        resultLines.push(`> **${line.slice(0, colon + 1)}** ${line.slice(colon + 1).trim()}`);
        continue;
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function CodeSandbox({
  challenge: initialChallenge,
  challenges: initialChallenges,
  materialId,
  learnerId,
  goalId,
  onRequestNextChallenge,
  onCompleted,
}: CodeSandboxProps) {
  const [mounted, setMounted] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<CodingChallenge>(initialChallenge);
  const [allChallenges, setAllChallenges] = useState<CodingChallenge[]>(
    initialChallenges && initialChallenges.length > 0 ? initialChallenges : [initialChallenge],
  );
  const [codeMap, setCodeMap] = useState<Record<string, string>>({
    [initialChallenge.id]: initialChallenge.starterCode,
  });
  const [code, setCode] = useState(initialChallenge.starterCode);
  const [isRunning, setIsRunning] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGeneratingNext, setIsGeneratingNext] = useState(false);
  const [nextError, setNextError] = useState<string | null>(null);
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

  useEffect(() => {
    setActiveChallenge(initialChallenge);
    setCodeMap((prev) => {
      if (prev[initialChallenge.id]) return prev;
      return { ...prev, [initialChallenge.id]: initialChallenge.starterCode };
    });
  }, [initialChallenge.id]);

  useEffect(() => {
    if (initialChallenges && initialChallenges.length > 0) {
      setAllChallenges(initialChallenges);
    }
  }, [initialChallenges]);

  const challenge = activeChallenge;
  const allCases = challenge.testCases ?? [];
  const publicCases = allCases.filter((tc) => !tc.isHidden);
  const privateCases = allCases.filter((tc) => tc.isHidden);
  const privateCount = privateCases.length;

  const handleCodeChange = (val: string) => {
    setCode(val);
    setCodeMap((prev) => ({ ...prev, [challenge.id]: val }));
  };

  const handleSelectChallenge = (targetChallenge: CodingChallenge) => {
    if (targetChallenge.id === challenge.id) return;
    setActiveChallenge(targetChallenge);
    const existingCode = codeMap[targetChallenge.id] ?? targetChallenge.starterCode;
    setCode(existingCode);
    setRunResult(null);
    setEvaluation(null);
    setLastMode(null);
    setSelectedCaseIndex(0);
    setActiveConsoleTab('testcases');
    setNextError(null);
  };

  const resetCode = () => {
    if (window.confirm('Reset code back to the initial starter template?')) {
      setCode(challenge.starterCode);
      setCodeMap((prev) => ({ ...prev, [challenge.id]: challenge.starterCode }));
      setRunResult(null);
      setEvaluation(null);
      setLastMode(null);
    }
  };

  const handleNextPracticeQuestion = async () => {
    setIsGeneratingNext(true);
    setNextError(null);
    try {
      let nextChallenge: CodingChallenge | undefined = undefined;
      if (onRequestNextChallenge) {
        const result = await onRequestNextChallenge();
        nextChallenge = result || undefined;
      } else if (learnerId && materialId) {
        const res = await api.generateCodingChallenge(learnerId, materialId, true);
        nextChallenge = res.challenge;
        if (onCompleted && res.workspace) {
          onCompleted(evaluation!, res.workspace);
        }
      }

      if (nextChallenge) {
        setAllChallenges((prev) => {
          const filtered = prev.filter((item) => item.id !== nextChallenge!.id);
          return [...filtered, nextChallenge!];
        });
        setActiveChallenge(nextChallenge);
        setCode(nextChallenge.starterCode);
        setCodeMap((prev) => ({ ...prev, [nextChallenge!.id]: nextChallenge!.starterCode }));
        setRunResult(null);
        setEvaluation(null);
        setLastMode(null);
        setSelectedCaseIndex(0);
        setActiveConsoleTab('testcases');
      }
    } catch (err) {
      setNextError(err instanceof Error ? err.message : 'Could not generate another practice question.');
    } finally {
      setIsGeneratingNext(false);
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

  const currentChallengeIndex = allChallenges.findIndex((c) => c.id === challenge.id);
  const safeCurrentIndex = currentChallengeIndex >= 0 ? currentChallengeIndex : 0;

  return (
    <section className="sandbox-panel">
      {/* Header */}
      <div className="sandbox-header">
        <div className="sandbox-title-wrap">
          <div className="sandbox-top-meta">
            <span className="sandbox-badge">
              <CodeRounded fontSize="inherit" /> {challenge.language.toUpperCase()} PRACTICAL TEST
            </span>
            {allChallenges.length > 1 && (
              <div className="sandbox-question-stepper">
                <button
                  type="button"
                  className="stepper-arrow-btn"
                  disabled={safeCurrentIndex <= 0}
                  onClick={() => handleSelectChallenge(allChallenges[safeCurrentIndex - 1])}
                  title="Previous practice question"
                  aria-label="Previous practice question"
                >
                  <ChevronLeftRounded fontSize="small" />
                </button>

                <div className="stepper-select-container">
                  <select
                    className="stepper-select"
                    value={challenge.id}
                    onChange={(e) => {
                      const selected = allChallenges.find((c) => c.id === e.target.value);
                      if (selected) handleSelectChallenge(selected);
                    }}
                    title="Switch practice question"
                  >
                    {allChallenges.map((c, idx) => (
                      <option key={c.id} value={c.id}>
                        Q{idx + 1} of {allChallenges.length}: {c.title.length > 28 ? `${c.title.slice(0, 28)}…` : c.title}
                      </option>
                    ))}
                  </select>
                  <ExpandMoreRounded className="stepper-select-arrow" />
                </div>

                <button
                  type="button"
                  className="stepper-arrow-btn"
                  disabled={safeCurrentIndex >= allChallenges.length - 1}
                  onClick={() => handleSelectChallenge(allChallenges[safeCurrentIndex + 1])}
                  title="Next practice question"
                  aria-label="Next practice question"
                >
                  <ChevronRightRounded fontSize="small" />
                </button>
              </div>
            )}
          </div>
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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{formatPromptMarkdown(challenge.prompt)}</ReactMarkdown>
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
              onChange={handleCodeChange}
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

                {/* Try Another Practice Question Callout (shown when submitted & all passed) */}
                {lastMode === 'submit' && runResult?.status === 'passed' && (
                  <div className="next-practice-banner in-testcases">
                    <div className="next-practice-info">
                      <span className="next-practice-kicker">CHALLENGE COMPLETE</span>
                      <h4 className="next-practice-title">Ready for another challenge?</h4>
                      <p className="next-practice-desc">
                        All public &amp; private edge cases verified! Would you like to test your understanding with another practice question on this topic?
                      </p>
                      {nextError && <div className="next-practice-error">{nextError}</div>}
                    </div>
                    <button
                      type="button"
                      className="btn-next-practice"
                      onClick={handleNextPracticeQuestion}
                      disabled={isGeneratingNext}
                    >
                      {isGeneratingNext ? (
                        <>
                          <CircularProgress size={16} color="inherit" />
                          <span>Generating question...</span>
                        </>
                      ) : (
                        <>
                          <span>Try Another Practice Question</span>
                          <ArrowForwardRounded fontSize="small" />
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Case Chips Strip */}
                <div className="testcase-chips-strip">
                  {testResults.map((tc, idx) => (
                    <button
                      key={tc.testCaseId || idx}
                      type="button"
                      className={`testcase-chip ${selectedCaseIndex === idx ? 'active' : ''} ${
                        tc.passed ? 'passed' : 'failed'
                      } ${tc.isHidden ? 'private-chip' : ''}`}
                      onClick={() => setSelectedCaseIndex(idx)}
                    >
                      <span className="testcase-chip-icon">
                        {tc.passed ? '✓' : '✗'}
                      </span>
                      <span>
                        {tc.isHidden ? `Private Case ${idx + 1}` : `Case ${idx + 1}`}
                      </span>
                      {tc.isHidden && (
                        <LockOutlined style={{ fontSize: 13, marginLeft: 4, opacity: 0.7 }} />
                      )}
                    </button>
                  ))}
                </div>

                {/* Selected Testcase Details Card */}
                {activeTestCase && (
                  <div className="testcase-detail-card">
                    <div className="testcase-detail-header">
                      <div className="testcase-detail-title">
                        <strong>
                          {activeTestCase.isHidden
                            ? `Private Test Case ${selectedCaseIndex + 1}`
                            : `Public Case ${selectedCaseIndex + 1}: ${activeTestCase.name}`}
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

                    {activeTestCase.isHidden ? (
                      <div className="private-testcase-card">
                        <div className="private-card-header">
                          <div className="private-lock-circle">
                            <LockOutlined />
                          </div>
                          <div>
                            <h4>Private Edge Case ({selectedCaseIndex + 1})</h4>
                            <p>
                              The input parameters, expected outputs, and assertion checks for this test case are concealed to verify your solution's handling of unseen boundary conditions.
                            </p>
                          </div>
                        </div>

                        <div
                          className={`private-result-banner ${
                            activeTestCase.passed ? 'passed' : 'failed'
                          }`}
                        >
                          <span className="private-result-icon">
                            {activeTestCase.passed ? '✓' : '✗'}
                          </span>
                          <div>
                            <strong>
                              {activeTestCase.passed
                                ? 'Test Case Passed'
                                : 'Test Case Failed (Wrong Answer)'}
                            </strong>
                            <p>
                              {activeTestCase.passed
                                ? 'Your solution verified this hidden scenario successfully.'
                                : 'Your code produced an incorrect result or failed an assertion for this hidden test case. Review edge scenarios such as zero, negative numbers, empty sequences, or boundary values.'}
                            </p>
                          </div>
                        </div>

                        {activeTestCase.error && (
                          <div className="testcase-io-block actual-fail" style={{ marginTop: 12 }}>
                            <span className="testcase-io-label">Execution Diagnostics:</span>
                            <pre className="testcase-io-pre">{activeTestCase.error}</pre>
                          </div>
                        )}
                      </div>
                    ) : (
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

                        {/* User's Output */}
                        {activeTestCase.actualOutput !== undefined ? (
                          <div
                            className={`testcase-io-block ${
                              activeTestCase.passed ? 'actual-success' : 'actual-fail'
                            }`}
                          >
                            <span className="testcase-io-label">Your Output:</span>
                            <pre className="testcase-io-pre">{activeTestCase.actualOutput}</pre>
                          </div>
                        ) : activeTestCase.passed ? (
                          <div className="testcase-io-block actual-success">
                            <span className="testcase-io-label">Your Output:</span>
                            <pre className="testcase-io-pre">
                              {activeTestCase.expectedOutput || 'Passed assertions'}
                            </pre>
                          </div>
                        ) : null}

                        {/* Error details if a runtime exception occurred */}
                        {!activeTestCase.passed && activeTestCase.error && (
                          <div className="testcase-io-block actual-fail">
                            <span className="testcase-io-label">
                              {activeTestCase.actualOutput !== undefined ? 'Error Details:' : 'Your Output / Error:'}
                            </span>
                            <pre className="testcase-io-pre">{activeTestCase.error}</pre>
                          </div>
                        )}

                        {/* Fallback for failed case with no output captured */}
                        {!activeTestCase.passed && activeTestCase.actualOutput === undefined && !activeTestCase.error && (
                          <div className="testcase-io-block actual-fail">
                            <span className="testcase-io-label">Your Output:</span>
                            <pre className="testcase-io-pre">No output returned</pre>
                          </div>
                        )}
                      </div>
                    )}
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

                {evaluation.passed && (
                  <div className="next-practice-banner">
                    <div className="next-practice-info">
                      <span className="next-practice-kicker">CHALLENGE COMPLETE</span>
                      <h4 className="next-practice-title">Ready for another challenge?</h4>
                      <p className="next-practice-desc">
                        You solved this problem and passed all verification cases! Would you like to practice another question on this topic?
                      </p>
                      {nextError && <div className="next-practice-error">{nextError}</div>}
                    </div>
                    <button
                      type="button"
                      className="btn-next-practice"
                      onClick={handleNextPracticeQuestion}
                      disabled={isGeneratingNext}
                    >
                      {isGeneratingNext ? (
                        <>
                          <CircularProgress size={16} color="inherit" />
                          <span>Generating question...</span>
                        </>
                      ) : (
                        <>
                          <span>Try Another Practice Question</span>
                          <ArrowForwardRounded fontSize="small" />
                        </>
                      )}
                    </button>
                  </div>
                )}

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
