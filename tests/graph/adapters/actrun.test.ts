import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ActrunWorkflowAdapter } from "../../../src/cli/graph/adapters/actrun.js";

describe("ActrunWorkflowAdapter", () => {
  let tempDir: string;
  const adapter = new ActrunWorkflowAdapter();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "actrun-adapter-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detect", () => {
    it("returns true for project with workflow files", () => {
      mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(tempDir, ".github", "workflows", "ci.yml"),
        "name: CI\n",
      );
      expect(adapter.detect(tempDir)).toBe(true);
    });

    it("returns false without workflows directory", () => {
      expect(adapter.detect(tempDir)).toBe(false);
    });
  });

  describe("buildGraph", () => {
    it("parses jobs and needs dependencies", () => {
      mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(tempDir, ".github", "workflows", "ci.yml"),
        [
          "name: CI",
          "on: push",
          "jobs:",
          "  build:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: echo build",
          "  test:",
          "    needs: build",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: echo test",
          "  deploy:",
          "    needs: [build, test]",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: echo deploy",
        ].join("\n"),
      );

      const graph = adapter.buildGraph(tempDir);

      expect(graph.nodes.size).toBe(3);
      expect(graph.nodes.has("ci.yml:build")).toBe(true);
      expect(graph.nodes.has("ci.yml:test")).toBe(true);
      expect(graph.nodes.has("ci.yml:deploy")).toBe(true);

      const build = graph.nodes.get("ci.yml:build")!;
      expect(build.dependencies).toEqual([]);

      const test = graph.nodes.get("ci.yml:test")!;
      expect(test.dependencies).toEqual(["ci.yml:build"]);

      const deploy = graph.nodes.get("ci.yml:deploy")!;
      expect(deploy.dependencies.sort()).toEqual([
        "ci.yml:build",
        "ci.yml:test",
      ]);
    });

    it("extracts path filters as sourcePatterns", () => {
      mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(tempDir, ".github", "workflows", "ci.yml"),
        [
          "name: CI",
          "on:",
          "  push:",
          "    paths:",
          "      - src/**",
          "      - tests/**",
          "jobs:",
          "  test:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: npm test",
        ].join("\n"),
      );

      const graph = adapter.buildGraph(tempDir);
      const node = graph.nodes.get("ci.yml:test")!;
      expect(node.sourcePatterns).toEqual(["src/**", "tests/**"]);
    });
  });
});
