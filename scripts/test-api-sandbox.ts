import { createApp } from '../server/app.ts';

async function main() {
  console.log('=== Testing Express Sandbox API Endpoints ===');
  process.env.SANDBOX_EXECUTOR = process.env.SANDBOX_EXECUTOR ?? (process.env.E2B_API_KEY ? 'e2b' : 'local');
  const app = createApp();

  const server = app.listen(8989);
  console.log('Test server listening on port 8989');

  try {
    // 1. Health check
    const healthRes = await fetch('http://127.0.0.1:8989/health');
    const health = await healthRes.json() as Record<string, unknown>;
    console.log('[PASS] /health response:', health);
    if (health.status !== 'ok' || !health.sandbox) {
      throw new Error('Health check missing sandbox or not ok');
    }

    // 2. Direct run endpoint
    const runRes = await fetch('http://127.0.0.1:8989/api/sandbox/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        code: 'print("Hello from Sandbox API!")',
      }),
    });
    const runData = await runRes.json() as Record<string, unknown>;
    console.log('[PASS] /api/sandbox/run response:', runData);
    if (runData.status !== 'passed' || runData.stdout !== 'Hello from Sandbox API!') {
      throw new Error('Direct run endpoint failed');
    }

    // 3. Socratic evaluation endpoint
    console.log('\nTesting /api/sandbox/evaluate (with intentional logic bug):');
    const evalRes = await fetch('http://127.0.0.1:8989/api/sandbox/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge: {
          id: 'test-challenge-1',
          language: 'python',
          title: 'Square of Even Numbers',
          prompt: 'Write a function square_even(n) that returns n squared if n is even, else returns 0.',
          starterCode: 'def square_even(n):\n    pass',
          testHarness: 'assert square_even(4) == 16, f"Expected 16, got {square_even(4)}"\nassert square_even(3) == 0, f"Expected 0, got {square_even(3)}"\nprint("ALL_TESTS_PASSED")',
        },
        studentCode: 'def square_even(n):\n    return n * n  # forgot to check if even',
      }),
    });
    const evalData = await evalRes.json() as { evaluation: { passed: boolean; status: string; feedback: string } };
    console.log('[PASS] /api/sandbox/evaluate passed status:', evalData.evaluation.passed);
    console.log('[PASS] Execution status:', evalData.evaluation.status);
    console.log('[PASS] Socratic AI Tutor feedback snippet:\n' + evalData.evaluation.feedback.slice(0, 300) + '...');

    if (evalData.evaluation.passed !== false) {
      throw new Error('Expected bug to fail assertions');
    }

    console.log('\n=== All Express Sandbox API tests passed! ===');
  } finally {
    server.close();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('API test failed:', err);
  process.exit(1);
});
