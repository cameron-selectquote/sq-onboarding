/**
 * Demo auth config + session helpers for middleware, routes, and pages.
 *
 * Env:
 * - AUTH_SECRET    signs the session cookie. Required in production.
 * - DEMO_PASSWORD  shared login password. Required in production; when unset
 *                  in dev, login needs no password.
 *
 * In production a missing var fails closed: nobody can log in, and every
 * request is treated as signed out.
 */
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession, type Session } from "@/lib/session";

const DEV_SECRET = "provision-dev-only-secret";
const isProd = process.env.NODE_ENV === "production";

export function authSecret(): string | null {
  return process.env.AUTH_SECRET || (isProd ? null : DEV_SECRET);
}

/** The shared password, "" when none is required (dev only), or null if misconfigured. */
export function demoPassword(): string | null {
  return process.env.DEMO_PASSWORD || (isProd ? null : "");
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export async function readSession(token: string | undefined): Promise<Session | null> {
  const secret = authSecret();
  return secret ? verifySession(token, secret, nowSeconds()) : null;
}

/** Session for the current request, from server components / route handlers. */
export async function currentSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function setSessionCookie(res: NextResponse, session: Omit<Session, "exp">, secret: string): Promise<void> {
  const token = await signSession({ ...session, exp: nowSeconds() + SESSION_TTL_SECONDS }, secret);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: isProd, path: "/", maxAge: 0 });
}
