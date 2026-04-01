import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { CargoAdapter } from "../../../src/cli/graph/adapters/cargo.js";

describe("CargoAdapter", () => {
  let tempDir: string;
  const adapter = new CargoAdapter();

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cargo-adapter-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("detect", () => {
    it("returns true for Cargo.toml with [workspace]", () => {
      writeFileSync(
        join(tempDir, "Cargo.toml"),
        `[workspace]\nmembers = ["crates/*"]\n`,
      );
      expect(adapter.detect(tempDir)).toBe(true);
    });

    it("returns false for Cargo.toml without [workspace]", () => {
      writeFileSync(
        join(tempDir, "Cargo.toml"),
        `[package]\nname = "single-crate"\nversion = "0.1.0"\n`,
      );
      expect(adapter.detect(tempDir)).toBe(false);
    });

    it("returns false without Cargo.toml", () => {
      expect(adapter.detect(tempDir)).toBe(false);
    });
  });

  describe("buildGraph", () => {
    it("finds crates with correct dependencies", () => {
      // Root workspace
      writeFileSync(
        join(tempDir, "Cargo.toml"),
        `[workspace]\nmembers = ["crates/*"]\n`,
      );

      // Crate: core (no deps)
      mkdirSync(join(tempDir, "crates", "core", "src"), { recursive: true });
      writeFileSync(
        join(tempDir, "crates", "core", "Cargo.toml"),
        `[package]\nname = "my-core"\nversion = "0.1.0"\n`,
      );
      writeFileSync(
        join(tempDir, "crates", "core", "src", "lib.rs"),
        "// core",
      );

      // Crate: app (depends on core)
      mkdirSync(join(tempDir, "crates", "app", "src"), { recursive: true });
      writeFileSync(
        join(tempDir, "crates", "app", "Cargo.toml"),
        [
          `[package]`,
          `name = "my-app"`,
          `version = "0.1.0"`,
          ``,
          `[dependencies]`,
          `my-core = { path = "../core" }`,
        ].join("\n") + "\n",
      );
      writeFileSync(
        join(tempDir, "crates", "app", "src", "main.rs"),
        "// app",
      );

      const graph = adapter.buildGraph(tempDir);

      expect(graph.nodes.size).toBe(2);
      expect(graph.nodes.has("my-core")).toBe(true);
      expect(graph.nodes.has("my-app")).toBe(true);

      const coreNode = graph.nodes.get("my-core")!;
      expect(coreNode.path).toBe("crates/core");
      expect(coreNode.dependencies).toEqual([]);
      expect(coreNode.sourcePatterns).toEqual(["crates/core/src/**/*.rs"]);

      const appNode = graph.nodes.get("my-app")!;
      expect(appNode.path).toBe("crates/app");
      expect(appNode.dependencies).toEqual(["my-core"]);
      expect(appNode.testPatterns).toEqual([
        "crates/app/tests/**/*.rs",
        "crates/app/src/**/*test*.rs",
      ]);
    });
  });
});
