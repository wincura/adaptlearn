import crypto from 'node:crypto';
import { z } from 'zod';
import type { CodeEvaluationResponse, CodingChallenge, LearningGoal, SupportedCodeLanguage } from '../../shared/contracts.ts';
import { aiChat, parseJsonObject } from '../ai/provider.ts';
import type { SandboxExecutor } from './contracts.ts';

const challengeJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'prompt', 'starterCode', 'testHarness', 'publicTestHarness', 'privateTestHarness', 'testCases', 'hints'],
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
        required: ['description', 'input', 'expectedOutput', 'assertion', 'isHidden'],
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
  options?: { previousTitles?: string[] },
): Promise<CodingChallenge> {
  const systemPrompt = `
You are an expert Computer Science curriculum designer and coding tutor.
Create an interactive coding challenge suitable for a student at the "${assessedLevel}" level.
The challenge must directly reinforce the topic: "${topic}" within the lesson: "${lessonTitle}".
Target Programming Language: ${language}

Requirements:
1. title: Concise, engaging problem title.
2. prompt: Detailed, beautifully formatted problem statement using structured Markdown. Must include:
   - An introductory paragraph explaining the real-world concept, intuition, and motivation.
   - \`### Task\`: Clear explanation of the function to implement, the exact function signature formatted as code (e.g. \`def my_func(...) -> ...:\`), and bullet points for all specific requirements.
   - \`### Input & Output Format\`: Clear bulleted list with parameter names, types, and descriptions, followed by the return type and structure.
   - \`### Examples\`: 1-2 concrete worked examples with **Input:**, **Output:**, and **Explanation:** (use formatted code blocks).
   - \`### Constraints\`: Bullet points detailing value domains, edge cases (e.g. empty lists, negative numbers), and allowed/forbidden approaches.
   Never produce an unformatted wall of text; use clean headings, bullet points, and code formatting throughout. Do not use emojis.
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

  const previousContext = options?.previousTitles && options.previousTitles.length > 0
    ? `\nPreviously generated questions for this topic: ${options.previousTitles.map((t) => `"${t}"`).join(', ')}.\nCRITICAL: Provide a FRESH, DIFFERENT practice problem testing a distinct angle or application of "${topic}". Do not repeat or closely mirror previous questions.`
    : '';

  const userPrompt = `
Learner Goal: ${goal.title} (${goal.motivation})
Lesson: ${lessonTitle}
Topic Focus: ${topic}
Level: ${assessedLevel}
Language: ${language}${previousContext}
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

export function splitEqualityAssertion(assertCode: string): {
  setup: string;
  leftExpr?: string;
  rightExpr?: string;
} {
  const lines = assertCode.trim().split(/\r?\n/);
  const lastLine = lines[lines.length - 1].trim();
  const setup = lines.slice(0, lines.length - 1).join('\n');

  let expr = lastLine;
  if (expr.startsWith('assert ')) {
    expr = expr.slice(7).trim();
  } else if (expr.startsWith('assert(') && expr.endsWith(')')) {
    expr = expr.slice(7, -1).trim();
  }

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;
  let equalityIdx = -1;
  let opLength = 0;
  let commaIdx = -1;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (depth === 0) {
      if (equalityIdx === -1) {
        if (expr.slice(i, i + 3) === '===') {
          equalityIdx = i;
          opLength = 3;
          i += 2;
          continue;
        } else if (expr.slice(i, i + 2) === '==') {
          equalityIdx = i;
          opLength = 2;
          i += 1;
          continue;
        } else if (expr.slice(i, i + 4) === ' is ') {
          equalityIdx = i;
          opLength = 4;
          i += 3;
          continue;
        }
      } else {
        if (ch === ',') {
          commaIdx = i;
          break;
        }
      }
    }
  }

  if (equalityIdx !== -1) {
    const leftExpr = expr.slice(0, equalityIdx).trim();
    const rightExpr = (commaIdx !== -1 ? expr.slice(equalityIdx + opLength, commaIdx) : expr.slice(equalityIdx + opLength)).trim();
    return { setup, leftExpr, rightExpr };
  }

  let singleCommaIdx = -1;
  depth = 0;
  inString = false;
  quoteChar = '';
  escaped = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quoteChar) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (depth === 0 && ch === ',') {
      singleCommaIdx = i;
      break;
    }
  }

  const cleanExpr = (singleCommaIdx !== -1 ? expr.slice(0, singleCommaIdx) : expr).trim();
  if (cleanExpr) {
    return { setup, leftExpr: cleanExpr };
  }

  return { setup };
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
      const rawCode = (tc.assertion ?? '').trim();
      const parsed = splitEqualityAssertion(rawCode);
      const setupBlock = parsed.setup ? parsed.setup.split(/\r?\n/).map((l) => `    ${l}`).join('\n') + '\n' : '';

      if (parsed.leftExpr && parsed.rightExpr) {
        return `
# Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try:
${setupBlock}    _actual = ${parsed.leftExpr}
    _expected = ${parsed.rightExpr}
    if _actual == _expected:
        print(f"__ADAPT_CASE__:${idx}:PASS:{_adapt_format(_actual)}")
    else:
        print(f"__ADAPT_CASE__:${idx}:FAIL:WRONG_ANSWER:{_adapt_format(_actual)}")
except Exception as _e:
    print(f"__ADAPT_CASE__:${idx}:FAIL:ERROR:{type(_e).__name__}: {_e}")
`;
      }

      if (parsed.leftExpr) {
        return `
# Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try:
${setupBlock}    _actual = ${parsed.leftExpr}
    if bool(_actual):
        print(f"__ADAPT_CASE__:${idx}:PASS:{_adapt_format(_actual)}")
    else:
        print(f"__ADAPT_CASE__:${idx}:FAIL:WRONG_ANSWER:{_adapt_format(_actual)}")
except Exception as _e:
    print(f"__ADAPT_CASE__:${idx}:FAIL:ERROR:{type(_e).__name__}: {_e}")
`;
      }

      let assertCode = rawCode;
      if (!assertCode.startsWith('assert') && !assertCode.includes('raise') && !assertCode.includes('if ')) {
        assertCode = `assert ${assertCode}`;
      }
      const indentedAssert = assertCode.split(/\r?\n/).map((l) => `    ${l}`).join('\n');
      return `
# Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try:
${indentedAssert}
    print(f"__ADAPT_CASE__:${idx}:PASS:")
except AssertionError as _e:
    _msg = str(_e) or "Assertion failed"
    print(f"__ADAPT_CASE__:${idx}:FAIL:ASSERTION:{_msg}")
except Exception as _e:
    print(f"__ADAPT_CASE__:${idx}:FAIL:ERROR:{type(_e).__name__}: {_e}")
`;
    }).join('\n');

    return `
# --- AdaptLearn Testcase Runner ---
import json as _adapt_json
def _adapt_format(v):
    try:
        if isinstance(v, (dict, list, int, float, bool)) or v is None:
            return _adapt_json.dumps(v)
        if isinstance(v, str):
            return repr(v)
    except Exception:
        pass
    return repr(v)

${caseBlocks}
`;
  }

  if (language === 'javascript' || language === 'typescript') {
    const caseBlocks = cases.map((tc, idx) => {
      const rawCode = (tc.assertion ?? '').trim();
      const parsed = splitEqualityAssertion(rawCode);
      const setupBlock = parsed.setup ? `  ${parsed.setup}\n` : '';

      if (parsed.leftExpr && parsed.rightExpr) {
        return `
// Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try {
${setupBlock}  const _actual = ${parsed.leftExpr};
  const _expected = ${parsed.rightExpr};
  const _eq = (_actual === _expected) || (JSON.stringify(_actual) === JSON.stringify(_expected));
  if (_eq) {
    console.log("__ADAPT_CASE__:${idx}:PASS:" + _adaptFormat(_actual));
  } else {
    console.log("__ADAPT_CASE__:${idx}:FAIL:WRONG_ANSWER:" + _adaptFormat(_actual));
  }
} catch (_e) {
  const _msg = _e && _e.message ? _e.message : String(_e);
  console.log("__ADAPT_CASE__:${idx}:FAIL:ERROR:" + _msg);
}
`;
      }

      if (parsed.leftExpr) {
        return `
// Case ${idx}: ${tc.description.replace(/\r?\n/g, ' ')}
try {
${setupBlock}  const _actual = ${parsed.leftExpr};
  if (Boolean(_actual)) {
    console.log("__ADAPT_CASE__:${idx}:PASS:" + _adaptFormat(_actual));
  } else {
    console.log("__ADAPT_CASE__:${idx}:FAIL:WRONG_ANSWER:" + _adaptFormat(_actual));
  }
} catch (_e) {
  const _msg = _e && _e.message ? _e.message : String(_e);
  console.log("__ADAPT_CASE__:${idx}:FAIL:ERROR:" + _msg);
}
`;
      }

      let assertCode = rawCode;
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
  console.log("__ADAPT_CASE__:${idx}:FAIL:ERROR:" + _msg);
}
`;
    }).join('\n');

    return `
// --- AdaptLearn Testcase Runner ---
function _adaptFormat(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

${caseBlocks}
`;
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
  const statusMap = new Map<number, { passed: boolean; actualOutput?: string; error?: string }>();

  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^__ADAPT_CASE__:(\d+):(PASS|FAIL)(?::(.*))?$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const passed = match[2] === 'PASS';
      const payload = match[3] !== undefined ? match[3].trim() : '';

      let actualOutput: string | undefined;
      let error: string | undefined;

      if (passed) {
        actualOutput = payload || undefined;
      } else {
        if (payload.startsWith('WRONG_ANSWER:')) {
          actualOutput = payload.slice('WRONG_ANSWER:'.length).trim();
          error = undefined;
        } else if (payload.startsWith('ERROR:')) {
          error = payload.slice('ERROR:'.length).trim();
        } else if (payload.startsWith('ASSERTION:')) {
          error = payload.slice('ASSERTION:'.length).trim();
        } else {
          error = payload || 'Assertion failed';
        }
      }

      statusMap.set(idx, { passed, actualOutput, error });
    } else {
      cleanLines.push(line);
    }
  }

  const cleanStdout = cleanLines.join('\n').trim();

  if (statusMap.size > 0) {
    const testResults: import('../../shared/contracts.ts').TestCaseResult[] = cases.map((tc, idx) => {
      const res = statusMap.get(idx);
      const isHidden = Boolean(tc.isHidden);
      if (res) {
        return {
          testCaseId: tc.id,
          name: isHidden ? `Private Case ${idx + 1}` : (tc.description || `Case ${idx + 1}`),
          passed: res.passed,
          input: isHidden ? undefined : tc.input,
          expectedOutput: isHidden ? undefined : tc.expectedOutput,
          actualOutput: isHidden ? undefined : (res.actualOutput !== undefined ? res.actualOutput : (res.passed ? tc.expectedOutput : undefined)),
          error: isHidden ? (res.error?.startsWith('Assertion') ? undefined : (res.error ? 'Runtime exception on private test case' : undefined)) : res.error,
          isHidden,
        };
      }
      return {
        testCaseId: tc.id,
        name: isHidden ? `Private Case ${idx + 1}` : (tc.description || `Case ${idx + 1}`),
        passed: false,
        input: isHidden ? undefined : tc.input,
        expectedOutput: isHidden ? undefined : tc.expectedOutput,
        error: isHidden ? 'Execution stopped before reaching this private case' : (stderr || 'Execution stopped before reaching this test case'),
        isHidden,
      };
    });

    const allCasesPassed = testResults.every((r) => r.passed) && rawStatus === 'passed';
    return { testResults, cleanStdout, passed: allCasesPassed };
  }

  // Fallback for raw harness executions
  const overallPassed = rawStatus === 'passed' && exitCode === 0;
  const testResults: import('../../shared/contracts.ts').TestCaseResult[] = cases.map((tc, idx) => {
    const isHidden = Boolean(tc.isHidden);
    return {
      testCaseId: tc.id,
      name: isHidden ? `Private Case ${idx + 1}` : (tc.description || `Case ${idx + 1}`),
      passed: overallPassed,
      input: isHidden ? undefined : tc.input,
      expectedOutput: isHidden ? undefined : tc.expectedOutput,
      actualOutput: isHidden ? undefined : (overallPassed ? tc.expectedOutput : undefined),
      error: isHidden ? (overallPassed ? undefined : 'Execution failed on private case') : (overallPassed ? undefined : (stderr || 'Execution failed')),
      isHidden,
    };
  });

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
