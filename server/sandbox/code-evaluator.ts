import crypto from 'node:crypto';
import { z } from 'zod';
import type { CodeEvaluationResponse, CodingChallenge, LearningGoal, SupportedCodeLanguage } from '../../shared/contracts.ts';
import { aiChat, parseJsonObject } from '../ai/provider.ts';
import type { SandboxExecutor } from './contracts.ts';

const challengeJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'prompt', 'starterCode', 'testHarness', 'testCases', 'hints'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 140 },
    prompt: { type: 'string', minLength: 10, maxLength: 4000 },
    starterCode: { type: 'string', minLength: 1, maxLength: 2000 },
    testHarness: { type: 'string', minLength: 1, maxLength: 4000 },
    publicTestHarness: { type: 'string', maxLength: 3000 },
    privateTestHarness: { type: 'string', maxLength: 3000 },
    testCases: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'input', 'expectedOutput', 'isHidden'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 200 },
          input: { type: 'string', maxLength: 300 },
          expectedOutput: { type: 'string', maxLength: 300 },
          assertion: { type: 'string', maxLength: 500 },
          isHidden: { type: 'boolean' },
        },
      },
    },
    hints: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 400 },
    },
  },
};

const codingChallengeSchema = z.object({
  title: z.string().min(1).max(140),
  prompt: z.string().min(10).max(4000),
  starterCode: z.string().min(1).max(2000),
  testHarness: z.string().min(1).max(4000),
  publicTestHarness: z.string().max(3000).optional(),
  privateTestHarness: z.string().max(3000).optional(),
  testCases: z.array(z.object({
    description: z.string().min(1).max(200),
    input: z.string().max(300).optional(),
    expectedOutput: z.string().max(300).optional(),
    assertion: z.string().max(500).optional(),
    isHidden: z.boolean().optional(),
  })).min(1).max(8).optional(),
  hints: z.array(z.string().min(1).max(400)).max(3).optional(),
});

