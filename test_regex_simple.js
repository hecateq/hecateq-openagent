const tests = [
  ["DELEGATION-FIRST ORCHESTRATION POLICY", /DELEGATION-FIRST ORCHESTRATION POLICY/i],
  ["FLEXIBLE WORK CLASSIFICATION", /FLEXIBLE WORK CLASSIFICATION/i],
  ["EXECUTION DECISION MODEL", /EXECUTION DECISION MODEL/i],
  ["tools are denied at runtime for orchestrator agents", /tools are denied at runtime for orchestrator agents/i],
  ["tools are denied at runtime for orchestrator agents. Do not attempt to use them", /tools are denied at runtime for orchestrator agents. Do not attempt to use them/i],
  ["AGENT SUITABILITY PROTOCOL", /AGENT SUITABILITY PROTOCOL/i],
  ["scan-first then delegate with refined understanding", /scan-first then delegate with refined understanding/i],
  ["DEPENDENCY-AWARE DELEGATION EXAMPLES", /DEPENDENCY-AWARE DELEGATION EXAMPLES/i],
  ["Never silently fall back from an unknown or disabled exact agent", /Never silently fall back from an unknown or disabled exact agent/i],
  ["SOFTENED DELEGATION POLICY", /SOFTENED DELEGATION POLICY/i],
  ["Do not use category routing when an exact custom agent exists", /Do not use category routing when an exact custom agent exists/i],
  ["If an exact agent is unknown or disabled, do not silently fall back", /If an exact agent is unknown or disabled, do not silently fall back/i],
];

tests.forEach(([text, pattern]) => {
  const result = pattern.test(text);
  console.log(`${pattern.source}: ${result}`);
});
