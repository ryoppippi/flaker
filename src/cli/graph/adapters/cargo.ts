import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as TOML from "smol-toml";
import type { GraphAdapter, DependencyGraph, GraphNode } from "../types.js";

export class CargoAdapter implements GraphAdapter {
  name = "cargo";

  detect(rootDir: string): boolean {
    const cargoPath = join(rootDir, "Cargo.toml");
    if (!existsSync(cargoPath)) return false;
    try {
      const content = readFileSync(cargoPath, "utf-8");
      const parsed = TOML.parse(content);
      return parsed.workspace !== undefined;
    } catch {
      return false;
    }
  }

  buildGraph(rootDir: string): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const cargoPath = join(rootDir, "Cargo.toml");
    const content = readFileSync(cargoPath, "utf-8");
    const rootToml = TOML.parse(content);

    // Get workspace members patterns
    const workspace = rootToml.workspace as
      | { members?: string[] }
      | undefined;
    const memberPatterns = workspace?.members ?? [];

    // Resolve member patterns to crate directories
    const crates = new Map<string, string>(); // crate name -> relative dir
    for (const pattern of memberPatterns) {
      const dirs = this.resolvePattern(rootDir, pattern);
      for (const dir of dirs) {
        const crateName = this.readCrateName(join(rootDir, dir));
        if (crateName) {
          crates.set(crateName, dir);
        }
      }
    }

    // Build nodes with resolved dependencies
    for (const [name, relDir] of crates) {
      const crateTomlPath = join(rootDir, relDir, "Cargo.toml");
      const crateContent = readFileSync(crateTomlPath, "utf-8");
      const crateToml = TOML.parse(crateContent);

      const dependencies = this.extractWorkspaceDeps(crateToml, crates);

      nodes.set(name, {
        id: name,
        path: relDir,
        dependencies,
        sourcePatterns: [`${relDir}/src/**/*.rs`],
        testPatterns: [
          `${relDir}/tests/**/*.rs`,
          `${relDir}/src/**/*test*.rs`,
        ],
      });
    }

    return { nodes, rootDir };
  }

  private resolvePattern(rootDir: string, pattern: string): string[] {
    // Handle glob patterns like "crates/*"
    if (pattern.includes("*")) {
      const base = pattern.replace(/\/?\*.*$/, "");
      const baseDir = join(rootDir, base);
      if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) return [];

      return readdirSync(baseDir)
        .filter((entry) => {
          const full = join(baseDir, entry);
          return (
            statSync(full).isDirectory() &&
            existsSync(join(full, "Cargo.toml"))
          );
        })
        .map((entry) => (base ? `${base}/${entry}` : entry));
    }

    // Direct path
    if (existsSync(join(rootDir, pattern, "Cargo.toml"))) {
      return [pattern];
    }
    return [];
  }

  private readCrateName(crateDir: string): string | null {
    const tomlPath = join(crateDir, "Cargo.toml");
    if (!existsSync(tomlPath)) return null;
    try {
      const content = readFileSync(tomlPath, "utf-8");
      const parsed = TOML.parse(content);
      const pkg = parsed.package as { name?: string } | undefined;
      return pkg?.name ?? null;
    } catch {
      return null;
    }
  }

  private extractWorkspaceDeps(
    crateToml: Record<string, unknown>,
    knownCrates: Map<string, string>,
  ): string[] {
    const deps: string[] = [];
    const depsSection = crateToml.dependencies as
      | Record<string, unknown>
      | undefined;
    if (!depsSection) return deps;

    for (const [name, value] of Object.entries(depsSection)) {
      if (knownCrates.has(name)) {
        // Check if it's a path dependency or workspace dependency
        if (typeof value === "string") {
          // Version string only - still a workspace crate if name matches
          deps.push(name);
        } else if (typeof value === "object" && value !== null) {
          const obj = value as Record<string, unknown>;
          if (obj.path || obj.workspace) {
            deps.push(name);
          }
        }
      }
    }
    return deps;
  }
}
