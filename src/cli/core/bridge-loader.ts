export async function importOptionalMoonBitBridge<T>(
  bridgeUrl: URL,
  isValid: (mod: Partial<T>) => mod is T,
): Promise<T | null> {
  try {
    const mod = (await import(bridgeUrl.href)) as Partial<T>;
    return isValid(mod) ? mod : null;
  } catch (error) {
    if (isMissingBridgeModuleError(error, bridgeUrl)) {
      return null;
    }
    throw error;
  }
}

function isMissingBridgeModuleError(error: unknown, bridgeUrl: URL): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "ERR_MODULE_NOT_FOUND" && message.includes(bridgeUrl.href);
}
