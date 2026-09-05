import { createApp } from '../server/app.ts';
import { runChallengeTestCases, evaluateCodeSubmission } from '../server/sandbox/code-evaluator.ts';
import { LocalSandboxExecutor } from '../server/sandbox/local-executor.ts';
import type { CodingChallenge } from '../shared/contracts.ts';

async function runTests() {
  console.log('=== Testing Public vs Private Test Cases & LeetCode-style Execution ===\n');

  const executor = new LocalSandboxExecutor();

  // Test Challenge: square_even
  // Returns n squared if n is even, else returns 0.
  const challenge: CodingChallenge = {
    id: 'test-challenge-even',
    language: 'python',
    title: 'Square Even Numbers',
    prompt: 'Return n squared if n is even, else return 0.',
    starterCode: 'def square_even(n):\n    pass',
    testHarness: `assert square_even(4) == 16\nassert square_even(3) == 0\nassert square_even(-2) == 4\nassert square_even(0) == 0`,
    publicTestHarness: `assert square_even(4) == 16\nassert square_even(3) == 0`,
    privateTestHarness: `assert square_even(-2) == 4\nassert square_even(0) == 0`,
    testCases: [
      {
        id: 'tc-pub-1',
        description: 'Positive even number 4 returns 16',
        input: '4',
        expectedOutput: '16',
        assertion: 'assert square_even(4) == 16',
        isHidden: false,
      },
      {
        id: 'tc-pub-2',
        description: 'Positive odd number 3 returns 0',
        input: '3',
        expectedOutput: '0',
        assertion: 'assert square_even(3) == 0',
        isHidden: false,
      },
      {
        id: 'tc-priv-1',
        description: 'Negative even number -2 returns 4',
        input: '-2',
        expectedOutput: '4',
        assertion: 'assert square_even(-2) == 4',
        isHidden: true,
      },
      {
        id: 'tc-priv-2',
        description: 'Zero is even and returns 0',
        input: '0',
        expectedOutput: '0',
        assertion: 'assert square_even(0) == 0',
        isHidden: true,
      },
    ],
  };

  // Test 1: Run Code with partial implementation (always squares without even check)
  console.log('1. Testing "Run Code" with bug on odd numbers (n * n):');
  const alwaysSquareCode = `def square_even(n):\n    return n * n`;
  const run1 = await runChallengeTestCases(challenge, alwaysSquareCode, 'run', executor);

  console.log(`- Status: ${run1.status}`);
  console.log(`- Total cases tested: ${run1.totalCount} (expected: 2 public cases only)`);
  console.log(`- Passed count: ${run1.passedCount} (expected: 1 passed, 1 failed)`);
  if (run1.totalCount !== 2) throw new Error(`Expected 2 public cases in 'run' mode, got ${run1.totalCount}`);
  if (run1.passedCount !== 1) throw new Error(`Expected 1 passed case, got ${run1.passedCount}`);
  if (!run1.testResults?.[0].passed || run1.testResults?.[1].passed) {
    throw new Error('Expected Case 1 to pass and Case 2 to fail');
  }
  console.log('[PASS] Test 1: "Run Code" correctly executed public cases only and identified failing case.\n');

  // Test 2: Run Code with solution that handles positive numbers only (positive even check)
  console.log('2. Testing solution that passes public cases but fails negative numbers:');
  const positiveOnlyCode = `def square_even(n):\n    return n * n if (n > 0 and n % 2 == 0) else 0`;
  const run2 = await runChallengeTestCases(challenge, positiveOnlyCode, 'run', executor);
  console.log(`- "Run Code" status: ${run2.status} (${run2.passedCount}/${run2.totalCount} passed)`);
  if (run2.status !== 'passed' || run2.passedCount !== 2) {
    throw new Error('Expected all public cases to pass');
  }
  console.log('[PASS] Public cases passed on "Run Code".');

  // Now Submit the same code: should FAIL because negative even number is in private test cases!
  console.log('3. Testing "Submit" with the same code (should fail private edge case):');
  const submit1 = await runChallengeTestCases(challenge, positiveOnlyCode, 'submit', executor);
  console.log(`- "Submit" status: ${submit1.status}`);
  console.log(`- Total cases tested: ${submit1.totalCount} (expected 4 total)`);
  console.log(`- Passed count: ${submit1.passedCount} (expected 3 passed, 1 failed)`);
  if (submit1.totalCount !== 4) throw new Error(`Expected 4 total cases in submit, got ${submit1.totalCount}`);
  if (submit1.passedCount !== 3) throw new Error(`Expected 3 passed cases, got ${submit1.passedCount}`);
  if (submit1.status !== 'failed') throw new Error('Expected submit to fail due to private edge case');

  const failedCase = submit1.testResults?.find((tc) => !tc.passed);
  console.log(`- Failing case: [${failedCase?.isHidden ? 'PRIVATE' : 'PUBLIC'}] ${failedCase?.name}`);
  if (!failedCase?.isHidden) throw new Error('Expected the failing case to be a private test case');
  console.log('[PASS] Test 3: "Submit" tested private cases and correctly caught edge-case failure.\n');

  // Test 4: Submit with fully correct solution
  console.log('4. Testing "Submit" with fully correct solution:');
  const correctCode = `def square_even(n):\n    return n * n if n % 2 == 0 else 0`;
  const submit2 = await runChallengeTestCases(challenge, correctCode, 'submit', executor);
  console.log(`- "Submit" status: ${submit2.status}`);
  console.log(`- Passed count: ${submit2.passedCount}/${submit2.totalCount}`);
  if (submit2.status !== 'passed' || submit2.passedCount !== 4) {
    throw new Error('Expected all 4 cases to pass');
  }
  console.log('[PASS] Test 4: Fully correct solution passed all public and private cases.\n');

  // Test 5: API Endpoints testing
  console.log('5. Testing API Endpoints (/api/sandbox/run-tests and /api/sandbox/evaluate):');
  const app = createApp({ sandboxExecutor: executor });
  const server = app.listen(8990);

  try {
    // 5a. Call /api/sandbox/run-tests
    const runRes = await fetch('http://127.0.0.1:8990/api/sandbox/run-tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge,
        studentCode: alwaysSquareCode,
      }),
    });
    const runData = (await runRes.json()) as { execution: import('../shared/contracts.ts').ExecutionResult };
    if (!runData.execution || runData.execution.totalCount !== 2) {
      throw new Error('/api/sandbox/run-tests failed to return public test cases');
    }
    console.log('[PASS] /api/sandbox/run-tests endpoint returned public testcase results.');

    // 5b. Call /api/sandbox/evaluate with correct solution
    const evalRes = await fetch('http://127.0.0.1:8990/api/sandbox/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge,
        studentCode: correctCode,
      }),
    });
    const evalData = (await evalRes.json()) as { evaluation: import('../shared/contracts.ts').CodeEvaluationResponse };
    if (!evalData.evaluation.passed || evalData.evaluation.execution.passedCount !== 4) {
      throw new Error('/api/sandbox/evaluate failed for correct solution');
    }
    console.log('[PASS] /api/sandbox/evaluate endpoint correctly evaluated full test suite.');
    console.log(`- Socratic AI Tutor snippet: ${evalData.evaluation.feedback.slice(0, 120)}...`);
  } finally {
    server.close();
  }

  console.log('\n=== ALL PUBLIC VS PRIVATE TESTCASE TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
