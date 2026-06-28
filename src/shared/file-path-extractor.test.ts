import { describe, test, expect } from "bun:test"
import { extractFilePaths, detectLanguage, LANGUAGE_BY_EXTENSION } from "./file-path-extractor"

describe("LANGUAGE_BY_EXTENSION", () => {
  test("contains typescript for .ts and .tsx", () => {
    // given the LANGUAGE_BY_EXTENSION map
    // when checking .ts and .tsx
    // then both map to typescript
    expect(LANGUAGE_BY_EXTENSION[".ts"]).toBe("typescript")
    expect(LANGUAGE_BY_EXTENSION[".tsx"]).toBe("typescript")
  })

  test("contains dart for .dart", () => {
    // given the LANGUAGE_BY_EXTENSION map
    // when checking .dart
    // then maps to dart
    expect(LANGUAGE_BY_EXTENSION[".dart"]).toBe("dart")
  })
})

describe("extractFilePaths", () => {
  test("extracts backtick-wrapped paths", () => {
    // given a prompt with a backtick-wrapped path
    const prompt = "refactor `src/foo.ts` to add X"
    // when extracting file paths
    const result = extractFilePaths(prompt)
    // then the path is found
    expect(result).toEqual(["src/foo.ts"])
  })

  test("extracts double-quoted paths", () => {
    // given a prompt with a double-quoted path
    const prompt = 'edit "src/api/users.ts" to add validation'
    // when extracting
    const result = extractFilePaths(prompt)
    // then the path is found
    expect(result).toEqual(["src/api/users.ts"])
  })

  test("extracts single-quoted paths", () => {
    // given a prompt with a single-quoted path
    const prompt = "fix 'lib/widgets/card.dart' rendering"
    // when extracting
    const result = extractFilePaths(prompt)
    // then the path is found
    expect(result).toEqual(["lib/widgets/card.dart"])
  })

  test("extracts absolute POSIX path", () => {
    // given a prompt with an absolute POSIX path
    const prompt = "check /home/user/project/src/foo.ts for errors"
    // when extracting
    const result = extractFilePaths(prompt)
    // then the absolute path is found
    expect(result).toEqual(["/home/user/project/src/foo.ts"])
  })

  test("extracts absolute Windows path", () => {
    // given a prompt with an absolute Windows path
    const prompt = "check C:\\Users\\foo\\bar.ts for errors"
    // when extracting
    const result = extractFilePaths(prompt)
    // then the Windows path is found
    expect(result).toEqual(["C:\\Users\\foo\\bar.ts"])
  })

  test("extracts multiple paths in one prompt, deduplicated, order preserved", () => {
    // given a prompt with multiple paths, one repeated with different quoting
    const prompt = "fix `src/foo.ts` and also check \"src/foo.ts\" and 'lib/bar.dart'"
    // when extracting
    const result = extractFilePaths(prompt)
    // then paths are deduplicated (first occurrence wins) and order preserved
    expect(result).toEqual(["src/foo.ts", "lib/bar.dart"])
  })

  test("returns empty array for prompt with no paths", () => {
    // given a prompt without any file paths
    const prompt = "fix the rendering bug in the login component"
    // when extracting
    const result = extractFilePaths(prompt)
    // then result is empty
    expect(result).toEqual([])
  })

  test("filters out URLs", () => {
    // given a prompt containing URLs that look like file paths
    const prompt = "see https://example.com/foo.ts for reference"
    // when extracting
    const result = extractFilePaths(prompt)
    // then URL is NOT treated as a file path
    expect(result).toEqual([])
  })

  test("extracts bare relative path when surrounded by text", () => {
    // given a prompt with an unquoted relative path
    const prompt = "the problem is in src/utils/helpers.ts line 42"
    // when extracting
    const result = extractFilePaths(prompt)
    // then the bare path is found
    expect(result).toEqual(["src/utils/helpers.ts"])
  })

  test("extracts path with deep nesting", () => {
    // given a prompt with a deeply nested path
    const prompt = "update `src/features/hecateq-orchestration/prompt-intake.ts`"
    // when extracting
    const result = extractFilePaths(prompt)
    // then the deeply nested path is found
    expect(result).toEqual(["src/features/hecateq-orchestration/prompt-intake.ts"])
  })

  test("handles empty prompt", () => {
    // given an empty prompt
    const prompt = ""
    // when extracting
    const result = extractFilePaths(prompt)
    // then result is empty
    expect(result).toEqual([])
  })

  test("handles mixed quoting and bare paths together", () => {
    // given a prompt with backtick, double-quoted, single-quoted, and bare paths
    const prompt = 'refactor `src/a.ts`, update "src/b.ts", fix \'src/c.ts\', and check src/d.ts'
    // when extracting
    const result = extractFilePaths(prompt)
    // then all four paths are found, in occurrence order
    expect(result).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"])
  })
})

describe("detectLanguage", () => {
  test("detects typescript from .ts file", () => {
    // given a TypeScript file path
    const filePath = "src/api/users.ts"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns typescript
    expect(result).toBe("typescript")
  })

  test("detects dart from .dart file", () => {
    // given a Dart file path
    const filePath = "lib/widgets/card.dart"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns dart
    expect(result).toBe("dart")
  })

  test("detects python from .py file", () => {
    // given a Python file path
    const filePath = "scripts/deploy.py"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns python
    expect(result).toBe("python")
  })

  test("detects go from .go file", () => {
    // given a Go file path
    const filePath = "cmd/server/main.go"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns go
    expect(result).toBe("go")
  })

  test("returns undefined for file without extension", () => {
    // given a file path without a recognizable extension
    const filePath = "README"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns undefined
    expect(result).toBeUndefined()
  })

  test("returns undefined for unknown extension", () => {
    // given a file with an unknown extension
    const filePath = "data/config.cfg"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns undefined
    expect(result).toBeUndefined()
  })

  test("detects yaml from .yml file (case insensitive)", () => {
    // given a YAML file with uppercase extension
    const filePath = "workflows/CI.YML"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns yaml (case-insensitive match)
    expect(result).toBe("yaml")
  })

  test("detects csharp from .cs file", () => {
    // given a C# file path
    const filePath = "src/Models/User.cs"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns csharp
    expect(result).toBe("csharp")
  })

  test("detects kotlin from .kt file", () => {
    // given a Kotlin file path
    const filePath = "app/src/main/MainActivity.kt"
    // when detecting language
    const result = detectLanguage(filePath)
    // then returns kotlin
    expect(result).toBe("kotlin")
  })
})
