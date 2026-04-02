import { MOONBIT_JS_BRIDGE_URL } from "./core/build-artifact.js";

export interface TestIdentityFields {
  suite: string;
  testName: string;
  taskId?: string | null;
  filter?: string | null;
  variant?: Record<string, string> | null;
  testId?: string;
}

export interface ResolvedTestIdentity extends TestIdentityFields {
  taskId: string;
  filter: string | null;
  variant: Record<string, string> | null;
  testId: string;
}

interface CoreStableVariantEntryInput {
  key: string;
  value: string;
}

interface CoreStableTestIdentityInput {
  suite: string;
  test_name: string;
  task_id?: string;
  filter?: string;
  variant?: CoreStableVariantEntryInput[];
  test_id?: string;
}

interface CoreResolvedStableTestIdentityOutput {
  suite: string;
  test_name: string;
  task_id: string;
  filter?: string;
  variant?: CoreStableVariantEntryInput[];
  test_id: string;
}

interface IdentityCoreExports {
  create_stable_test_id_json?: (inputJson: string) => string;
  resolve_test_identity_json?: (inputJson: string) => string;
}

function normalizeVariantFallback(
  variant?: Record<string, string> | null,
): Record<string, string> | null {
  if (!variant) return null;

  const entries = Object.entries(variant)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) return null;
  return Object.fromEntries(entries);
}

function createStableTestIdFallback(input: TestIdentityFields): string {
  const taskId = input.taskId ?? input.suite;
  const filter = input.filter ?? null;
  const variant = normalizeVariantFallback(input.variant);

  return JSON.stringify({
    taskId,
    suite: input.suite,
    testName: input.testName,
    filter,
    variant,
  });
}

function resolveTestIdentityFallback<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  const taskId = input.taskId ?? input.suite;
  const filter = input.filter ?? null;
  const variant = normalizeVariantFallback(input.variant);
  const testId =
    input.testId ??
    createStableTestIdFallback({
      ...input,
      taskId,
      filter,
      variant,
    });

  return {
    ...input,
    taskId,
    filter,
    variant,
    testId,
  };
}

function toCoreVariant(
  variant?: Record<string, string> | null,
): CoreStableVariantEntryInput[] | null {
  const normalized = normalizeVariantFallback(variant);
  if (!normalized) {
    return null;
  }
  return Object.entries(normalized).map(([key, value]) => ({ key, value }));
}

function fromCoreVariant(
  variant: CoreStableVariantEntryInput[] | null | undefined,
): Record<string, string> | null {
  if (!variant || variant.length === 0) {
    return null;
  }
  return Object.fromEntries(
    [...variant]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => [entry.key, entry.value] as const),
  );
}

function toCoreInput(input: TestIdentityFields): CoreStableTestIdentityInput {
  const base: CoreStableTestIdentityInput = {
    suite: input.suite,
    test_name: input.testName,
  };
  if (input.taskId != null) {
    base.task_id = input.taskId;
  }
  if (input.filter != null) {
    base.filter = input.filter;
  }
  const variant = toCoreVariant(input.variant);
  if (variant) {
    base.variant = variant;
  }
  if (input.testId != null) {
    base.test_id = input.testId;
  }
  return base;
}

const identityCore = await (async (): Promise<IdentityCoreExports | null> => {
  try {
    const mod = (await import(MOONBIT_JS_BRIDGE_URL.href)) as IdentityCoreExports;
    if (
      typeof mod.create_stable_test_id_json === "function" &&
      typeof mod.resolve_test_identity_json === "function"
    ) {
      return mod;
    }
  } catch {
    // Fall back to the TypeScript implementation when MoonBit JS is unavailable.
  }
  return null;
})();

export function normalizeVariant(
  variant?: Record<string, string> | null,
): Record<string, string> | null {
  if (identityCore) {
    return fromCoreVariant(toCoreVariant(variant));
  }
  return normalizeVariantFallback(variant);
}

export function createStableTestId(input: TestIdentityFields): string {
  if (identityCore?.create_stable_test_id_json) {
    return JSON.parse(
      identityCore.create_stable_test_id_json(JSON.stringify(toCoreInput(input))),
    ) as string;
  }
  return createStableTestIdFallback(input);
}

export function resolveTestIdentity<T extends TestIdentityFields>(
  input: T,
): T & ResolvedTestIdentity {
  if (identityCore?.resolve_test_identity_json) {
    const resolved = JSON.parse(
      identityCore.resolve_test_identity_json(JSON.stringify(toCoreInput(input))),
    ) as CoreResolvedStableTestIdentityOutput;
    return {
      ...input,
      taskId: resolved.task_id,
      filter: resolved.filter ?? null,
      variant: fromCoreVariant(resolved.variant),
      testId: resolved.test_id,
    };
  }
  return resolveTestIdentityFallback(input);
}
