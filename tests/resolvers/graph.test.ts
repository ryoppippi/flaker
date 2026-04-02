import { describe, it, expect } from "vitest";
import { GraphResolver } from "../../src/cli/resolvers/graph.js";
import type { DependencyGraph, GraphAdapter, GraphNode } from "../../src/cli/graph/types.js";

function makeNode(partial: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    id: partial.id,
    path: partial.path ?? partial.id,
    dependencies: partial.dependencies ?? [],
    sourcePatterns: partial.sourcePatterns ?? [],
    testPatterns: partial.testPatterns ?? [],
  };
}

function makeGraph(nodes: GraphNode[]): DependencyGraph {
  return {
    rootDir: "/tmp/repo",
    nodes: new Map(nodes.map((node) => [node.id, node])),
  };
}

class StaticGraphAdapter implements GraphAdapter {
  name = "static";

  constructor(private graph: DependencyGraph) {}

  detect(): boolean {
    return true;
  }

  buildGraph(): DependencyGraph {
    return this.graph;
  }
}

describe("GraphResolver", () => {
  it("resolves affected test files through core graph functions", async () => {
    const graph = makeGraph([
      makeNode({
        id: "core",
        path: "packages/core",
        testPatterns: ["packages/core/tests/**"],
      }),
      makeNode({
        id: "app",
        path: "packages/app",
        dependencies: ["core"],
        testPatterns: ["packages/app/tests/**"],
      }),
    ]);
    const resolver = new GraphResolver(new StaticGraphAdapter(graph), "/tmp/repo");

    const result = await resolver.resolve(
      ["packages/core/src/index.ts"],
      [
        "packages/core/tests/core.test.ts",
        "packages/app/tests/app.test.ts",
        "packages/other/tests/other.test.ts",
      ],
    );

    expect(result).toEqual([
      "packages/core/tests/core.test.ts",
      "packages/app/tests/app.test.ts",
    ]);
  });
});
