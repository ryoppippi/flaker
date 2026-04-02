import { MOONBIT_JS_BRIDGE_URL } from "../core/build-artifact.js";
import type {
  AffectedReport,
  AffectedSelection,
  AffectedTarget,
} from "./types.js";

export interface AffectedDirectSelectionInput {
  target: AffectedTarget;
  matchedPaths?: string[];
  matchReasons?: string[];
}

export interface AffectedTransitiveTaskInput {
  taskId: string;
  includedBy?: string[];
  matchReasons?: string[];
}

interface CoreAffectedTargetInput {
  spec: string;
  task_id: string;
  filter?: string;
}

interface CoreAffectedDirectSelectionInput {
  spec: string;
  task_id: string;
  filter?: string;
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedTransitiveTaskInput {
  task_id: string;
  included_by: string[];
  match_reasons: string[];
}

interface CoreAffectedSelectionOutput {
  task_id: string;
  spec: string;
  filter?: string;
  direct: boolean;
  included_by: string[];
  matched_paths: string[];
  match_reasons: string[];
}

interface CoreAffectedReportSummaryOutput {
  matched_count: number;
  selected_count: number;
  unmatched_count: number;
}

interface CoreAffectedReportOutput {
  matched: CoreAffectedSelectionOutput[];
  selected: CoreAffectedSelectionOutput[];
  unmatched: string[];
  summary: CoreAffectedReportSummaryOutput;
}

interface AffectedExplainCoreExports {
  dedupe_affected_targets_json?: (targetsJson: string) => string;
  build_affected_report_json?: (
    targetsJson: string,
    directSelectionsJson: string,
    transitiveTasksJson: string,
    unmatchedJson: string,
  ) => string;
}

function compareNullable(a: string | null, b: string | null): number {
  return (a ?? "").localeCompare(b ?? "");
}

function affectedTargetKey(target: AffectedTarget): string {
  return JSON.stringify({
    spec: target.spec,
    taskId: target.taskId,
    filter: target.filter ?? null,
  });
}

export function sortAffectedSelections(
  entries: AffectedSelection[],
): AffectedSelection[] {
  return [...entries].sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}

export function createAffectedSelection(
  target: AffectedTarget,
  opts: {
    direct: boolean;
    includedBy?: string[];
    matchedPaths?: string[];
    matchReasons?: string[];
  },
): AffectedSelection {
  return {
    taskId: target.taskId,
    spec: target.spec,
    filter: target.filter,
    direct: opts.direct,
    includedBy: [...(opts.includedBy ?? [])].sort(),
    matchedPaths: [...(opts.matchedPaths ?? [])].sort(),
    matchReasons: [...(opts.matchReasons ?? [])],
  };
}

export function buildAffectedReport(
  resolver: string,
  changedFiles: string[],
  selected: AffectedSelection[],
  unmatched: string[],
): AffectedReport {
  const sortedSelected = sortAffectedSelections(selected);
  const matched = sortedSelected.filter((entry) => entry.direct);
  const sortedUnmatched = [...unmatched].sort();
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched,
    selected: sortedSelected,
    unmatched: sortedUnmatched,
    summary: {
      matchedCount: matched.length,
      selectedCount: sortedSelected.length,
      unmatchedCount: sortedUnmatched.length,
    },
  };
}

