import type { CoverageAdapter, CoverageEdge } from "./coverage-types.js";

interface PlaywrightCoverageEntry {
  testId?: string;
  title?: string;
  file?: string;
  suites?: string[];
  // V8 coverage result
  result: Array<{
    url: string;
    functions: Array<{
      functionName: string;
      ranges: Array<{
        startOffset: number;
        endOffset: number;
        count: number;
      }>;
    }>;
  }>;
}

interface PlaywrightCoverageJson {
  entries?: PlaywrightCoverageEntry[];
  // Or flat array
  tests?: Array<{
    title: string;
    file: string;
    coverage: PlaywrightCoverageEntry;
  }>;
}

function normalizeUrl(url: string): string {
  return url
    .replace(/^file:\/\//, "")
    .replace(/^.*\/(src\/|lib\/|app\/|packages\/)/, "$1");
}

function extractV8Edges(
  result: PlaywrightCoverageEntry["result"],
): string[] {
  const edges: string[] = [];

  for (const script of result) {
    if (
      script.url.includes("node_modules") ||
      script.url.startsWith("node:") ||
      script.url.startsWith("internal/")
    ) {
      continue;
    }

    const normalizedPath = normalizeUrl(script.url);

    for (const fn of script.functions) {
      if (fn.ranges.length > 0 && fn.ranges[0].count > 0) {
        const startOffset = fn.ranges[0].startOffset;
        edges.push(
          `${normalizedPath}:${fn.functionName || startOffset}`,
        );
      }
    }
  }

  return [...new Set(edges)];
}

/**
 * Playwright coverage adapter.
 *
 * Handles multiple Playwright coverage output formats:
 *
 * 1. Per-test entries array:
 * ```json
 * {
 *   "entries": [
 *     { "title": "login test", "file": "auth.spec.ts", "result": [...] }
 *   ]
 * }
 * ```
 *
 * 2. Tests array with nested coverage:
 * ```json
 * {
 *   "tests": [
 *     { "title": "login test", "file": "auth.spec.ts", "coverage": { "result": [...] } }
 *   ]
 * }
 * ```
 *
 * 3. Flat V8 result array (falls back to v8 behavior, suite from filename).
 */
export const playwrightCoverageAdapter: CoverageAdapter = {
  name: "playwright",
  parse(input: string): CoverageEdge[] {
    const parsed: PlaywrightCoverageJson = JSON.parse(input);
    const results: CoverageEdge[] = [];

    if (parsed.entries) {
      // Format 1: entries array
      for (const entry of parsed.entries) {
        const edges = extractV8Edges(entry.result);
        const suite = entry.suites?.join(" > ") ?? entry.file ?? "unknown";
        const testName = entry.title ?? "unknown";
        if (edges.length > 0) {
          results.push({
            suite,
            testName,
            testId: entry.testId,
            edges,
          });
        }
      }
    } else if (parsed.tests) {
      // Format 2: tests array
      for (const test of parsed.tests) {
        const edges = extractV8Edges(test.coverage.result);
        const suite = test.file ?? "unknown";
        if (edges.length > 0) {
          results.push({
            suite,
            testName: test.title,
            edges,
          });
        }
      }
    } else if (Array.isArray(parsed) || "result" in parsed) {
      // Format 3: flat V8 result
      const result = Array.isArray(parsed) ? parsed : [parsed as unknown as PlaywrightCoverageEntry];
      const allEdges: string[] = [];
      for (const entry of result) {
        if ("result" in entry) {
          allEdges.push(...extractV8Edges(entry.result));
        }
      }
      if (allEdges.length > 0) {
        results.push({
          suite: "unknown",
          testName: "unknown",
          edges: [...new Set(allEdges)],
        });
      }
    }

    return results;
  },
};
