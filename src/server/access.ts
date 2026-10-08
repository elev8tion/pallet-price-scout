/**
 * Host and cookie policy for loopback use vs a short-lived shared demo URL.
 * SCOUT_OPEN=1 lets anyone who can reach the host bootstrap a session.
 * It does not bind the server to the public internet — listen stays on 127.0.0.1.
 */
export function openModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SCOUT_OPEN === "1";
}

export function allowedHostPatterns(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = (env.SCOUT_HOSTS ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return configured;
  if (openModeEnabled(env)) return ["*.trycloudflare.com"];
  return [];
}

export function hostnameFromHostHeader(host: string | undefined): string | undefined {
  if (!host) return undefined;
  return host.split(":")[0].replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function hostMatchesPattern(hostname: string, pattern: string): boolean {
  const expected = pattern.toLowerCase();
  if (expected.startsWith("*.")) {
    const suffix = expected.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length && !hostname.slice(0, -suffix.length).includes(".");
  }
  return hostname === expected;
}

export function hostAllowed(host: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const hostname = hostnameFromHostHeader(host);
  if (!hostname) return false;
  if (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1") return true;
  return allowedHostPatterns(env).some((pattern) => hostMatchesPattern(hostname, pattern));
}

export function cookieAttributes(request: { headers: Record<string, unknown> }, env: NodeJS.ProcessEnv = process.env): string {
  const proto = String(request.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const secure = proto === "https" || env.SCOUT_SECURE_COOKIES === "1";
  return secure ? "HttpOnly; SameSite=Lax; Secure; Path=/" : "HttpOnly; SameSite=Strict; Path=/";
}

export function csrfCookieAttributes(request: { headers: Record<string, unknown> }, env: NodeJS.ProcessEnv = process.env): string {
  return cookieAttributes(request, env).replace("HttpOnly; ", "");
}
