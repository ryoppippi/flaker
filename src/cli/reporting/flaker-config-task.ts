import path from "node:path";
import type { FlakerConfig, FlakerTask, FlakerTaskSummary } from "./flaker-config-contract.js";

export interface ResolvedFlakerTask extends FlakerTaskSummary {
  srcs: string[];
}

export function isPlaywrightSpecPath(value: string): boolean {
  return /\.(spec|test)\.[cm]?[jt]sx?$/.test(value);
}

function normalizeRepoPath(root: string, target: string): string {
  const normalizedTarget = target.replaceAll("\\", "/");
  return path.relative(root, path.resolve(root, normalizedTarget)).split(path.sep).join("/");
}

function findOptionValue(command: string[], optionName: string): string | undefined {
  const index = command.findIndex((part) => part === optionName);
  if (index < 0) {
    return undefined;
  }
  return command[index + 1];
}

function extractSpecs(command: string[]): string[] {
  return command.filter((part) => isPlaywrightSpecPath(part));
}

export function isFilteredTask(task: FlakerTaskSummary): boolean {
  return Boolean(task.grep || task.grepInvert);
}

export function resolveTaskSummary(task: FlakerTask, cwd: string): ResolvedFlakerTask {
  return {
    id: task.id,
    node: task.node,
    specs: extractSpecs(task.cmd).map((spec) => normalizeRepoPath(cwd, spec)).sort(),
    grep: findOptionValue(task.cmd, "--grep"),
    grepInvert: findOptionValue(task.cmd, "--grep-invert"),
    trigger: task.trigger,
    needs: [...task.needs].sort(),
    srcCount: task.srcs.length,
    command: [...task.cmd],
    srcs: [...task.srcs],
  };
}

export function resolveTaskSummaries(config: FlakerConfig, cwd: string): ResolvedFlakerTask[] {
  return config.tasks.map((task) => resolveTaskSummary(task, cwd));
}
