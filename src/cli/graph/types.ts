/**
 * A node in the dependency graph.
 * Each node represents a "unit" -- a package, crate, module, or workflow job.
 */
export interface GraphNode {
  id: string;
  path: string;
  dependencies: string[];
  sourcePatterns: string[];
  testPatterns: string[];
}

/**
 * The full dependency graph for a project.
 */
export interface DependencyGraph {
  nodes: Map<string, GraphNode>;
  rootDir: string;
}

/**
 * Adapter that builds a DependencyGraph from ecosystem-specific manifests.
 */
export interface GraphAdapter {
  name: string;
  detect(rootDir: string): boolean;
  buildGraph(rootDir: string): DependencyGraph;
}
