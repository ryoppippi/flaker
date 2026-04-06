import { describe, it, expect } from "vitest";
import { createCoverageAdapter } from "../../src/cli/adapters/coverage-index.js";
import type { CoverageEdge } from "../../src/cli/adapters/coverage-types.js";

describe("createCoverageAdapter", () => {
  it("returns istanbul adapter", () => {
    const adapter = createCoverageAdapter("istanbul");
    expect(adapter.name).toBe("istanbul");
  });

  it("returns v8 adapter", () => {
    const adapter = createCoverageAdapter("v8");
    expect(adapter.name).toBe("v8");
  });

  it("returns playwright adapter", () => {
    const adapter = createCoverageAdapter("playwright");
    expect(adapter.name).toBe("playwright");
  });

  it("throws on unknown type", () => {
    expect(() => createCoverageAdapter("unknown")).toThrow("Unknown coverage adapter type");
  });
});

describe("istanbulCoverageAdapter", () => {
  const adapter = createCoverageAdapter("istanbul");

  it("parses per-test Istanbul coverage", () => {
    const input = JSON.stringify({
      "tests/auth.test.ts > login": {
        "/project/src/auth.ts": {
          path: "/project/src/auth.ts",
          statementMap: {
            "0": { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
            "1": { start: { line: 15, column: 0 }, end: { line: 15, column: 20 } },
          },
          s: { "0": 1, "1": 0 },
        },
      },
      "tests/auth.test.ts > logout": {
        "/project/src/auth.ts": {
          path: "/project/src/auth.ts",
          statementMap: {
            "0": { start: { line: 10, column: 0 }, end: { line: 10, column: 20 } },
            "1": { start: { line: 20, column: 0 }, end: { line: 20, column: 20 } },
          },
          s: { "0": 0, "1": 1 },
        },
      },
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(2);

    const login = results.find((r) => r.testName === "tests/auth.test.ts > login");
    expect(login).toBeDefined();
    expect(login!.edges).toContain("src/auth.ts:10");
    expect(login!.edges).not.toContain("src/auth.ts:15"); // count=0

    const logout = results.find((r) => r.testName === "tests/auth.test.ts > logout");
    expect(logout).toBeDefined();
    expect(logout!.edges).toContain("src/auth.ts:20");
  });

  it("parses single-file Istanbul coverage", () => {
    const input = JSON.stringify({
      "/project/src/app.ts": {
        path: "/project/src/app.ts",
        statementMap: {
          "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { "0": 5 },
      },
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].suite).toBe("unknown");
    expect(results[0].edges).toContain("src/app.ts:1");
  });

  it("returns empty for no covered statements", () => {
    const input = JSON.stringify({
      "/project/src/app.ts": {
        path: "/project/src/app.ts",
        statementMap: {
          "0": { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        },
        s: { "0": 0 },
      },
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(0);
  });
});

describe("v8CoverageAdapter", () => {
  const adapter = createCoverageAdapter("v8");

  it("parses per-test V8 coverage", () => {
    const input = JSON.stringify([
      {
        test: "tests/auth.test.ts > login",
        coverage: {
          result: [
            {
              url: "file:///project/src/auth.ts",
              functions: [
                { functionName: "login", ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
                { functionName: "logout", ranges: [{ startOffset: 100, endOffset: 200, count: 0 }] },
              ],
            },
          ],
        },
      },
    ]);

    const results = adapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("tests/auth.test.ts > login");
    expect(results[0].edges).toContain("src/auth.ts:login");
    expect(results[0].edges).not.toContain("src/auth.ts:logout");
  });

  it("skips node_modules", () => {
    const input = JSON.stringify({
      result: [
        {
          url: "file:///project/node_modules/lodash/index.js",
          functions: [
            { functionName: "map", ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
          ],
        },
        {
          url: "file:///project/src/app.ts",
          functions: [
            { functionName: "main", ranges: [{ startOffset: 0, endOffset: 50, count: 1 }] },
          ],
        },
      ],
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].edges).toEqual(["src/app.ts:main"]);
  });
});

describe("playwrightCoverageAdapter", () => {
  const adapter = createCoverageAdapter("playwright");

  it("parses entries format", () => {
    const input = JSON.stringify({
      entries: [
        {
          title: "login test",
          file: "auth.spec.ts",
          suites: ["auth", "login"],
          result: [
            {
              url: "file:///project/src/auth.ts",
              functions: [
                { functionName: "login", ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] },
              ],
            },
          ],
        },
      ],
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].suite).toBe("auth > login");
    expect(results[0].testName).toBe("login test");
    expect(results[0].edges).toContain("src/auth.ts:login");
  });

  it("parses tests array format", () => {
    const input = JSON.stringify({
      tests: [
        {
          title: "page loads",
          file: "e2e/home.spec.ts",
          coverage: {
            result: [
              {
                url: "file:///project/src/pages/home.tsx",
                functions: [
                  { functionName: "Home", ranges: [{ startOffset: 0, endOffset: 200, count: 1 }] },
                ],
              },
            ],
          },
        },
      ],
    });

    const results = adapter.parse(input);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("page loads");
    expect(results[0].edges).toContain("src/pages/home.tsx:Home");
  });
});
