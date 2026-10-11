/**
 * Absolute URL for `path` on the origin the *browser* used.
 *
 * Behind a reverse proxy (NGINX -> 127.0.0.1:3000), Next's standalone server
 * builds `req.url` from its own bind address, so `new URL(path, req.url)`
 * yields `https://localhost:3000/...`. The proxy forwards the public origin in
 * `X-Forwarded-Host` / `Host` and `X-Forwarded-Proto`; prefer those and fall
 * back to `req.url` (local dev, tests).
 */
export function publicUrl(path: string, req: { url: string; headers: Headers }): URL {
  const fallback = new URL(req.url);
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host")) ?? fallback.host;
  const proto = first(req.headers.get("x-forwarded-proto")) ?? fallback.protocol.replace(/:$/, "");
  return new URL(path, `${proto === "https" ? "https" : "http"}://${host}`);
}
