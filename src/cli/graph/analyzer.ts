import type { DependencyGraph, GraphNode } from "./types.js";

/**
 * Given changed files, find all affected node IDs.
 * A node is affected if any changed file matches its path prefix.
 * Then expand transitively: if A depends on B and B is affected, A is also affected.
 */
export function findAffectedNodes(
  graph: DependencyGraph,
  changedFiles: string[],
): string[] {
  const directlyAffected = new Set<string>();
  for (const file of changedFiles) {
    for (const [id, node] of graph.nodes) {
      if (fileMatchesNode(file, node)) {
        directlyAffected.add(id);
      }
    }
  }
  return expandTransitive(graph, directlyAffected);
}

/**
 * Expand a set of node IDs to include all transitive dependents.
 * If B depends on A and A is in the initial set, B is added.
 */
export function expandTransitive(
  graph: DependencyGraph,
  initial: Set<string>,
): string[] {
  const affected = new Set(initial);
  const reverseDeps = buildReverseDeps(graph);

  const queue = [...initial];
  while (queue.length > 0) {
    const nodeId = queue.pop()!;
    for (const dependent of reverseDeps.get(nodeId) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...affected];
}

/**
 * Build reverse dependency map: for each node, who depends on it?
 */
export function buildReverseDeps(
  graph: DependencyGraph,
): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const [_id, node] of graph.nodes) {
    for (const dep of node.dependencies) {
      if (!reverse.has(dep)) reverse.set(dep, []);
      reverse.get(dep)!.push(node.id);
    }
  }
  return reverse;
}

/**
 * Topological sort of graph nodes (dependencies before dependents).
 */
export function topologicalSort(graph: DependencyGraph): string[] {
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (node) {
      for (const dep of node.dependencies) {
        visit(dep);
      }
    }
    result.push(id);
  }

  for (const id of graph.nodes.keys()) {
    visit(id);
  }
  return result;
}

/**
 * Get all test file patterns from affected nodes.
 */
export function getAffectedTestPatterns(
  graph: DependencyGraph,
  affectedIds: string[],
): string[] {
  const patterns: string[] = [];
  for (const id of affectedIds) {
    const node = graph.nodes.get(id);
    if (node) {
      patterns.push(...node.testPatterns);
    }
  }
  return patterns;
}

/** Check if a file path belongs to a node (matches its path prefix) */
function fileMatchesNode(file: string, node: GraphNode): boolean {
  return file.startsWith(node.path + "/") || file === node.path;
}
