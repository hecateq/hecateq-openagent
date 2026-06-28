### Test 1: DELEGATION-FIRST ORCHESTRATION POLICY
const prompt = "DELEGATION-FIRST ORCHESTRATION POLICY test";
const pattern = /DELEGATION-FIRST ORCHESTRATION POLICY/i;
console.log("Test 1 passed:", pattern.test(prompt));

### Test 2: FLEXIBLE WORK CLASSIFICATION
const prompt2 = "FLEXIBLE WORK CLASSIFICATION test";
const pattern2 = /FLEXIBLE WORK CLASSIFICATION/i;
console.log("Test 2 passed:", pattern2.test(prompt2));

### Test 3: EXECUTION DECISION MODEL
const prompt3 = "EXECUTION DECISION MODEL test";
const pattern3 = /EXECUTION DECISION MODEL/i;
console.log("Test 3 passed:", pattern3.test(prompt3));

### Test 4: tool denial message
const prompt4 = "tools are denied at runtime for orchestrator agents";
const pattern4 = /tools are denied at runtime for orchestrator agents/i;
console.log("Test 4 passed:", pattern4.test(prompt4));

### Test 5: tool denial with more text
const prompt5 = "tools are denied at runtime for orchestrator agents. Do not attempt to use them";
const pattern5 = /tools are denied at runtime for orchestrator agents\. Do not attempt to use them/i;
console.log("Test 5 passed:", pattern5.test(prompt5));

### Test 6: AGENT SUITABILITY PROTOCOL
const prompt6 = "AGENT SUITABILITY PROTOCOL test";
const pattern6 = /AGENT SUITABILITY PROTOCOL/i;
console.log("Test 6 passed:", pattern6.test(prompt6));

### Test 7: scan-first fallback
const prompt7 = "scan-first then delegate with refined understanding";
const pattern7 = /scan-first then delegate with refined understanding/i;
console.log("Test 7 passed:", pattern7.test(prompt7));

### Test 8: DEPENDENCY-AWARE DELEGATION EXAMPLES
const prompt8 = "DEPENDENCY-AWARE DELEGATION EXAMPLES test";
const pattern8 = /DEPENDENCY-AWARE DELEGATION EXAMPLES/i;
console.log("Test 8 passed:", pattern8.test(prompt8));

### Test 9: unknown/disabled safety rule
const prompt9 = "Never silently fall back from an unknown or disabled exact agent";
const pattern9 = /Never silently fall back from an unknown or disabled exact agent/i;
console.log("Test 9 passed:", pattern9.test(prompt9));

### Test 10: SOFTENED DELEGATION POLICY
const prompt10 = "SOFTENED DELEGATION POLICY test";
const pattern10 = /SOFTENED DELEGATION POLICY/i;
console.log("Test 10 passed:", pattern10.test(prompt10));
