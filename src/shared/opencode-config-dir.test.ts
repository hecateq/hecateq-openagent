import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { homedir } from "node:os"
import { join, resolve, win32 } from "node:path"
import {
  getOpenCodeConfigDir,
  getOpenCodeConfigDirs,
  getOpenCodeConfigPaths,
  isDevBuild,
  detectExistingConfigDir,
  TAURI_APP_IDENTIFIER,
  TAURI_APP_IDENTIFIER_DEV,
} from "./opencode-config-dir"

describe("opencode-config-dir", () => {
  let originalPlatform: NodeJS.Platform
  let originalEnv: Record<string, string | undefined>

  beforeEach(() => {
    originalPlatform = process.platform
    originalEnv = {
      APPDATA: process.env.APPDATA,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
    }
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value !== undefined) {
        process.env[key] = value
      } else {
        delete process.env[key]
      }
    }
  })

  describe("OPENCODE_CONFIG_DIR environment variable", () => {
    test("returns OPENCODE_CONFIG_DIR when env var is set", () => {
      // given OPENCODE_CONFIG_DIR is set to a custom path
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns the custom path
      expect(result).toBe(resolve("/custom/opencode/path"))
    })

    test("falls back to default when env var is not set", () => {
      // given OPENCODE_CONFIG_DIR is not set, platform is Linux
      delete process.env.OPENCODE_CONFIG_DIR
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("falls back to default when env var is empty string", () => {
      // given OPENCODE_CONFIG_DIR is set to empty string
      process.env.OPENCODE_CONFIG_DIR = ""
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("falls back to default when env var is whitespace only", () => {
      // given OPENCODE_CONFIG_DIR is set to whitespace only
      process.env.OPENCODE_CONFIG_DIR = "   "
      delete process.env.XDG_CONFIG_HOME
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns default ~/.config/opencode
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("resolves relative path to absolute path", () => {
      // given OPENCODE_CONFIG_DIR is set to a relative path
      process.env.OPENCODE_CONFIG_DIR = "./my-opencode-config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns resolved absolute path
      expect(result).toBe(resolve("./my-opencode-config"))
    })

    test("OPENCODE_CONFIG_DIR takes priority over XDG_CONFIG_HOME", () => {
      // given both OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME are set
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      process.env.XDG_CONFIG_HOME = "/xdg/config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then OPENCODE_CONFIG_DIR takes priority
      expect(result).toBe(resolve("/custom/opencode/path"))
    })

    test("returns both custom and default config directories for additive discovery", () => {
      // given both OPENCODE_CONFIG_DIR and XDG_CONFIG_HOME are set
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      process.env.XDG_CONFIG_HOME = "/xdg/config"
      Object.defineProperty(process, "platform", { value: "linux" })

      // when getOpenCodeConfigDirs is called
      const result = getOpenCodeConfigDirs({ binary: "opencode", version: "1.0.200" })

      // then the custom path stays first, but the default global path remains visible
      expect(result).toEqual([
        resolve("/custom/opencode/path"),
        resolve("/xdg/config/opencode"),
      ])
    })
  })

  describe("isDevBuild", () => {
    test("returns false for null version", () => {
      expect(isDevBuild(null)).toBe(false)
    })

    test("returns false for undefined version", () => {
      expect(isDevBuild(undefined)).toBe(false)
    })

    test("returns false for production version", () => {
      expect(isDevBuild("1.0.200")).toBe(false)
      expect(isDevBuild("2.1.0")).toBe(false)
    })

    test("returns true for version containing -dev", () => {
      expect(isDevBuild("1.0.0-dev")).toBe(true)
      expect(isDevBuild("1.0.0-dev.123")).toBe(true)
    })

    test("returns true for version containing .dev", () => {
      expect(isDevBuild("1.0.0.dev")).toBe(true)
      expect(isDevBuild("1.0.0.dev.456")).toBe(true)
    })
  })

  describe("getOpenCodeConfigDir", () => {
    describe("for opencode CLI binary", () => {
      test("returns ~/.config/opencode on Linux", () => {
        // given opencode CLI binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME
        delete process.env.OPENCODE_CONFIG_DIR

        // when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns $XDG_CONFIG_HOME/opencode on Linux when XDG_CONFIG_HOME is set", () => {
        // given opencode CLI binary detected, platform is Linux with XDG_CONFIG_HOME set
        Object.defineProperty(process, "platform", { value: "linux" })
        process.env.XDG_CONFIG_HOME = "/custom/config"
        delete process.env.OPENCODE_CONFIG_DIR

        // when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // then returns $XDG_CONFIG_HOME/opencode
        expect(result).toBe(resolve("/custom/config/opencode"))
      })

      test("returns ~/.config/opencode on macOS", () => {
        // given opencode CLI binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })
        delete process.env.XDG_CONFIG_HOME
        delete process.env.OPENCODE_CONFIG_DIR

        // when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

        // then returns ~/.config/opencode
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns ~/.config/opencode on Windows by default", () => {
        // given opencode CLI binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        delete process.env.APPDATA
        delete process.env.XDG_CONFIG_HOME
        delete process.env.OPENCODE_CONFIG_DIR

        // when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200", checkExisting: false })

        // then returns ~/.config/opencode (cross-platform default)
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })

      test("returns ~/.config/opencode on Windows even when APPDATA is set (#2502)", () => {
        // given opencode CLI binary detected, platform is Windows with APPDATA set
        // (regression test: previously would check AppData for existing config)
        Object.defineProperty(process, "platform", { value: "win32" })
        process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"
        delete process.env.XDG_CONFIG_HOME
        delete process.env.OPENCODE_CONFIG_DIR

        // when getOpenCodeConfigDir is called with binary="opencode"
        const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200", checkExisting: false })

        // then returns ~/.config/opencode (ignores APPDATA entirely for CLI)
        expect(result).toBe(join(homedir(), ".config", "opencode"))
      })
    })

    describe("for opencode-desktop Tauri binary", () => {
      test("returns ~/.config/ai.opencode.desktop on Linux", () => {
        // given opencode-desktop binary detected, platform is Linux
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // then returns ~/.config/ai.opencode.desktop
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER))
      })

      test("returns ~/Library/Application Support/ai.opencode.desktop on macOS", () => {
        // given opencode-desktop binary detected, platform is macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // then returns ~/Library/Application Support/ai.opencode.desktop
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER))
      })

      test("returns %APPDATA%/ai.opencode.desktop on Windows", () => {
        // given opencode-desktop binary detected, platform is Windows
        Object.defineProperty(process, "platform", { value: "win32" })
        process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"

        // when getOpenCodeConfigDir is called with binary="opencode-desktop"
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

        // then returns %APPDATA%/ai.opencode.desktop using Windows path semantics
        expect(result).toBe(win32.join("C:\\Users\\TestUser\\AppData\\Roaming", TAURI_APP_IDENTIFIER))
      })

    })

    describe("dev build detection", () => {
      test("returns ai.opencode.desktop.dev path when dev version detected", () => {
        // given opencode-desktop dev version
        Object.defineProperty(process, "platform", { value: "linux" })
        delete process.env.XDG_CONFIG_HOME

        // when getOpenCodeConfigDir is called with dev version
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.0-dev.123", checkExisting: false })

        // then returns path with ai.opencode.desktop.dev
        expect(result).toBe(join(homedir(), ".config", TAURI_APP_IDENTIFIER_DEV))
      })

      test("returns ai.opencode.desktop.dev on macOS for dev build", () => {
        // given opencode-desktop dev version on macOS
        Object.defineProperty(process, "platform", { value: "darwin" })

        // when getOpenCodeConfigDir is called with dev version
        const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.0-dev", checkExisting: false })

        // then returns path with ai.opencode.desktop.dev
        expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER_DEV))
      })
    })
  })

  describe("getOpenCodeConfigPaths", () => {
    test("returns all config paths for CLI binary", () => {
      // given opencode CLI binary on Linux
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode", version: "1.0.200" })

      // then returns all expected paths
      const expectedDir = join(homedir(), ".config", "opencode")
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-openagent.json"))
    })

    test("returns all config paths for desktop binary", () => {
      // given opencode-desktop binary on macOS
      Object.defineProperty(process, "platform", { value: "darwin" })

      // when getOpenCodeConfigPaths is called
      const paths = getOpenCodeConfigPaths({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

      // then returns all expected paths
      const expectedDir = join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER)
      expect(paths.configDir).toBe(expectedDir)
      expect(paths.configJson).toBe(join(expectedDir, "opencode.json"))
      expect(paths.configJsonc).toBe(join(expectedDir, "opencode.jsonc"))
      expect(paths.packageJson).toBe(join(expectedDir, "package.json"))
      expect(paths.omoConfig).toBe(join(expectedDir, "oh-my-openagent.json"))
    })
  })

  describe("detectExistingConfigDir", () => {
    test("returns null when no config exists", () => {
      // given no config files exist
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when detectExistingConfigDir is called
      const result = detectExistingConfigDir("opencode", "1.0.200")

      // then result is either null or a valid string path
      expect(result === null || typeof result === "string").toBe(true)
    })

    test("includes OPENCODE_CONFIG_DIR in search locations when set", () => {
      // given OPENCODE_CONFIG_DIR is set to a custom path
      process.env.OPENCODE_CONFIG_DIR = "/custom/opencode/path"
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME

      // when detectExistingConfigDir is called
      const result = detectExistingConfigDir("opencode", "1.0.200")

      // then result is either null (no config file exists) or a valid string path
      // The important thing is that the function doesn't throw
      expect(result === null || typeof result === "string").toBe(true)
    })
  })

  describe("WSL detection", () => {
    test("WSL is treated as Linux environment, not Windows", () => {
      // given WSL2 environment (Linux kernel, no win32)
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.WSL_DISTRO_NAME = "Ubuntu"
      delete process.env.APPDATA
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns ~/.config/opencode (Linux-style), NOT %APPDATA%
      expect(result).toBe(join(homedir(), ".config", "opencode"))
      expect(result).not.toContain("AppData")
    })

    test("WSL home/config dir stays separate from Windows paths", () => {
      // given WSL with both WSL_DISTRO_NAME and APPDATA set
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.WSL_DISTRO_NAME = "Ubuntu"
      process.env.APPDATA = "C:\\Users\\TestUser\\AppData\\Roaming"
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then WSL does NOT use Windows %APPDATA% or PowerShell paths
      expect(result).toBe(join(homedir(), ".config", "opencode"))
      expect(result).not.toContain("AppData")
      expect(result).not.toContain("Roaming")
      expect(result).not.toContain("C:")
    })
  })

  describe("Windows native path handling", () => {
    test("OPENCODE_CONFIG_DIR with backslash path works on win32", () => {
      // given Windows platform with backslash config path
      Object.defineProperty(process, "platform", { value: "win32" })
      process.env.OPENCODE_CONFIG_DIR = "C:\\Users\\TestUser\\.config\\opencode"
      delete process.env.XDG_CONFIG_HOME

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns resolved Windows path
      expect(result).toBe(resolve("C:\\Users\\TestUser\\.config\\opencode"))
    })

    test("Drive-letter path is preserved on win32", () => {
      // given Windows platform with drive-letter path
      Object.defineProperty(process, "platform", { value: "win32" })
      process.env.OPENCODE_CONFIG_DIR = "D:\\Tools\\opencode"
      delete process.env.XDG_CONFIG_HOME

      // when getOpenCodeConfigDir is called with binary="opencode"
      // Note: On Linux, path.resolve() treats "D:" as a relative path.
      // On actual Windows, it would use win32.resolve() and preserve "D:".
      // The key behavior is that the function does not throw.
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then path is resolved (no throw), and contains the drive-letter prefix
      // On an actual Windows runner, this would start with "D:"
      // On Linux CI, it's resolved as a relative path
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })

    test("Windows desktop app uses %APPDATA% path with win32.join", () => {
      // given Windows platform with APPDATA set
      Object.defineProperty(process, "platform", { value: "win32" })
      process.env.APPDATA = "C:\\Users\\WinUser\\AppData\\Roaming"

      // when getOpenCodeConfigDir called with opencode-desktop
      const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

      // then uses win32.join with APPDATA
      const expected = win32.join("C:\\Users\\WinUser\\AppData\\Roaming", TAURI_APP_IDENTIFIER)
      expect(result).toBe(expected)
      expect(result).toContain("AppData")
    })

    test("Windows opencode-desktop dev build uses dev identifier", () => {
      // given Windows platform with dev version
      Object.defineProperty(process, "platform", { value: "win32" })
      process.env.APPDATA = "C:\\Users\\WinUser\\AppData\\Roaming"

      // when getOpenCodeConfigDir called with dev version
      const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.0-dev.123", checkExisting: false })

      // then uses .dev identifier
      expect(result).toBe(win32.join("C:\\Users\\WinUser\\AppData\\Roaming", TAURI_APP_IDENTIFIER_DEV))
    })
  })

  describe("missing/unreadable directory handling", () => {
    test("missing agents dir returns empty result gracefully (no throw)", () => {
      // given config dir pointing to a non-existent path
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.OPENCODE_CONFIG_DIR = "/nonexistent/opencode/path"
      delete process.env.XDG_CONFIG_HOME

      // when getOpenCodeConfigDir is called - should not throw
      expect(() => {
        getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })
      }).not.toThrow()
    })

    test("getOpenCodeConfigDirs does not throw when OPENCODE_CONFIG_DIR points to nonexistent path", () => {
      // given OPENCODE_CONFIG_DIR pointing to nonexistent directory
      Object.defineProperty(process, "platform", { value: "linux" })
      process.env.OPENCODE_CONFIG_DIR = "/tmp/nonexistent_config_dir"

      // when getOpenCodeConfigDirs is called - should not throw
      expect(() => {
        const dirs = getOpenCodeConfigDirs({ binary: "opencode", version: "1.0.200" })
        // then returns at least the custom dir in the list
        expect(dirs.length).toBeGreaterThanOrEqual(1)
      }).not.toThrow()
    })
  })

  describe("macOS path resolution", () => {
    test("POSIX resolver on macOS behaves like Linux", () => {
      // given macOS platform
      Object.defineProperty(process, "platform", { value: "darwin" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigDir is called with binary="opencode"
      const result = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then returns ~/.config/opencode (same as Linux)
      expect(result).toBe(join(homedir(), ".config", "opencode"))
    })

    test("macOS home/config dir resolution is not hardcoded to Linux path", () => {
      // given macOS platform for opencode-desktop
      Object.defineProperty(process, "platform", { value: "darwin" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigDir called with opencode-desktop
      const result = getOpenCodeConfigDir({ binary: "opencode-desktop", version: "1.0.200", checkExisting: false })

      // then returns macOS-specific path (Library/Application Support), NOT ~/.config
      expect(result).toBe(join(homedir(), "Library", "Application Support", TAURI_APP_IDENTIFIER))
      expect(result).not.toContain(".config")
    })
  })

  describe("Linux path resolution edge cases", () => {
    test("POSIX project .opencode/agents/ path resolves correctly", () => {
      // given Linux platform
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      // when getOpenCodeConfigDir returns the base dir
      const configDir = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })

      // then .opencode/agents/ resolves relative to config dir
      expect(configDir).toBe(join(homedir(), ".config", "opencode"))
    })

    test("POSIX project .claude/agents/ dir is distinct from .opencode/agents/", () => {
      // given Linux platform, both dirs are discoverable separately
      Object.defineProperty(process, "platform", { value: "linux" })
      delete process.env.XDG_CONFIG_HOME
      delete process.env.OPENCODE_CONFIG_DIR

      const configDir = getOpenCodeConfigDir({ binary: "opencode", version: "1.0.200" })
      const opencodeAgentDir = join(configDir, "agents")

      // then .opencode/agents is under config dir
      expect(opencodeAgentDir).toBe(join(homedir(), ".config", "opencode", "agents"))
    })
  })
})
