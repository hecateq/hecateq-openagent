const prompt = "test string";

// Test various regex patterns that should work
console.log("Test 1: ", prompt.toLowerCase().includes("test"));
console.log("Test 2: ", /test/.test(prompt));
console.log("Test 3: ", /test string/.test(prompt));
