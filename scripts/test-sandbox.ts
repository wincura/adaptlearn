import { LocalSandboxExecutor } from '../server/sandbox/local-executor.ts';
import { detectCodeTopic } from '../server/sandbox/topic-detector.ts';

async function main() {
  console.log('=== 1. Testing Topic Detection ===');
  const testTopics = [
    { topic: 'Conversational Spanish for Beginners', goal: 'Learn Spanish', expected: false },
    { topic: 'French Verb Conjugations', goal: 'Fluent French', expected: false },
    { topic: 'Executive Project Management', goal: 'Manage teams', expected: false },
    { topic: 'Linear Equations and Graphing', goal: 'Basic Algebra', expected: false },
    { topic: 'Python Lists and Dictionaries', goal: 'Learn Python programming', expected: true, expectedLang: 'python' },
    { topic: 'SQL Aggregations and GROUP BY', goal: 'Database Queries', expected: true, expectedLang: 'sql' },
    { topic: 'Async JavaScript Promises', goal: 'Web development', expected: true, expectedLang: 'javascript' },
    { topic: 'Binary Search Trees in C++', goal: 'Data structures', expected: true, expectedLang: 'cpp' },
  ];

  let detectionPassed = 0;
  for (const item of testTopics) {
    const result = detectCodeTopic(item.topic, item.goal, '');
    const ok = result.isCodeTopic === item.expected && (!item.expectedLang || result.language === item.expectedLang);
    if (ok) {
      detectionPassed += 1;
      console.log(`[PASS] "${item.topic}": isCode=${result.isCodeTopic}${result.language ? ` (${result.language})` : ''}`);
    } else {
      console.error(`[FAIL] "${item.topic}": got isCode=${result.isCodeTopic}, expected=${item.expected}`);
    }
  }

  console.log(`\nTopic Detection: ${detectionPassed}/${testTopics.length} tests passed.\n`);

  console.log('=== 2. Testing Local Sandbox Execution ===');
  const executor = new LocalSandboxExecutor();

  // Python test
  console.log('Testing Python Execution:');
  const pyResult = await executor.execute({
    language: 'python',
    code: `
def add(a, b):
    return a + b

print(f"Result is {add(10, 32)}")
`,
    harness: `
assert add(2, 2) == 4, "add failed"
print("All Python assertions passed!")
`,
  });
  console.log(`- Status: ${pyResult.status}`);
  console.log(`- ExitCode: ${pyResult.exitCode}`);
  console.log(`- Duration: ${pyResult.durationMs}ms`);
  console.log(`- Stdout: ${pyResult.stdout}`);
  if (pyResult.status !== 'passed') throw new Error('Python execution failed');

  // Python failure test
  console.log('\nTesting Python Assertion Error Handling:');
  const pyFailResult = await executor.execute({
    language: 'python',
    code: `
def add(a, b):
    return a * b  # intentional bug
`,
    harness: `
assert add(2, 3) == 5, "Expected 2 + 3 to equal 5"
`,
  });
  console.log(`- Status: ${pyFailResult.status} (expected runtime_error/failed)`);
  console.log(`- ExitCode: ${pyFailResult.exitCode}`);
  console.log(`- Stderr includes assertion error: ${pyFailResult.stderr.includes('AssertionError')}`);

  // JavaScript test
  console.log('\nTesting JavaScript Execution:');
  const jsResult = await executor.execute({
    language: 'javascript',
    code: `
function greet(name) {
  return "Hello, " + name + "!";
}
console.log(greet("AdaptLearn"));
`,
    harness: `
if (greet("World") !== "Hello, World!") {
  throw new Error("greet failed");
}
console.log("All JS assertions passed!");
`,
  });
  console.log(`- Status: ${jsResult.status}`);
  console.log(`- Stdout: ${jsResult.stdout}`);
  if (jsResult.status !== 'passed') throw new Error('JavaScript execution failed');

  // Timeout test
  console.log('\nTesting Timeout Handling (infinite loop):');
  const timeoutResult = await executor.execute({
    language: 'python',
    code: `
while True:
    pass
`,
    timeoutMs: 1500,
  });
  console.log(`- Status: ${timeoutResult.status} (expected timeout)`);
  console.log(`- Duration: ${timeoutResult.durationMs}ms`);
  console.log(`- Stderr: ${timeoutResult.stderr}`);
  if (timeoutResult.status !== 'timeout') throw new Error('Timeout handling failed');

  console.log('\n=== ALL SANDBOX TESTS PASSED SUCCESSFULLY! ===');
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