function dedupeAffectedTargetsFallback(
  targets: AffectedTarget[],
): AffectedTarget[] {
  const byKey = new Map<string, AffectedTarget>();
  for (const target of targets) {
    const key = affectedTargetKey(target);
    if (!byKey.has(key)) {
      byKey.set(key, {
        spec: target.spec,
        taskId: target.taskId,
        filter: target.filter ?? null,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const bySpec = a.spec.localeCompare(b.spec);
    if (bySpec !== 0) return bySpec;
    const byTaskId = a.taskId.localeCompare(b.taskId);
    if (byTaskId !== 0) return byTaskId;
    return compareNullable(a.filter, b.filter);
  });
}

function buildAffectedReportFromInputsFallback(opts: {
  resolver: string;
  changedFiles: string[];
  targets: AffectedTarget[];
  directSelections: AffectedDirectSelectionInput[];
  transitiveTasks?: AffectedTransitiveTaskInput[];
  unmatched: string[];
}): AffectedReport {
  const targets = dedupeAffectedTargetsFallback(opts.targets);
  const directSelections = opts.directSelections.map((entry) =>
    createAffectedSelection(entry.target, {
      direct: true,
      matchedPaths: entry.matchedPaths,
      matchReasons: entry.matchReasons,
    })
  );
  const directKeys = new Set(directSelections.map((entry) => affectedTargetKey(entry)));
  const transitiveByTask = new Map<string, AffectedTransitiveTaskInput>();
  for (const task of opts.transitiveTasks ?? []) {
    const existing = transitiveByTask.get(task.taskId);
    if (!existing) {
      transitiveByTask.set(task.taskId, {
        taskId: task.taskId,
        includedBy: [...(task.includedBy ?? [])],
        matchReasons: [...(task.matchReasons ?? [])],
      });
      continue;
    }
    for (const parent of task.includedBy ?? []) {
      if (!(existing.includedBy ?? []).includes(parent)) {
        existing.includedBy ??= [];
        existing.includedBy.push(parent);
      }
    }
    for (const reason of task.matchReasons ?? []) {
      if (!(existing.matchReasons ?? []).includes(reason)) {
        existing.matchReasons ??= [];
        existing.matchReasons.push(reason);
      }
    }
  }

  const transitiveSelections = targets.flatMap((target) => {
    if (directKeys.has(affectedTargetKey(target))) {
      return [];
    }
    const task = transitiveByTask.get(target.taskId);
    if (!task) {
      return [];
    }
    return [
      createAffectedSelection(target, {
        direct: false,
        includedBy: task.includedBy,
        matchReasons: task.matchReasons,
      }),
    ];
  });

  return buildAffectedReport(
    opts.resolver,
    opts.changedFiles,
    [...directSelections, ...transitiveSelections],
    opts.unmatched,
  );
}

function toCoreTarget(target: AffectedTarget): CoreAffectedTargetInput {
  const base: CoreAffectedTargetInput = {
    spec: target.spec,
    task_id: target.taskId,
  };
  if (target.filter != null) {
    base.filter = target.filter;
  }
  return base;
}

function toCoreDirectSelection(
  input: AffectedDirectSelectionInput,
): CoreAffectedDirectSelectionInput {
  const base: CoreAffectedDirectSelectionInput = {
    spec: input.target.spec,
    task_id: input.target.taskId,
    matched_paths: [...(input.matchedPaths ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
  if (input.target.filter != null) {
    base.filter = input.target.filter;
  }
  return base;
}

function toCoreTransitiveTask(
  input: AffectedTransitiveTaskInput,
): CoreAffectedTransitiveTaskInput {
  return {
    task_id: input.taskId,
    included_by: [...(input.includedBy ?? [])],
    match_reasons: [...(input.matchReasons ?? [])],
  };
}

function fromCoreSelection(
  selection: CoreAffectedSelectionOutput,
): AffectedSelection {
  return {
    taskId: selection.task_id,
    spec: selection.spec,
    filter: selection.filter ?? null,
    direct: selection.direct,
    includedBy: [...selection.included_by],
    matchedPaths: [...selection.matched_paths],
    matchReasons: [...selection.match_reasons],
  };
}

function fromCoreReport(
  resolver: string,
  changedFiles: string[],
  report: CoreAffectedReportOutput,
): AffectedReport {
  return {
    resolver,
    changedFiles: [...changedFiles],
    matched: report.matched.map(fromCoreSelection),
    selected: report.selected.map(fromCoreSelection),
    unmatched: [...report.unmatched],
    summary: {
      matchedCount: report.summary.matched_count,
      selectedCount: report.summary.selected_count,
      unmatchedCount: report.summary.unmatched_count,
    },
  };
}

let affectedExplainCorePromise:
  | Promise<AffectedExplainCoreExports | null>
  | undefined;

async function loadAffectedExplainCore(): Promise<AffectedExplainCoreExports | null> {
  if (!affectedExplainCorePromise) {
    affectedExplainCorePromise = (async () => {
      try {
        const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as AffectedExplainCoreExports;
        if (
          typeof mod.dedupe_affected_targets_json === "function" &&
          typeof mod.build_affected_report_json === "function"
        ) {
          return mod;
        }
      } catch {
        // Fall back to TypeScript implementation when MoonBit build is unavailable.
      }
      return null;
    })();
  }
  return affectedExplainCorePromise;
}

export async function dedupeAffectedTargets(
  targets: AffectedTarget[],
): Promise<AffectedTarget[]> {
  const core = await loadAffectedExplainCore();
  if (core?.dedupe_affected_targets_json) {
    return JSON.parse(
      core.dedupe_affected_targets_json(
        JSON.stringify(targets.map(toCoreTarget)),
      ),
    ).map((target: CoreAffectedTargetInput) => ({
      spec: target.spec,
      taskId: target.task_id,
      filter: target.filter ?? null,
    }));
  }
  return dedupeAffectedTargetsFallback(targets);
}

export async function buildAffectedReportFromInputs(opts: {
  resolver: string;
  changedFiles: string[];
  targets: AffectedTarget[];
  directSelections: AffectedDirectSelectionInput[];
  transitiveTasks?: AffectedTransitiveTaskInput[];
  unmatched: string[];
}): Promise<AffectedReport> {
  const core = await loadAffectedExplainCore();
  if (core?.build_affected_report_json) {
    const report = JSON.parse(
      core.build_affected_report_json(
        JSON.stringify(opts.targets.map(toCoreTarget)),
        JSON.stringify(opts.directSelections.map(toCoreDirectSelection)),
        JSON.stringify((opts.transitiveTasks ?? []).map(toCoreTransitiveTask)),
        JSON.stringify(opts.unmatched),
      ),
    ) as CoreAffectedReportOutput;
    return fromCoreReport(opts.resolver, opts.changedFiles, report);
  }

  return buildAffectedReportFromInputsFallback(opts);
}
