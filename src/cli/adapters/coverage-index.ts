import type { CoverageAdapter } from "./coverage-types.js";
import { istanbulCoverageAdapter } from "./istanbul-coverage.js";
import { v8CoverageAdapter } from "./v8-coverage.js";
import { playwrightCoverageAdapter } from "./playwright-coverage.js";

export type { CoverageAdapter, CoverageEdge } from "./coverage-types.js";

export function createCoverageAdapter(type: string): CoverageAdapter {
  switch (type) {
    case "istanbul":
      return istanbulCoverageAdapter;
    case "v8":
      return v8CoverageAdapter;
    case "playwright":
      return playwrightCoverageAdapter;
    default:
      throw new Error(
        `Unknown coverage adapter type: ${type}. Supported: istanbul, v8, playwright`,
      );
  }
}
