import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { NpmWorkspaceAdapter } from "../../../src/cli/graph/adapters/npm.js";

describe("NpmWorkspaceAdapter", () => {
  let tempDir: string;
  const adapter = new NpmWorkspaceAdapter();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "npm-adapter-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detect", () => {
    it("returns true for pnpm-workspace.yaml project", () => {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "root" }));
      writeFileSync(
        join(tempDir, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
      );
      expect(adapter.detect(tempDir)).toBe(true);
    });

    it("returns true for package.json with workspaces field", () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
      );
      expect(adapter.detect(tempDir)).toBe(true);
    });

    it("returns false for non-workspace project", () => {
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "simple" }),
      );
      expect(adapter.detect(tempDir)).toBe(false);
    });

    it("returns false for missing package.json", () => {
      expect(adapter.detect(tempDir)).toBe(false);
    });
  });

  describe("buildGraph", () => {
    it("finds all packages with correct dependencies", () => {
      // Setup monorepo
      writeFileSync(
        join(tempDir, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
      );
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "root" }));

      // Package A (no deps)
      mkdirSync(join(tempDir, "packages", "a"), { recursive: true });
      writeFileSync(
        join(tempDir, "packages", "a", "package.json"),
        JSON.stringify({ name: "@test/a", version: "1.0.0" }),
      );

      // Package B depends on A
      mkdirSync(join(tempDir, "packages", "b"), { recursive: true });
      writeFileSync(
        join(tempDir, "packages", "b", "package.json"),
        JSON.stringify({
          name: "@test/b",
          version: "1.0.0",
          dependencies: { "@test/a": "workspace:*" },
        }),
      );

      const graph = adapter.buildGraph(tempDir);

      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has("@test/a")).toBe(true);
      expect(graph.nodes.has("@test/b")).toBe(true);

      const nodeA = graph.nodes.get("@test/a")!;
      expect(nodeA.path).toBe("packages/a");
      expect(nodeA.dependencies).toEqual([]);

      const nodeB = graph.nodes.get("@test/b")!;
      expect(nodeB.path).toBe("packages/b");
      expect(nodeB.dependencies).toEqual(["@test/a"]);
    });

    it("sets correct source and test patterns", () => {
      writeFileSync(
        join(tempDir, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n",
      );
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "root" }));

      mkdirSync(join(tempDir, "packages", "lib"), { recursive: true });
      writeFileSync(
        join(tempDir, "packages", "lib", "package.json"),
        JSON.stringify({ name: "my-lib" }),
      );

      const graph = adapter.buildGraph(tempDir);
      const node = graph.nodes.get("my-lib")!;

      expect(node.sourcePatterns).toEqual(["packages/lib/src/**"]);
      expect(node.testPatterns).toEqual([
        "packages/lib/tests/**/*.test.ts",
        "packages/lib/tests/**/*.spec.ts",
      ]);
    });
  });
});
