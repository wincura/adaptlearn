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
    testHarness: { type: 'string', minLength: 1, maxLength: 3000 },
    testCases: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'input', 'expectedOutput'],
        properties: {
          description: { type: 'string', minLength: 1, maxLength: 200 },
          input: { type: 'string', maxLength: 300 },
          expectedOutput: { type: 'string', maxLength: 300 },
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
  testHarness: z.string().min(1).max(3000),
  testCases: z.array(z.object({
    description: z.string().min(1).max(200),
    input: z.string().max(300).optional(),
    expectedOutput: z.string().max(300).optional(),
    isHidden: z.boolean().optional(),
  })).min(1).max(5).optional(),
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
4. testHarness: Executable assertions testing the student's solution.
   - For Python: Use standard 'assert' statements that print "Test X Passed" and raise AssertionError on failure. Include edge cases (empty input, negatives, boundaries).
   - For JavaScript: Assert results with equality checks (e.g., if (result !== expected) throw new Error(...)).
   - For SQL: Supply CREATE TABLE and INSERT test fixture statements plus query check.
   - For C++/Java: Include main() function with assertions.
5. testCases: 2 to 4 visible test cases (description, input, expectedOutput) so the learner knows the specification.
6. hints: 1 to 2 conceptual hints.

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

  return {
    id: crypto.randomUUID(),
    language,
    title: parsed.title,
    prompt: parsed.prompt,
    starterCode: parsed.starterCode,
    testHarness: parsed.testHarness,
    testCases: parsed.testCases?.map((tc) => ({
      id: crypto.randomUUID(),
      ...tc,
    })),
    hints: parsed.hints,
  };
}

export async function evaluateCodeSubmission(
  challenge: CodingChallenge,
  studentCode: string,
  executor: SandboxExecutor,
): Promise<CodeEvaluationResponse> {
  // 1. Execute code in isolated sandbox
  const execution = await executor.execute({
    language: challenge.language,
    code: studentCode,
    harness: challenge.testHarness,
    timeoutMs: 10000,
  });

  const passed = execution.status === 'passed' && execution.exitCode === 0;

  // 2. Generate Socratic pedagogical feedback using AI tutor
  const tutorSystemPrompt = `
You are a warm, encouraging, Socratic AI Computer Science Tutor for an interactive learning platform.
Your goals:
1. Review the coding challenge prompt, the student's submitted code, and the execution logs (stdout/stderr/exit status).
2. If execution passed:
   - Congratulate the student on their success.
   - Highlight time and space complexity insights (e.g. Big-O analysis).
   - Point out good programming habits or alternative idiomatic approaches.
3. If execution failed (syntax error, compile error, test assertion failure, or runtime crash):
   - CRITICAL: DO NOT give away the corrected code or paste the solution.
   - Explain the root cause conceptually in simple, accessible terms.
   - Point to the specific edge case or logic condition that triggered the failure.
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
