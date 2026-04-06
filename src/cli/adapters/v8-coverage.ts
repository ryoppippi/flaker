import type { CoverageAdapter, CoverageEdge } from "./coverage-types.js";

interface V8ScriptCoverage {
  url: string;
  functions: Array<{
    functionName: string;
    ranges: Array<{
      startOffset: number;
      endOffset: number;
      count: number;
    }>;
  }>;
}

interface V8CoverageResult {
  result: V8ScriptCoverage[];
}

/**
 * Normalize V8 URL (file:///path) to relative path.
 */
function normalizeV8Url(url: string): string {
  return url
    .replace(/^file:\/\//, "")
    .replace(/^.*\/(src\/|lib\/|app\/|packages\/)/, "$1");
}

/**
 * V8 coverage adapter.
 *
 * Expects V8 coverage JSON format (Node.js --experimental-test-coverage
 * or `process.emit('coverage')` output):
 *
 * ```json
 * [
 *   {
 *     "result": [
 *       {
 *         "url": "file:///path/to/file.ts",
 *         "functions": [
 *           {
 *             "functionName": "myFunc",
 *             "ranges": [
 *               { "startOffset": 0, "endOffset": 100, "count": 1 }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * ]
 * ```
 *
 * Per-test format: array of { test: "name", coverage: V8Result }
 */
export const v8CoverageAdapter: CoverageAdapter = {
  name: "v8",
  parse(input: string): CoverageEdge[] {
    const parsed = JSON.parse(input);
    const results: CoverageEdge[] = [];

    // Detect per-test format: array of { test, coverage }
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      "test" in parsed[0] &&
      "coverage" in parsed[0]
    ) {
      for (const entry of parsed) {
        const edges = extractV8Edges(entry.coverage);
        if (edges.length > 0) {
          results.push({
            suite: entry.test,
            testName: entry.test,
            edges,
          });
        }
      }
    } else {
      // Single V8 coverage result
      const coverageResults: V8CoverageResult[] = Array.isArray(parsed)
        ? parsed
        : [parsed];
      const allEdges: string[] = [];
      for (const cr of coverageResults) {
        allEdges.push(...extractV8Edges(cr));
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

function extractV8Edges(coverage: V8CoverageResult): string[] {
  const edges: string[] = [];

  for (const script of coverage.result) {
    // Skip node_modules and internal files
    if (
      script.url.includes("node_modules") ||
      script.url.startsWith("node:") ||
      script.url.startsWith("internal/")
    ) {
      continue;
    }

    const normalizedPath = normalizeV8Url(script.url);

    for (const fn of script.functions) {
      // Use the first range (function body) with count > 0 as an edge
      if (fn.ranges.length > 0 && fn.ranges[0].count > 0) {
        const startOffset = fn.ranges[0].startOffset;
        edges.push(`${normalizedPath}:${fn.functionName || startOffset}`);
      }
    }
  }

  return [...new Set(edges)];
}
