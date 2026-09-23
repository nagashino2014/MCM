import { isIP } from "node:net";

function isLoopbackOrUnspecified(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "0.0.0.0" || normalized === "::" || normalized === "::1") return true;
  if (isIP(normalized) === 4) {
    const [first, second] = normalized.split(".").map(Number);
    return first === 127 || (first === 169 && second === 254);
  }
  if (isIP(normalized) === 6) {
    const firstHextet = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if (normalized.startsWith("64:ff9b:")) return true;
    // WHATWG URL canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    // Treat IPv4-mapped/translated and legacy compatible forms the same as IPv4.
    const mapped = normalized.match(/^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const high = Number.parseInt(mapped[1], 16);
      const low = Number.parseInt(mapped[2], 16);
      const firstOctet = high >>> 8;
      const secondOctet = high & 0xff;
      return (
        (high === 0 && low === 0)
        || firstOctet === 127
        || (firstOctet === 169 && secondOctet === 254)
      );
    }
  }
  return false;
}

export function resolveWorkerBackendUrl(messageUrl?: string): string | undefined {
  const runtimeUrl = process.env.IEPS_BACKEND_URL?.trim();
  const managedRuntime = process.env.NODE_ENV === "production" || Boolean(process.env.MCM_JOB_QUEUE_URL);

  if (!managedRuntime) return messageUrl?.trim() || runtimeUrl || undefined;
  if (!runtimeUrl) throw new Error("IEPS_BACKEND_URL is required for managed worker collect/parse jobs");

  let parsed: URL;
  try {
    parsed = new URL(runtimeUrl);
  } catch {
    throw new Error("IEPS_BACKEND_URL must be a valid absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("IEPS_BACKEND_URL must use HTTP(S)");
  }
  if (isLoopbackOrUnspecified(parsed.hostname)) {
    throw new Error("IEPS_BACKEND_URL must not use a loopback host in managed worker mode");
  }

  // Queue input is untrusted. Managed workers always use the task-definition URL.
  return runtimeUrl.replace(/\/+$/, "");
}
