/**
 * Demo session token: `base64url(json).base64url(hmac-sha256)`.
 *
 * Deliberately tiny. A signed cookie says which persona you logged in as (and,
 * for a new hire, which hire). No user table, no refresh tokens, no SSO.
 *
 * Web Crypto only, so it runs in middleware, route handlers, and Jest alike.
 * Pure: the caller passes the secret and the current time.
 */
import { isPersona, type Persona } from "./access";

export const SESSION_COOKIE = "provision_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export interface Session {
  persona: Persona;
  /** Set only for the `hire` persona: whose checklist they may see. */
  hireId: string | null;
  /** Expiry, unix seconds. */
  exp: number;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(session: Session, secret: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/** Returns the session if the token is well-formed, correctly signed, and unexpired. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
  nowSeconds: number,
): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const sigBytes = fromBase64Url(sig);
  if (!sigBytes) return null;

  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, encoder.encode(payload));
  if (!ok) return null;

  const json = fromBase64Url(payload);
  if (!json) return null;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { persona, hireId, exp } = data as Record<string, unknown>;
  if (!isPersona(persona) || typeof exp !== "number" || exp <= nowSeconds) return null;
  if (persona === "hire") return typeof hireId === "string" ? { persona, hireId, exp } : null;
  return hireId === null ? { persona, hireId, exp } : null;
}

/** Constant-time password check (compares SHA-256 digests, so length doesn't leak). */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
