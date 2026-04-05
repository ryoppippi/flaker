import type { MetricStore } from "../storage/types.js";

export interface FlakerKpi {
  /** ISO timestamp of when this KPI was computed */
  timestamp: string;
  /** Analysis window in days */
  windowDays: number;
  sampling: {
    recall: number | null;
    sampleRatio: number | null;
    timeSavedMinutes: number | null;
    holdoutFNR: number | null;
    matchedCommits: number;
  };
  flaky: {
    brokenTests: number;
    intermittentFlaky: number;
    /** Percentage of tests with intermittent failures (excluding broken) */
    trueFlakyRate: number;
    /** Change in unique failing test count vs previous window */
    flakyTrend: number;
  };
  data: {
    commitCount: number;
    commitsWithChanges: number;
    /** Percentage of commits that have commit_changes data */
    coFailureCoverage: number;
    coFailureReady: boolean;
    confidence: "insufficient" | "low" | "moderate" | "high";
  };
}

export async function computeKpi(
  store: MetricStore,
  opts?: { windowDays?: number },
): Promise<FlakerKpi> {
  const window = opts?.windowDays ?? 30;

  // --- Sampling ---
  const [samplingRow] = await store.raw<{
    matched: number;
    sample_ratio: number | null;
    saved_minutes: number | null;
  }>(`
    WITH local_runs AS (
      SELECT DISTINCT sr.commit_sha, sr.selected_count, sr.candidate_count, sr.duration_ms
      FROM sampling_runs sr
      WHERE sr.command_kind = 'run'
        AND sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    )
    SELECT
      0::INTEGER AS matched,
      CASE WHEN (SELECT COUNT(*) FROM local_runs) > 0
        THEN ROUND(AVG(selected_count * 100.0 / NULLIF(candidate_count, 0)), 1)
        ELSE NULL END AS sample_ratio,
      CASE WHEN (SELECT COUNT(*) FROM local_runs) > 0
        THEN ROUND(SUM((candidate_count - selected_count) * COALESCE(duration_ms, 0) / NULLIF(candidate_count, 1)) / 60000.0, 1)
        ELSE NULL END AS saved_minutes
    FROM local_runs
  `);

  // Holdout FNR
  const [holdoutRow] = await store.raw<{ fnr: number | null }>(`
    SELECT CASE WHEN holdout_total > 0
      THEN ROUND(holdout_fails * 100.0 / holdout_total, 1) ELSE NULL END AS fnr
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE srt.is_holdout = TRUE)::INTEGER AS holdout_total,
        COUNT(*) FILTER (WHERE srt.is_holdout = TRUE AND tr.status IN ('failed', 'flaky'))::INTEGER AS holdout_fails
      FROM sampling_run_tests srt
      JOIN sampling_runs sr ON srt.sampling_run_id = sr.id
      LEFT JOIN test_results tr ON tr.suite = srt.suite AND tr.test_name = srt.test_name
        AND tr.commit_sha = sr.commit_sha
      WHERE sr.created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
    ) sub
  `);

  // --- Flaky (same classification as calibrate: >= 5 runs) ---
  const [flakyRow] = await store.raw<{
    broken: number;
    intermittent: number;
    total_classified: number;
  }>(`
    SELECT
      COUNT(DISTINCT CASE WHEN fail_rate >= 100 THEN key END)::INTEGER AS broken,
      COUNT(DISTINCT CASE WHEN fail_rate > 0 AND fail_rate < 100 THEN key END)::INTEGER AS intermittent,
      COUNT(DISTINCT key)::INTEGER AS total_classified
    FROM (
      SELECT
        suite || '::' || test_name AS key,
        ROUND(COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) * 100.0 / COUNT(*), 1) AS fail_rate
      FROM test_results
      WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
      GROUP BY suite, test_name
      HAVING COUNT(*) >= 5
    ) sub
  `);

  // Trend: unique failing tests this window vs previous window (same >= 5 threshold)
  const [trendRow] = await store.raw<{ current_count: number; previous_count: number }>(`
    SELECT
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM (
        SELECT suite, test_name, COUNT(*) AS runs,
          COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) AS fails
        FROM test_results
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        GROUP BY suite, test_name
        HAVING runs >= 5 AND fails > 0
      ) sub) AS current_count,
      (SELECT COUNT(DISTINCT suite || '::' || test_name)::INTEGER FROM (
        SELECT suite, test_name, COUNT(*) AS runs,
          COUNT(*) FILTER (WHERE status IN ('failed', 'flaky')) AS fails
        FROM test_results
        WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window * 2)} || ' days')
          AND created_at <= CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
        GROUP BY suite, test_name
        HAVING runs >= 5 AND fails > 0
      ) sub) AS previous_count
  `);
  const flakyTrend = (trendRow?.current_count ?? 0) - (trendRow?.previous_count ?? 0);

  const totalClassified = flakyRow?.total_classified ?? 1;
  const intermittent = flakyRow?.intermittent ?? 0;

  // --- Data quality ---
  const [dataRow] = await store.raw<{
    commit_count: number;
    commits_with_changes: number;
  }>(`
    SELECT
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM test_results
       WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
         AND commit_sha IS NOT NULL) AS commit_count,
      (SELECT COUNT(DISTINCT commit_sha)::INTEGER FROM commit_changes
       WHERE commit_sha IN (
         SELECT DISTINCT commit_sha FROM test_results
         WHERE created_at > CURRENT_TIMESTAMP - INTERVAL (${Number(window)} || ' days')
       )) AS commits_with_changes
  `);

  const commitCount = dataRow?.commit_count ?? 0;
  const commitsWithChanges = dataRow?.commits_with_changes ?? 0;
  const coFailureCoverage = commitCount > 0 ? commitsWithChanges / commitCount : 0;

  let confidence: FlakerKpi["data"]["confidence"];
  if (commitCount < 5) confidence = "insufficient";
  else if (commitCount < 30) confidence = "low";
  else if (commitCount < 100) confidence = "moderate";
  else confidence = "high";

  return {
    timestamp: new Date().toISOString(),
    windowDays: window,
    sampling: {
      recall: null,
      sampleRatio: samplingRow?.sample_ratio ?? null,
      timeSavedMinutes: samplingRow?.saved_minutes ?? null,
      holdoutFNR: holdoutRow?.fnr ?? null,
      matchedCommits: samplingRow?.matched ?? 0,
    },
    flaky: {
      brokenTests: flakyRow?.broken ?? 0,
      intermittentFlaky: intermittent,
      trueFlakyRate: Math.round((intermittent / totalClassified) * 1000) / 10,
      flakyTrend,
    },
    data: {
      commitCount,
      commitsWithChanges,
      coFailureCoverage: Math.round(coFailureCoverage * 1000) / 10,
      coFailureReady: coFailureCoverage >= 0.8,
      confidence,
    },
  };
}

