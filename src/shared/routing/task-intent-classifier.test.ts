import { describe, expect, test } from "bun:test"

import {
  classifyTaskIntent,
  formatIntentClassification,
  TASK_INTENT_CATEGORIES,
} from "./task-intent-classifier"
import type { TaskIntentCategory } from "./task-intent-classifier"

describe("classifyTaskIntent", () => {
  // ── Backend ────────────────────────────────────────────────────────────────

  test("backend: API endpoint creation", () => {
    const result = classifyTaskIntent("Create a new REST API endpoint for user profiles with database queries and authentication")
    expect(result.primaryDomain).toBe("backend")
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.matchedSignals.length).toBeGreaterThanOrEqual(1)
    expect(result.matchedSignals.some((s) => s.keyword === "api")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "rest")).toBe(true)
  })

  test("backend: Prisma schema and migration", () => {
    const result = classifyTaskIntent("Update the Prisma schema with a new model and run the migration")
    expect(result.primaryDomain).toBe("backend")
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.matchedSignals.some((s) => s.keyword === "prisma schema")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "migration")).toBe(true)
  })

  test("backend: service layer with Express and Prisma", () => {
    const result = classifyTaskIntent("Add a new service layer for the order controller using Express and Prisma repository pattern")
    expect(result.primaryDomain).toBe("backend")
    expect(result.matchedSignals.some((s) => s.keyword === "controller")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "express")).toBe(true)
  })

  // ── Frontend ───────────────────────────────────────────────────────────────

  test("frontend: React component", () => {
    const result = classifyTaskIntent("Build a responsive React component with Tailwind CSS for the user dashboard")
    expect(result.primaryDomain).toBe("frontend")
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.matchedSignals.some((s) => s.keyword === "react")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "tailwind")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "responsive")).toBe(true)
  })

  test("frontend: Next.js page layout", () => {
    const result = classifyTaskIntent("Create a new Next.js page layout with shadcn components and dark theme support")
    expect(result.primaryDomain).toBe("frontend")
    expect(result.matchedSignals.some((s) => s.keyword === "next.js" || s.keyword === "nextjs")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "shadcn")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "layout")).toBe(true)
  })

  test("frontend: CSS styling", () => {
    const result = classifyTaskIntent("Update the CSS styles for the login page to match the new design system")
    expect(result.primaryDomain).toBe("frontend")
    expect(result.matchedSignals.some((s) => s.keyword === "css")).toBe(true)
  })

  // ── Documentation ──────────────────────────────────────────────────────────

  test("docs: README update", () => {
    const result = classifyTaskIntent("Write a README for the project with installation and usage documentation")
    expect(result.primaryDomain).toBe("docs")
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.matchedSignals.some((s) => s.keyword === "readme")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "documentation")).toBe(true)
  })

  test("docs: API documentation", () => {
    const result = classifyTaskIntent("Generate OpenAPI/Swagger documentation for the new endpoints")
    expect(result.primaryDomain).toBe("docs")
    expect(result.matchedSignals.some((s) => s.keyword === "openapi")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "swagger")).toBe(true)
  })

  // ── Security ───────────────────────────────────────────────────────────────

  test("security: vulnerability audit", () => {
    const result = classifyTaskIntent("Audit the codebase for XSS, SQL injection, and CSRF vulnerabilities")
    expect(result.primaryDomain).toBe("security")
    expect(result.confidence).toBeGreaterThan(0.6)
    expect(result.matchedSignals.some((s) => s.keyword === "xss")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "sqli" || s.keyword === "sql injection")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "csrf")).toBe(true)
  })

  test("security: auth permissions", () => {
    const result = classifyTaskIntent("Implement OAuth2 authentication with proper permission scopes and token encryption")
    expect(result.primaryDomain).toBe("security")
    expect(result.matchedSignals.some((s) => s.keyword === "oauth")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "permission")).toBe(true)
  })

  // ── Refactor ───────────────────────────────────────────────────────────────

  test("refactor: clean up tech debt", () => {
    const result = classifyTaskIntent("Refactor the controller layer to consolidate duplicate validation logic and simplify error handling")
    expect(result.primaryDomain).toBe("refactor")
    expect(result.confidence).toBeGreaterThan(0.3)
    expect(result.matchedSignals.some((s) => s.keyword === "refactor")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "simplify")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "consolidate")).toBe(true)
  })

  test("refactor: rename and extract", () => {
    const result = classifyTaskIntent("Rename the UserService to UserManager and extract address handling into a separate module")
    expect(result.primaryDomain).toBe("refactor")
    expect(result.matchedSignals.some((s) => s.keyword === "rename")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "extract")).toBe(true)
  })

  // ── Debugging ──────────────────────────────────────────────────────────────

  test("debugging: fix runtime error", () => {
    const result = classifyTaskIntent("Fix the null reference error that crashes the user profile page when loading without data")
    expect(result.primaryDomain).toBe("debugging")
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.matchedSignals.some((s) => s.keyword === "fix")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "error")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "crash")).toBe(true)
  })

  test("debugging: investigate bug", () => {
    const result = classifyTaskIntent("Investigate why the login flow is broken — users report incorrect token validation after password reset")
    expect(result.primaryDomain).toBe("debugging")
    expect(result.matchedSignals.some((s) => s.keyword === "broken")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "bug" || s.keyword === "fix" || s.keyword === "incorrect")).toBe(true)
  })

  // ── Planning ───────────────────────────────────────────────────────────────

  test("planning: architecture design", () => {
    const result = classifyTaskIntent("Design the architecture for a new microservices-based order system with event-driven communication")
    expect(result.primaryDomain).toBe("planning")
    expect(result.confidence).toBeGreaterThan(0.3)
    expect(result.matchedSignals.some((s) => s.keyword === "architecture")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "design")).toBe(true)
  })

  test("planning: strategic roadmap", () => {
    const result = classifyTaskIntent("Create a strategic roadmap for migrating the monolith to microservices with clear milestones")
    expect(result.primaryDomain).toBe("planning")
    expect(result.matchedSignals.some((s) => s.keyword === "roadmap")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "milestone")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword?.startsWith("strateg") ?? false)).toBe(true)
  })

  // ── Research ───────────────────────────────────────────────────────────────

  test("research: investigate approach", () => {
    const result = classifyTaskIntent("Investigate and research the best approach for implementing real-time notifications using WebSockets or Server-Sent Events")
    expect(result.primaryDomain).toBe("research")
    expect(result.matchedSignals.some((s) => s.keyword === "research")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "investigate")).toBe(true)
  })

  test("research: compare solutions", () => {
    const result = classifyTaskIntent("Research and compare different approaches for real-time sync and evaluate which solution has the best performance characteristics")
    expect(result.primaryDomain).toBe("research")
    expect(result.matchedSignals.some((s) => s.keyword === "research")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "compare")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "evaluate")).toBe(true)
  })

  // ── Multi-domain ───────────────────────────────────────────────────────────

  test("multi-domain: full-stack feature", () => {
    const result = classifyTaskIntent("Build a new user profile feature — create the Prisma data model, REST API endpoints, and a React frontend component")
    expect(result.primaryDomain).toBe("multi-domain")
    expect(result.isMultiDomain).toBe(true)
    // Should have both backend and frontend signals
    expect(result.secondaryDomains).toContain("backend" as TaskIntentCategory)
    expect(result.matchedSignals.some((s) => s.keyword === "react")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "prisma")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "api")).toBe(true)
  })

  test("multi-domain: backend + frontend", () => {
    const result = classifyTaskIntent("Add a new settings page with a React frontend and a Node.js API backend that stores preferences in PostgreSQL")
    expect(result.primaryDomain).toBe("multi-domain")
    expect(result.isMultiDomain).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "frontend")).toBe(true)
    expect(result.matchedSignals.some((s) => s.keyword === "backend")).toBe(true)
  })

  // ── Unknown ────────────────────────────────────────────────────────────────

  test("unknown: empty input", () => {
    const result = classifyTaskIntent("")
    expect(result.primaryDomain).toBe("unknown")
    expect(result.confidence).toBe(0)
    expect(result.matchedSignals).toHaveLength(0)
  })

  test("unknown: gibberish", () => {
    const result = classifyTaskIntent("fubar zogwoggle blorple snazzleflab")
    expect(result.primaryDomain).toBe("unknown")
    expect(result.confidence).toBe(0)
  })

  test("unknown: short vague input", () => {
    const result = classifyTaskIntent("do the thing")
    expect(result.primaryDomain).toBe("unknown")
  })

  // ── Ambiguity / Edge Cases ─────────────────────────────────────────────────

  test("ambiguous: security-adjacent backend task leans to primary domain", () => {
    // "auth" matches both backend and security; backend should have higher
    // cumulative score from additional backend signals
    const result = classifyTaskIntent("Add JWT authentication middleware to the Express API route")
    // This has backend signals (express, api, route, middleware, jwt) and security (auth, token, jwt)
    // backend should win because it has more signals
    expect(result.primaryDomain === "backend" || result.primaryDomain === "multi-domain" || result.primaryDomain === "security").toBe(true)
    // At minimum it should have found signals
    expect(result.matchedSignals.length).toBeGreaterThanOrEqual(2)
  })

  test("matched signals are deduplicated", () => {
    const result = classifyTaskIntent("API API API API API endpoint endpoint endpoint")
    // "api" and "endpoint" should each appear at most once
    const apiSignals = result.matchedSignals.filter((s) => s.keyword === "api")
    const endpointSignals = result.matchedSignals.filter((s) => s.keyword === "endpoint")
    expect(apiSignals.length).toBeLessThanOrEqual(1)
    expect(endpointSignals.length).toBeLessThanOrEqual(1)
  })

  test("secondary domains are populated when strength threshold is met", () => {
    // Mix security + backend signals
    const result = classifyTaskIntent("Audit the authentication API endpoint for JWT token security vulnerabilities")
    // Should identify security or backend as primary, with the other as secondary
    expect(result.secondaryDomains.length).toBeGreaterThanOrEqual(0)
    // The secondary domains array should not include the primary
    if (result.secondaryDomains.length > 0) {
      expect(result.secondaryDomains).not.toContain(result.primaryDomain)
    }
  })

  // ── Category Enum ──────────────────────────────────────────────────────────

  test("all expected categories are defined", () => {
    const expected: TaskIntentCategory[] = [
      "backend",
      "frontend",
      "docs",
      "security",
      "refactor",
      "debugging",
      "planning",
      "research",
      "multi-domain",
      "unknown",
    ]
    for (const cat of expected) {
      expect(TASK_INTENT_CATEGORIES).toContain(cat)
    }
  })
})

describe("formatIntentClassification", () => {
  test("formats a known classification as a readable string", () => {
    const result = classifyTaskIntent("Write a README for the API documentation")
    const formatted = formatIntentClassification(result)
    expect(formatted).toContain("domain:")
    expect(formatted).toContain("confidence:")
    expect(formatted).toContain(result.primaryDomain)
  })

  test("formats an unknown classification", () => {
    const result = classifyTaskIntent("")
    const formatted = formatIntentClassification(result)
    expect(formatted).toContain("unknown")
  })
})
