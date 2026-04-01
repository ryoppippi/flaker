import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { GraphAdapter, DependencyGraph, GraphNode } from "../types.js";

export class NpmWorkspaceAdapter implements GraphAdapter {
  name = "npm";

  detect(rootDir: string): boolean {
    const pnpmWorkspace = join(rootDir, "pnpm-workspace.yaml");
    if (existsSync(pnpmWorkspace)) return true;

    const pkgPath = join(rootDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return Boolean(pkg.workspaces);
      } catch {
        return false;
      }
    }
    return false;
  }

  buildGraph(rootDir: string): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const patterns = this.getWorkspacePatterns(rootDir);

    // First pass: discover all packages
    const packageDirs = new Map<string, string>(); // name -> relative dir
    for (const pattern of patterns) {
      const base = pattern.replace(/\/?\*.*$/, "");
      const baseDir = join(rootDir, base);
      if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) continue;

      for (const entry of readdirSync(baseDir)) {
        const pkgDir = join(baseDir, entry);
        const pkgJsonPath = join(pkgDir, "package.json");
        if (!existsSync(pkgJsonPath)) continue;

        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
          if (!pkg.name) continue;
          const relDir = relative(rootDir, pkgDir);
          packageDirs.set(pkg.name, relDir);
        } catch {
          // skip invalid package.json
        }
      }
    }

    // Second pass: build nodes with resolved dependencies
    for (const [name, relDir] of packageDirs) {
      const pkgJsonPath = join(rootDir, relDir, "package.json");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const allDeps: Record<string, string> = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      const dependencies: string[] = [];
      for (const [depName, version] of Object.entries(allDeps)) {
        if (
          (typeof version === "string" && version.startsWith("workspace:")) ||
          packageDirs.has(depName)
        ) {
          dependencies.push(depName);
        }
      }

      nodes.set(name, {
        id: name,
        path: relDir,
        dependencies,
        sourcePatterns: [`${relDir}/src/**`],
        testPatterns: [
          `${relDir}/tests/**/*.test.ts`,
          `${relDir}/tests/**/*.spec.ts`,
        ],
      });
    }

    return { nodes, rootDir };
  }

  private getWorkspacePatterns(rootDir: string): string[] {
    const pnpmWorkspacePath = join(rootDir, "pnpm-workspace.yaml");
    if (existsSync(pnpmWorkspacePath)) {
      const content = readFileSync(pnpmWorkspacePath, "utf-8");
      const match = content.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
      if (match) {
        return match[1]
          .split("\n")
          .map((l) => l.trim().replace(/^-\s+/, "").replace(/['"]/g, ""))
          .filter(Boolean);
      }
    }

    const pkgPath = join(rootDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (Array.isArray(pkg.workspaces)) return pkg.workspaces;
        if (pkg.workspaces?.packages) return pkg.workspaces.packages;
      } catch {
        // ignore
      }
    }

    return [];
  }
}
