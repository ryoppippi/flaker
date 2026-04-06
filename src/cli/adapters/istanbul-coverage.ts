import type { CoverageAdapter, CoverageEdge } from "./coverage-types.js";

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number; column: number }; end: { line: number; column: number } }>;
  s: Record<string, number>;
  fnMap?: Record<string, { name: string }>;
  f?: Record<string, number>;
}

interface IstanbulCoverageJson {
  [filePath: string]: IstanbulFileCoverage;
}

/**
 * Normalize a file path to a relative form for consistent edge IDs.
 */
function normalizePath(p: string): string {
  // Remove common prefixes, keep relative to project root
  return p.replace(/^.*\/(src\/|lib\/|app\/|packages\/)/, "$1");
}

/**
 * Extract covered statement edges from Istanbul coverage data.
 * Each edge is "filePath:line" for statements that were executed (count > 0).
 */
function extractEdges(fileCoverage: IstanbulFileCoverage): string[] {
  const edges: string[] = [];
  const normalizedPath = normalizePath(fileCoverage.path);

  for (const [id, count] of Object.entries(fileCoverage.s)) {
    if (count > 0) {
      const loc = fileCoverage.statementMap[id];
      if (loc) {
        edges.push(`${normalizedPath}:${loc.start.line}`);
      }
    }
  }

  return edges;
}

/**
 * Istanbul coverage adapter.
 *
 * Expects a JSON object mapping file paths to Istanbul coverage data.
 * When used per-test, the input should be an object with test names as keys
 * and Istanbul coverage as values:
 *
 * ```json
 * {
 *   "tests/auth.test.ts > login flow": { "src/auth.ts": { ... } },
 *   "tests/auth.test.ts > logout": { "src/auth.ts": { ... } }
 * }
 * ```
 *
 * Or for single-file mode, just the Istanbul coverage object directly
 * (suite name inferred from context).
 */
export const istanbulCoverageAdapter: CoverageAdapter = {
  name: "istanbul",
  parse(input: string): CoverageEdge[] {
    const parsed = JSON.parse(input);
    const results: CoverageEdge[] = [];

    // Check if this is single Istanbul coverage object (values have statementMap)
    // or per-test format (values are objects mapping file paths to IstanbulFileCoverage)
    const values = Object.values(parsed);
    const isSingleFile =
      values.length > 0 &&
      typeof values[0] === "object" &&
      values[0] !== null &&
      "statementMap" in (values[0] as Record<string, unknown>);

    if (isSingleFile) {
      // Single Istanbul coverage object: { "filePath": IstanbulFileCoverage }
      const coverage = parsed as IstanbulCoverageJson;
      const allEdges: string[] = [];
      for (const fileCov of Object.values(coverage)) {
        allEdges.push(...extractEdges(fileCov));
      }
      if (allEdges.length > 0) {
        results.push({
          suite: "unknown",
          testName: "unknown",
          edges: [...new Set(allEdges)],
        });
      }
    } else {
      // Per-test format: { "testName": { "filePath": IstanbulFileCoverage } }
      for (const [testName, fileCoverages] of Object.entries(parsed)) {
        const allEdges: string[] = [];
        for (const fileCov of Object.values(fileCoverages as Record<string, IstanbulFileCoverage>)) {
          allEdges.push(...extractEdges(fileCov));
        }
        if (allEdges.length > 0) {
          results.push({
            suite: testName,
            testName,
            edges: [...new Set(allEdges)],
          });
        }
      }
    }

    return results;
  },
};