export async function generateCodingChallenge(
  goal: LearningGoal,
  lessonTitle: string,
  topic: string,
  language: SupportedCodeLanguage,
  assessedLevel: string = 'Beginner',
): Promise<CodingChallenge> {
  const systemPrompt = `
You are an expert Computer Science curriculum designer and coding tutor.
Create an interactive coding challenge suitable for a student at the "${assessedLevel}" level.
The challenge must directly reinforce the topic: "${topic}" within the lesson: "${lessonTitle}".
Target Programming Language: ${language}

Requirements:
1. title: Concise, engaging problem title.
2. prompt: Detailed problem statement with input/output format, constraints, and 1-2 examples.
3. starterCode: Clean initial template with function signature, type hints/comments, and a TODO placeholder.
4. testCases: 4 to 6 test cases total:
   - 2 to 3 PUBLIC test cases (isHidden: false): Standard visible cases with description, input, expectedOutput, and assertion.
   - 2 to 3 PRIVATE test cases (isHidden: true): Edge cases, boundary values, zero, negative numbers, or empty inputs.
   - assertion: Individual assertion snippet for each testcase (e.g. for Python: assert my_func(...) == ..., for JS: if (my_func(...) !== ...) throw new Error(...)).
5. testHarness: Complete executable assertion script covering all test cases.
6. publicTestHarness: Executable assertions testing ONLY the public test cases.
7. privateTestHarness: Executable assertions testing the private edge cases.
8. hints: 1 to 2 conceptual hints.

Return ONLY valid JSON matching the schema.
`.trim();

  const userPrompt = `
Learner Goal: ${goal.title} (${goal.motivation})
Lesson: ${lessonTitle}
Topic Focus: ${topic}
Level: ${assessedLevel}
Language: ${language}
`.trim();

  const raw = await aiChat({
    jsonSchema: { name: 'coding_challenge', schema: challengeJsonSchema },
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const parsed = codingChallengeSchema.parse(parseJsonObject(raw));

  const rawCases = parsed.testCases ?? [];
  const normalizedCases = rawCases.map((tc, idx) => ({
    id: crypto.randomUUID(),
    description: tc.description,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    assertion: tc.assertion,
    // First 2 default to public if not marked; subsequent default to private
    isHidden: tc.isHidden !== undefined ? tc.isHidden : idx >= 2,
  }));

  return {
    id: crypto.randomUUID(),
    language,
    title: parsed.title,
    prompt: parsed.prompt,
    starterCode: parsed.starterCode,
    testHarness: parsed.testHarness,
    publicTestHarness: parsed.publicTestHarness,
    privateTestHarness: parsed.privateTestHarness,
    testCases: normalizedCases,
    hints: parsed.hints,
  };
}

export function buildTestRunnerHarness(
  language: SupportedCodeLanguage,
  cases: import('../../shared/contracts.ts').CodingTestCase[],
  fallbackHarness?: string,
): string {
  const hasAssertions = cases.some((tc) => Boolean(tc.assertion));

  if (!hasAssertions || (language !== 'python' && language !== 'javascript' && language !== 'typescript')) {
    return fallbackHarness ?? '';
  }

  if (language === 'python') {
    const caseBlocks = cases.map((tc, idx) => {
      let assertCode = (tc.assertion ?? '').trim();
      if (!assertCode.startsWith('assert') && !assertCode.includes('raise') && !assertCode.includes('if ')) {
        assertCode = `assert ${assertCode}`;
      }
      return `
# Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try:
    ${assertCode}
    print(f"__ADAPT_CASE__:${idx}:PASS:")
except AssertionError as _e:
    _msg = str(_e) or "Assertion failed"
    print(f"__ADAPT_CASE__:${idx}:FAIL:{_msg}")
except Exception as _e:
    print(f"__ADAPT_CASE__:${idx}:FAIL:{type(_e).__name__}: {_e}")
`;
    }).join('\n');

    return `\n# --- AdaptLearn Testcase Runner ---\n${caseBlocks}\n`;
  }

  if (language === 'javascript' || language === 'typescript') {
    const caseBlocks = cases.map((tc, idx) => {
      let assertCode = (tc.assertion ?? '').trim();
      if (!assertCode.includes('throw') && !assertCode.includes('if ') && !assertCode.startsWith('assert')) {
        const expected = tc.expectedOutput ? JSON.stringify(tc.expectedOutput) : 'expected';
        assertCode = `if (!(${assertCode})) throw new Error("Expected " + ${expected});`;
      }
      return `
// Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try {
  ${assertCode}
  console.log("__ADAPT_CASE__:${idx}:PASS:");
} catch (_e) {
  const _msg = _e && _e.message ? _e.message : String(_e);
  console.log("__ADAPT_CASE__:${idx}:FAIL:" + _msg);
}
`;
    }).join('\n');

    return `\n// --- AdaptLearn Testcase Runner ---\n${caseBlocks}\n`;
  }

  return fallbackHarness ?? '';
}

export function parseTestCaseResults(
  stdout: string,
  stderr: string,
  cases: import('../../shared/contracts.ts').CodingTestCase[],
  rawStatus: import('../../shared/contracts.ts').ExecutionStatus,
  exitCode: number,
): { testResults: import('../../shared/contracts.ts').TestCaseResult[]; cleanStdout: string; passed: boolean } {
  const cleanLines: string[] = [];
  const statusMap = new Map<number, { passed: boolean; error?: string }>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^__ADAPT_CASE__:(\d+):(PASS|FAIL)(?::(.*))?$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const passed = match[2] === 'PASS';
      const error = match[3] ? match[3].trim() : undefined;
      statusMap.set(idx, { passed, error });
    } else {
      cleanLines.push(line);
    }
  }

  const cleanStdout = cleanLines.join('\n').trim();

  if (statusMap.size > 0) {
    const testResults: import('../../shared/contracts.ts').TestCaseResult[] = cases.map((tc, idx) => {
      const res = statusMap.get(idx);
      if (res) {
        return {
          testCaseId: tc.id,
          name: tc.description || `Case ${idx + 1}`,
          passed: res.passed,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          actualOutput: res.passed ? tc.expectedOutput : undefined,
          error: res.error,
          isHidden: tc.isHidden,
        };
      }
      return {
        testCaseId: tc.id,
        name: tc.description || `Case ${idx + 1}`,
        passed: false,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        error: stderr || 'Execution stopped before reaching this test case',
        isHidden: tc.isHidden,
      };
    });

    const allCasesPassed = testResults.every((r) => r.passed) && rawStatus === 'passed';
    return { testResults, cleanStdout, passed: allCasesPassed };
  }

  // Fallback for raw harness executions
  const overallPassed = rawStatus === 'passed' && exitCode === 0;
  const testResults: import('../../shared/contracts.ts').TestCaseResult[] = cases.map((tc, idx) => ({
    testCaseId: tc.id,
    name: tc.description || `Case ${idx + 1}`,
    passed: overallPassed,
    input: tc.input,
    expectedOutput: tc.expectedOutput,
    actualOutput: overallPassed ? tc.expectedOutput : undefined,
    error: overallPassed ? undefined : (stderr || 'Execution failed'),
    isHidden: tc.isHidden,
  }));

  return { testResults, cleanStdout, passed: overallPassed };
}

