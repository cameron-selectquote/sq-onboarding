import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { canOpenPath, homePathFor } from "@/lib/access";
import { findAccount } from "@/lib/accounts";
import { passwordMatches } from "@/lib/session";
import { authSecret, demoPassword, setSessionCookie } from "@/server/auth";

/** Same-origin relative path only (blocks open redirects like //evil.test). */
function safeNext(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : null;
}

/**
 * POST /api/session — demo login from the /login form.
 * Fields: username, password, next (optional).
 * Redirects (303) to `next` (if the role may open it) or /home; back to /login on error.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "");
  const next = safeNext(form.get("next"));
  const fail = (error: string) => {
    const url = publicUrl("/login", req);
    url.searchParams.set("error", error);
    if (next) url.searchParams.set("next", next);
    if (username) url.searchParams.set("username", username.slice(0, 64));
    return NextResponse.redirect(url, 303);
  };

  const secret = authSecret();
  const password = demoPassword();
  if (secret === null || password === null) return fail("Login is not configured on this server.");

  // Always run the password check so a bad username and a bad password look alike.
  const account = findAccount(username);
  const passwordOk = password === "" || (await passwordMatches(String(form.get("password") ?? ""), password));
  if (!account || !passwordOk) return fail("Wrong username or password.");

  const { role } = account;
  const dest = next && canOpenPath(role, new URL(next, req.url).pathname) ? next : homePathFor(role);
  const res = NextResponse.redirect(publicUrl(dest, req), 303);
  await setSessionCookie(
    res,
    { username: account.username, name: account.name, role, viewAs: role, hireId: account.hireId },
    secret,
  );
  return res;
}