export function formatKpi(kpi: FlakerKpi): string {
  const lines: string[] = ["# flaker KPI Dashboard", ""];

  // Sampling
  if (kpi.sampling.matchedCommits > 0 || kpi.sampling.sampleRatio != null) {
    lines.push("## Sampling Effectiveness");
    lines.push(`  Recall:           ${kpi.sampling.recall != null ? kpi.sampling.recall + "%" : "N/A (need CI+local overlap)"}`);
    lines.push(`  Sample ratio:     ${kpi.sampling.sampleRatio != null ? kpi.sampling.sampleRatio + "%" : "N/A"}`);
    lines.push(`  Time saved:       ${kpi.sampling.timeSavedMinutes != null ? kpi.sampling.timeSavedMinutes + " min" : "N/A"}`);
    lines.push(`  Holdout FNR:      ${kpi.sampling.holdoutFNR != null ? kpi.sampling.holdoutFNR + "%" : "N/A"}`);
    lines.push("");
  }

  // Flaky
  lines.push("## Flaky Tracking");
  lines.push(`  Broken tests:     ${kpi.flaky.brokenTests}${kpi.flaky.brokenTests > 0 ? " ← fix or quarantine" : ""}`);
  lines.push(`  Flaky tests:      ${kpi.flaky.intermittentFlaky} (intermittent, >= 5 runs)`);
  lines.push(`  True flaky rate:  ${kpi.flaky.trueFlakyRate}%`);
  const trend = kpi.flaky.flakyTrend;
  const trendLabel = trend > 0
    ? `+${trend} tests (worsening vs prev ${kpi.windowDays} days)`
    : trend < 0
      ? `${trend} tests (improving vs prev ${kpi.windowDays} days)`
      : "stable";
  lines.push(`  Trend:            ${trendLabel}`);

  // Data
  lines.push("");
  lines.push("## Data Quality");
  lines.push(`  Commits:          ${kpi.data.commitCount} (${kpi.data.confidence})`);
  lines.push(`  Co-failure data:  ${kpi.data.commitsWithChanges}/${kpi.data.commitCount} commits (${kpi.data.coFailureCoverage}%)`);
  lines.push(`  Co-failure ready: ${kpi.data.coFailureReady ? "yes" : "no"}`);

  // Issues + next steps
  lines.push("");
  const issues: string[] = [];
  const steps: string[] = [];
  if (kpi.flaky.brokenTests > 0) {
    issues.push(`${kpi.flaky.brokenTests} broken test(s)`);
    steps.push(`Fix or quarantine broken tests: \`flaker flaky --top 20\``);
  }
  if (kpi.data.confidence === "insufficient" || kpi.data.confidence === "low") {
    issues.push(`${kpi.data.confidence} data (${kpi.data.commitCount} commits)`);
    steps.push(`Collect more history: \`flaker collect --last 30\``);
  }
  if (!kpi.data.coFailureReady) {
    issues.push("co-failure data incomplete");
    steps.push(`Ensure \`flaker collect\` runs with GITHUB_TOKEN set`);
  }
  if (kpi.sampling.matchedCommits === 0 && kpi.sampling.sampleRatio == null) {
    steps.push(`Start using sampling: \`flaker run\``);
  }

  if (issues.length === 0) {
    lines.push("All KPIs healthy.");
  } else {
    lines.push(`Issues: ${issues.join(", ")}`);
    lines.push("");
    lines.push("Next steps:");
    for (let i = 0; i < steps.length; i++) {
      lines.push(`  ${i + 1}. ${steps[i]}`);
    }
  }

  return lines.join("\n");
}
