import type { DependencyResolver } from "./types.js";
import type { GraphAdapter } from "../graph/types.js";
import { loadCore } from "../core/loader.js";

export class GraphResolver implements DependencyResolver {
  private adapter: GraphAdapter;
  private rootDir: string;

  constructor(adapter: GraphAdapter, rootDir: string) {
    this.adapter = adapter;
    this.rootDir = rootDir;
  }

  async resolve(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const graph = this.adapter.buildGraph(this.rootDir);
    const core = await loadCore();
    const affectedIds = core.findAffectedNodes(graph, changedFiles);
    const testPatterns = core.getAffectedTestPatterns(graph, affectedIds);

    // Match test patterns against allTestFiles using prefix matching
    const testSet = new Set(allTestFiles);
    const result: string[] = [];
    const added = new Set<string>();

    for (const pattern of testPatterns) {
      // Convert glob pattern to a prefix by stripping glob suffixes
      const prefix = pattern
        .replace(/\/\*\*\/.*$/, "")
        .replace(/\/\*.*$/, "");
      for (const t of allTestFiles) {
        if (t.startsWith(prefix) && testSet.has(t) && !added.has(t)) {
          result.push(t);
          added.add(t);
        }
      }
    }
    return result;
  }
}