export async function runChallengeTestCases(
  challenge: CodingChallenge,
  studentCode: string,
  mode: 'run' | 'submit',
  executor: SandboxExecutor,
): Promise<import('../../shared/contracts.ts').ExecutionResult> {
  const allCases = challenge.testCases ?? [];
  const targetCases = mode === 'run'
    ? (allCases.filter((c) => !c.isHidden).length > 0 ? allCases.filter((c) => !c.isHidden) : allCases.slice(0, 2))
    : allCases;

  const fallbackHarness = mode === 'run'
    ? (challenge.publicTestHarness || challenge.testHarness)
    : challenge.testHarness;

  const harness = buildTestRunnerHarness(challenge.language, targetCases, fallbackHarness);

  const rawExecution = await executor.execute({
    language: challenge.language,
    code: studentCode,
    harness,
    timeoutMs: 10000,
  });

  const { testResults, cleanStdout, passed } = parseTestCaseResults(
    rawExecution.stdout,
    rawExecution.stderr,
    targetCases,
    rawExecution.status,
    rawExecution.exitCode,
  );

  const passedCount = testResults.filter((r) => r.passed).length;
  const totalCount = testResults.length;

  return {
    status: passed ? 'passed' : (rawExecution.status !== 'passed' ? rawExecution.status : 'failed'),
    stdout: cleanStdout,
    stderr: rawExecution.stderr,
    exitCode: passed ? 0 : (rawExecution.exitCode !== 0 ? rawExecution.exitCode : 1),
    durationMs: rawExecution.durationMs,
    testResults,
    passedCount,
    totalCount,
  };
}

export async function evaluateCodeSubmission(
  challenge: CodingChallenge,
  studentCode: string,
  executor: SandboxExecutor,
): Promise<CodeEvaluationResponse> {
  // 1. Execute all test cases (both public and private)
  const execution = await runChallengeTestCases(challenge, studentCode, 'submit', executor);
  const passed = execution.status === 'passed' && execution.exitCode === 0;

  // Breakdown for Socratic pedagogical feedback
  const publicCases = execution.testResults?.filter((r) => !r.isHidden) ?? [];
  const privateCases = execution.testResults?.filter((r) => r.isHidden) ?? [];
  const publicPassed = publicCases.filter((r) => r.passed).length;
  const privatePassed = privateCases.filter((r) => r.passed).length;
  const failedCases = execution.testResults?.filter((r) => !r.passed) ?? [];

  // 2. Generate Socratic pedagogical feedback using AI tutor
  const tutorSystemPrompt = `
You are a warm, encouraging, Socratic AI Computer Science Tutor for an interactive learning platform.
Your goals:
1. Review the coding challenge prompt, the student's submitted code, and the execution logs (stdout/stderr/exit status).
2. If execution passed:
   - Congratulate the student on their success passing all public and hidden private verification tests.
   - Highlight time and space complexity insights (e.g. Big-O analysis).
   - Point out good programming habits or alternative idiomatic approaches.
3. If execution failed (syntax error, compile error, test assertion failure, or runtime crash):
   - CRITICAL: DO NOT give away the corrected code or paste the solution.
   - If public cases passed but private edge cases failed, note that their core logic is working for standard inputs, but highlight the conceptual nature of edge cases (e.g., negative numbers, empty arrays, boundaries).
   - Explain the root cause conceptually in simple, accessible terms.
   - Provide a targeted, guiding Socratic question or hint that leads the student to find and fix the bug themselves.

Format your response in friendly, clear Markdown.
`.trim();

  const tutorUserPrompt = `
Coding Challenge: ${challenge.title}
Language: ${challenge.language}
Problem Statement:
${challenge.prompt}

Student's Submitted Code:
\`\`\`${challenge.language}
${studentCode}
\`\`\`

Execution Results:
Status: ${execution.status}
Exit Code: ${execution.exitCode}
Duration: ${execution.durationMs}ms
Total Test Cases: ${execution.totalCount ?? 0} (${execution.passedCount ?? 0} passed)
- Public Test Cases: ${publicPassed}/${publicCases.length} passed
- Private Test Cases: ${privatePassed}/${privateCases.length} passed
${failedCases.length > 0 ? `Failed Test Cases:\n${failedCases.map((f) => `- [${f.isHidden ? 'PRIVATE EDGE CASE' : 'PUBLIC CASE'}] ${f.name}: input="${f.input ?? ''}", expected="${f.expectedOutput ?? ''}", error="${f.error ?? 'Wrong Answer'}"`).join('\n')}` : 'All public and private test cases passed!'}

Stdout:
${execution.stdout || '(no standard output)'}

Stderr / Diagnostics:
${execution.stderr || '(no errors recorded)'}
`.trim();

  const feedback = await aiChat({
    temperature: 0.3,
    messages: [
      { role: 'system', content: tutorSystemPrompt },
      { role: 'user', content: tutorUserPrompt },
    ],
  });

  return {
    passed,
    status: execution.status,
    feedback,
    execution,
    xpAwarded: passed ? 25 : 0,
  };
}
