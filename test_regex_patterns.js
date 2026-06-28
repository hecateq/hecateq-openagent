const patternsToTest = [
  ["DELEGATION-FIRST ORCHESTRATION POLICY", /DELEGATION-FIRST ORCHESTRATION POLICY/i, "DELEGATION-FIRST ORCHESTRATION POLICY"],
  ["FLEXIBLE WORK CLASSIFICATION", /FLEXIBLE WORK CLASSIFICATION/i, "FLEXIBLE WORK CLASSIFICATION"],
  ["EXECUTION DECISION MODEL", /EXECUTION DECISION MODEL/i, "EXECUTION DECISION MODEL"],
  ["tools are denied at runtime for orchestrator agents", /tools are denied at runtime for orchestrator agents/i, "tools are denied at runtime for orchestrator agents"],
  ["tools are denied at runtime for orchestrator agents. Do not attempt to use them", /tools are denied at runtime for orchestrator agents. Do not attempt to use them/i, "tools are denied at runtime for orchestrator agents. Do not attempt to use them"],
  ["AGENT SUITABILITY PROTOCOL", /AGENT SUITABILITY PROTOCOL/i, "AGENT SUITABILITY PROTOCOL"],
  ["scan-first then delegate with refined understanding", /scan-first then delegate with refined understanding/i, "scan-first then delegate with refined understanding"],
  ["DEPENDENCY-AWARE DELEGATION EXAMPLES", /DEPENDENCY-AWARE DELEGATION EXAMPLES/i, "DEPENDENCY-AWARE DELEGATION EXAMPLES"],
  ["Never silently fall back from an unknown or disabled exact agent", /Never silently fall back from an unknown or disabled exact agent/i, "Never silently fall back from an unknown or disabled exact agent"],
  ["SOFTENED DELEGATION POLICY", /SOFTENED DELEGATION POLICY/i, "SOFTENED DELEGATION POLICY"],
];

console.log("Testing regex patterns...");
let allPassed = true;

patternsToTest.forEach(([text, pattern, description]) => {
  const result = pattern.test(text);
  const passed = result;
  if (!passed) {
    console.log(`FAIL: ${description}`);
    console.log(`  Pattern: ${pattern.source}`);
    console.log(`  Text: ${text}`);
    allPassed = false;
  } else {
    console.log(`PASS: ${description}`);
  }
});

if (allPassed) {
  console.log("\nAll regex tests passed!")
} else {
  console.log("\nSome regex tests failed.")
}
