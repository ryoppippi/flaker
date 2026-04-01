import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { GraphAdapter, DependencyGraph, GraphNode } from "../types.js";

export class ActrunWorkflowAdapter implements GraphAdapter {
  name = "actrun";

  detect(rootDir: string): boolean {
    const workflowDir = join(rootDir, ".github", "workflows");
    if (!existsSync(workflowDir)) return false;
    try {
      const files = readdirSync(workflowDir);
      return files.some((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    } catch {
      return false;
    }
  }

  buildGraph(rootDir: string): DependencyGraph {
    const nodes = new Map<string, GraphNode>();
    const workflowDir = join(rootDir, ".github", "workflows");
    if (!existsSync(workflowDir)) return { nodes, rootDir };

    const files = readdirSync(workflowDir).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml"),
    );

    for (const file of files) {
      const filePath = join(workflowDir, file);
      const content = readFileSync(filePath, "utf-8");
      const relPath = `.github/workflows/${file}`;
      const jobs = this.parseJobs(content);

      for (const job of jobs) {
        const nodeId = `${file}:${job.name}`;
        const dependencies = job.needs.map((n) => `${file}:${n}`);

        nodes.set(nodeId, {
          id: nodeId,
          path: relPath,
          dependencies,
          sourcePatterns: this.extractPathFilters(content),
          testPatterns: [],
        });
      }
    }

    return { nodes, rootDir };
  }

  private parseJobs(
    content: string,
  ): Array<{ name: string; needs: string[] }> {
    const jobs: Array<{ name: string; needs: string[] }> = [];
    const lines = content.split("\n");
    let inJobs = false;
    let currentJob: string | null = null;
    let currentNeeds: string[] = [];
    let inNeedsList = false;

    for (const line of lines) {
      const trimmed = line.trimEnd();

      // Detect "jobs:" section
      if (/^jobs:\s*$/.test(trimmed)) {
        inJobs = true;
        continue;
      }

      if (!inJobs) continue;

      // A top-level key under jobs (2-space indent)
      const jobMatch = trimmed.match(/^  (\w[\w-]*):\s*$/);
      if (jobMatch) {
        // Save previous job
        if (currentJob !== null) {
          jobs.push({ name: currentJob, needs: currentNeeds });
        }
        currentJob = jobMatch[1];
        currentNeeds = [];
        inNeedsList = false;
        continue;
      }

      if (currentJob === null) continue;

      // "needs:" as inline value
      const needsInline = trimmed.match(
        /^\s+needs:\s*\[([^\]]*)\]\s*$/,
      );
      if (needsInline) {
        currentNeeds = needsInline[1]
          .split(",")
          .map((s) => s.trim().replace(/['"]/g, ""))
          .filter(Boolean);
        inNeedsList = false;
        continue;
      }

      // "needs:" as single value
      const needsSingle = trimmed.match(/^\s+needs:\s+(\S+)\s*$/);
      if (needsSingle) {
        currentNeeds = [needsSingle[1].replace(/['"]/g, "")];
        inNeedsList = false;
        continue;
      }

      // "needs:" starting a list
      if (/^\s+needs:\s*$/.test(trimmed)) {
        inNeedsList = true;
        continue;
      }

      // List item under needs
      if (inNeedsList) {
        const listItem = trimmed.match(/^\s+-\s+(.+)$/);
        if (listItem) {
          currentNeeds.push(listItem[1].replace(/['"]/g, "").trim());
        } else {
          inNeedsList = false;
        }
      }
    }

    // Save last job
    if (currentJob !== null) {
      jobs.push({ name: currentJob, needs: currentNeeds });
    }

    return jobs;
  }

  private extractPathFilters(content: string): string[] {
    const paths: string[] = [];
    const lines = content.split("\n");
    let inPaths = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^paths:\s*$/.test(trimmed)) {
        inPaths = true;
        continue;
      }
      if (inPaths) {
        const match = trimmed.match(/^-\s+['"]?(.+?)['"]?\s*$/);
        if (match) {
          paths.push(match[1]);
        } else {
          inPaths = false;
        }
      }
    }
    return paths;
  }
}
