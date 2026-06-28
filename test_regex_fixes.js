const testCases = [
  ["DELEGATION-FIRST ORCHESTRATION POLICY", /DELEGATION-FIRST ORCHESTRATION POLICY/i, "DELEGATION-FIRST ORCHESTRATION POLICY"],
  ["FLEXIBLE WORK CLASSIFICATION", /FLEXIBLE WORK CLASSIFICATION/i, "FLEXIBLE WORK CLASSIFICATION"],
  ["EXECUTION DECISION MODEL", /EXECUTION DECISION MODEL/i, "EXECUTION DECISION MODEL"],
  ["tools are denied at runtime for orchestrator agents", /tools are denied at runtime for orchestrator agents/i, "tools are denied at runtime for orchestrator agents"],
  ["tools are denied at runtime for orchestrator agents. Do not attempt to use them", /tools are denied at runtime for orchestrator agents\. Do not attempt to use them/i, "tools are denied at runtime for orchestrator agents. Do not attempt to use them"],
  ["AGENT SUITABILITY PROTOCOL", /AGENT SUITABILITY PROTOCOL/i, "AGENT SUITABILITY PROTOCOL"],
  ["scan-first then delegate with refined understanding", /scan-first then delegate with refined understanding/i, "scan-first then delegate with refined understanding"],
  ["DEPENDENCY-AWARE DELEGATION EXAMPLES", /DEPENDENCY-AWARE DELEGATION EXAMPLES/i, "DEPENDENCY-AWARE DELEGATION EXAMPLES"],
  ["Never silently fall back from an unknown or disabled exact agent", /Never silently fall back from an unknown or disabled exact agent/i, "Never silently fall back from an unknown or disabled exact agent"],
  ["SOFTENED DELEGATION POLICY", /SOFTENED DELEGATION POLICY/i, "SOFTENED DELEGATION POLICY"],
  ["STATUS: BLOCKED", /STATUS: BLOCKED/, "STATUS: BLOCKED"],
  ["Do not use category routing when an exact custom agent exists", /Do not use category routing when an exact custom agent exists/i, "Do not use category routing when an exact custom agent exists"],
];

testCases.forEach(([text, pattern, description]) => {
  const result = pattern.test(text);
  console.log(`${description}: ${result ? "PASS" : "FAIL"}`);
  if (!result) console.log(`  Expected match for: ${text}`);
  if (result) console.log(`  Matched using: ${pattern.source}`);
});
EOF
bun run test_regex_fixes.js
