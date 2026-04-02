import { readFileSync } from "node:fs";
import { loadCore } from "../core/loader.js";
import {
  buildAffectedReportFromInputs,
} from "./affected-report.js";
import {
  buildBitflowDependents,
  matchBitflowTaskPaths,
  parseBitflowWorkflowTasks,
} from "./bitflow-workflow.js";
import type {
  AffectedReport,
  AffectedTarget,
  DependencyResolver,
} from "./types.js";

export class BitflowNativeResolver implements DependencyResolver {
  private workflowText: string;

  constructor(configPath: string) {
    this.workflowText = readFileSync(configPath, "utf-8");
  }

  async resolve(changedFiles: string[], allTestFiles: string[]): Promise<string[]> {
    const core = await loadCore();
    const affectedTargets = core.resolveAffected(this.workflowText, changedFiles);
    const testSet = new Set(allTestFiles);
    return affectedTargets.filter((target) => testSet.has(target));
  }

  async explain(changedFiles: string[], targets: AffectedTarget[]): Promise<AffectedReport> {
    const tasks = parseBitflowWorkflowTasks(this.workflowText);
    const directMatches = new Map<
      string,
      { matchedPaths: string[]; matchReasons: string[] }
    >();
    const unmatched = new Set(changedFiles);

    for (const task of tasks) {
      const result = matchBitflowTaskPaths(task, changedFiles);
      if (result.matchedPaths.length === 0) continue;

      directMatches.set(task.id, result);
      for (const matchedPath of result.matchedPaths) {
        unmatched.delete(matchedPath);
      }
    }

    const dependents = buildBitflowDependents(tasks);
    const includedBy = new Map<string, Set<string>>();
    const affected = new Set(directMatches.keys());
    const queue = [...directMatches.keys()];

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      for (const dependent of dependents.get(current) ?? []) {
        let parents = includedBy.get(dependent);
        if (!parents) {
          parents = new Set<string>();
          includedBy.set(dependent, parents);
        }
        parents.add(current);

        if (!affected.has(dependent)) {
          affected.add(dependent);
          queue.push(dependent);
        }
      }
    }

    const targetsByTaskId = new Map<string, AffectedTarget[]>();
    for (const target of targets) {
      const existing = targetsByTaskId.get(target.taskId);
      if (existing) {
        existing.push(target);
      } else {
        targetsByTaskId.set(target.taskId, [target]);
      }
    }

    const directSelections = [...directMatches.keys()].flatMap((taskId) => {
      const matchedTargets = targetsByTaskId.get(taskId) ?? [];
      const directMatch = directMatches.get(taskId);

      return matchedTargets.map((target) =>
        ({
          target,
          matchedPaths: directMatch?.matchedPaths ?? [],
          matchReasons: directMatch?.matchReasons ?? [],
        }),
      );
    });

    return buildAffectedReportFromInputs({
      resolver: "bitflow",
      changedFiles,
      targets,
      directSelections,
      transitiveTasks: [...includedBy.entries()].map(([taskId, parents]) => ({
        taskId,
        includedBy: [...parents].sort(),
        matchReasons: [...parents].sort().map((parent) => `dependency:${parent}`),
      })),
      unmatched: [...unmatched],
    });
  }
}
