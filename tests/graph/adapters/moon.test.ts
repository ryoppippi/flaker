import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { MoonAdapter } from "../../../src/cli/graph/adapters/moon.js";

describe("MoonAdapter", () => {
  let tempDir: string;
  const adapter = new MoonAdapter();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "moon-adapter-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detect", () => {
    it("returns true for moon.mod.json project", () => {
      writeFileSync(
        join(tempDir, "moon.mod.json"),
        JSON.stringify({ name: "myproject" }),
      );
      expect(adapter.detect(tempDir)).toBe(true);
    });

    it("returns false without moon.mod.json", () => {
      expect(adapter.detect(tempDir)).toBe(false);
    });
  });

  describe("buildGraph", () => {
    it("finds all packages with correct imports", () => {
      // Setup MoonBit project
      writeFileSync(
        join(tempDir, "moon.mod.json"),
        JSON.stringify({ name: "myproject" }),
      );

      // lib/types package (no imports)
      mkdirSync(join(tempDir, "lib", "types"), { recursive: true });
      writeFileSync(
        join(tempDir, "lib", "types", "moon.pkg.json"),
        JSON.stringify({ import: [] }),
      );
      writeFileSync(join(tempDir, "lib", "types", "types.mbt"), "// types");

      // lib/core package (imports lib/types)
      mkdirSync(join(tempDir, "lib", "core"), { recursive: true });
      writeFileSync(
        join(tempDir, "lib", "core", "moon.pkg.json"),
        JSON.stringify({ import: ["myproject/lib/types"] }),
      );
      writeFileSync(join(tempDir, "lib", "core", "core.mbt"), "// core");
      writeFileSync(
        join(tempDir, "lib", "core", "core_test.mbt"),
        "// test",
      );

      const graph = adapter.buildGraph(tempDir);

      expect(graph.nodes.has("lib/types")).toBe(true);
      expect(graph.nodes.has("lib/core")).toBe(true);

      const typesNode = graph.nodes.get("lib/types")!;
      expect(typesNode.dependencies).toEqual([]);

      const coreNode = graph.nodes.get("lib/core")!;
      expect(coreNode.dependencies).toEqual(["lib/types"]);
      expect(coreNode.testPatterns).toEqual(["lib/core/*_test.mbt"]);
    });
  });
});
