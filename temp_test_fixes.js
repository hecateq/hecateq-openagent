// Simple test to verify regex functionality
const tests = [
  ["DELEGATION-FIRST ORCHESTRATION POLICY", /DELEGATION-FIRST ORCHESTRATION POLICY/i, true],
  ["DELEGATION-FIRST ORCHESTRATION POLICY", /delegation-first orchestration policy/i, true],
  ["test text", /test/i, true],
  ["test text", /production/i, false],
  ["tools are denied at runtime for orchestrator agents", /tools are denied at runtime for orchestrator agents/i, true],
  ["tools are denied at runtime for orchestrator agents. Do not attempt to use them", /tools are denied at runtime for orchestrator agents\\. Do not attempt to use them/i, true],
  ["AGENT SUITABILITY PROTOCOL", /agent suitability protocol/i, true],
  ["STATUS: BLOCKED", /STATUS: BLOCKED/, true],
  ["SOFTENED DELEGATION POLICY", /softened delegation policy/i, true],
];

// Run the tests
tests.forEach(([text, pattern, expected]) => {
  const result = pattern.test(text);
  const status = result === expected ? "PASS" : "FAIL";
  console.log(`${status}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
  if (result !== expected) {
    console.log(`  Expected: ${expected}, Got: ${result}`);
    console.log(`  Pattern: ${pattern.source}`);
  }
});
