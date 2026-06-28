const fs = require('fs');
const path = require('path');

// Read the test file
const testFilePath = path.join(__dirname, 'src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts');
let content = fs.readFileSync(testFilePath, 'utf8');

// Function to escape regex special characters
def escapeRegex(text) {
    // Escape characters that have special meaning in regex
    return text.replace(/([.*+?^${}()|[\\]/g, '\\$&');
}

// Function to convert toMatch pattern
def convertToPattern(text) {
    const escaped = escapeRegex(text);
    return `/${escaped}/i`;  // Use i flag for case-insensitive matching
}

// Count toContain conversions in the target range (0-indexed)
let conversions = 0;

// Create array of lines
let lines = content.split('\n');

// Convert from line 348 to 523 (0-indexed: 347 to 522)
for (let i = 347; i < 522; i++) {
    // Check for expect(config!.prompt).toContain("...") pattern
    const line = lines[i];
    const match = line.match(/expect\(config!\.prompt\)\.toContain\("([^"]+)"\)/);
    
    if (match) {
        const text = match[1];
        const pattern = convertToPattern(text);
        
        // Replace toContain with toMatch
        const newLine = line.replace(
            /expect\(config!\.prompt\)\.toContain\("([^"]+)"\)/,
            `expect(config!.prompt).toMatch(${pattern})`
        );
        
        // Clean up double escapes if any
        const cleanLine = newLine.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\\\,/g, ',').replace(/\\\./g, '.').replace(/\\\+/g, '+').replace(/\\\*/g, '*');
        
        lines[i] = cleanLine;
        conversions++;
    }
}

// Write back to file
content = lines.join('\n');
fs.writeFileSync(testFilePath, content, 'utf8');

// Final count
let testCount = 0;
let convertedCount = 0;

for (let i = 347; i < 522; i++) {
    const line = lines[i];
    if (line.includes('.toContain(') && !line.includes('.toMatch(')) {
        testCount++;
    }
    if (line.includes('.toMatch(')) {
        convertedCount++;
    }
}

console.log(`Total patterns in range 348-523: ${testCount}`);
console.log(`Converted to toMatch: ${conversions}`);
console.log(`Converted to toMatch (counted separately): ${convertedCount}`);
console.log(`Remaining toContain: ${testCount - conversions}`);
