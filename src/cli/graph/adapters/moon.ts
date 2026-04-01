import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { GraphAdapter, DependencyGraph, GraphNode } from "../types.js";

export class MoonAdapter implements GraphAdapter {
  name = "moon";

  detect(rootDir: string): boolean {
    return existsSync(join(rootDir, "moon.mod.json"));
  }

  buildGraph(rootDir: string): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const projectName = this.readProjectName(rootDir);

    // Discover all packages
    const packages = new Map<
      string,
      { imports: string[]; sourceFiles: string[]; testFiles: string[] }
    >();
    this.walkForPackages(rootDir, rootDir, packages);

    // Build nodes with resolved dependencies
    for (const [relPath, pkg] of packages) {
      const dependencies: string[] = [];
      for (const imp of pkg.imports) {
        const resolved = this.resolveImportToPath(
          imp,
          projectName,
          packages,
        );
        if (resolved !== null) {
          dependencies.push(resolved);
        }
      }

      nodes.set(relPath, {
        id: relPath,
        path: relPath,
        dependencies,
        sourcePatterns: pkg.sourceFiles.length > 0
          ? [`${relPath}/*.mbt`]
          : [],
        testPatterns: pkg.testFiles.length > 0
          ? [`${relPath}/*_test.mbt`]
          : [],
      });
    }

    return { nodes, rootDir };
  }

  private readProjectName(rootDir: string): string {
    const modPath = join(rootDir, "moon.mod.json");
    if (existsSync(modPath)) {
      try {
        const mod = JSON.parse(readFileSync(modPath, "utf-8"));
        return mod.name ?? "";
      } catch {
        return "";
      }
    }
    return "";
  }

  private walkForPackages(
    dir: string,
    rootDir: string,
    packages: Map<
      string,
      { imports: string[]; sourceFiles: string[]; testFiles: string[] }
    >,
  ): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const hasPkg =
      entries.includes("moon.pkg") || entries.includes("moon.pkg.json");
    if (hasPkg) {
      const relPath = relative(rootDir, dir) || ".";
      const pkgConfig = this.readMoonPkg(dir);
      const imports = this.extractImports(pkgConfig);
      const mbtFiles = entries.filter((e) => e.endsWith(".mbt"));
      const testFiles = mbtFiles
        .filter((f) => f.endsWith("_test.mbt"))
        .map((f) => (relPath === "." ? f : join(relPath, f)));
      const sourceFiles = mbtFiles
        .filter((f) => !f.endsWith("_test.mbt"))
        .map((f) => (relPath === "." ? f : join(relPath, f)));

      packages.set(relPath, { imports, sourceFiles, testFiles });
    }

    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === ".git" ||
        entry === "_build" ||
        entry === "target" ||
        entry === ".mooncakes" ||
        entry === ".jj"
      )
        continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          this.walkForPackages(full, rootDir, packages);
        }
      } catch {
        // skip inaccessible
      }
    }
  }

  private readMoonPkg(dir: string): any {
    for (const name of ["moon.pkg", "moon.pkg.json"]) {
      const p = join(dir, name);
      if (existsSync(p)) {
        try {
          return JSON.parse(readFileSync(p, "utf-8"));
        } catch {
          // not valid JSON
        }
      }
    }
    return {};
  }

  private extractImports(config: any): string[] {
    if (!config.import) return [];
    if (Array.isArray(config.import)) {
      return config.import
        .map((imp: any) => {
          if (typeof imp === "string") return imp;
          if (typeof imp === "object" && imp.path) return imp.path;
          return null;
        })
        .filter(Boolean);
    }
    return [];
  }

  private resolveImportToPath(
    imp: string,
    projectName: string,
    packages: Map<string, unknown>,
  ): string | null {
    if (projectName && imp.startsWith(projectName + "/")) {
      const localPath = imp.slice(projectName.length + 1);
      if (packages.has(localPath)) return localPath;
    }
    if (packages.has(imp)) return imp;
    for (const knownPath of packages.keys()) {
      if (imp.endsWith("/" + knownPath) || imp === knownPath) {
        return knownPath;
      }
    }
    return null;
  }
}
