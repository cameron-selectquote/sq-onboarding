import { NextResponse, type NextRequest } from "next/server";
import { canOpenPath, homePathFor, isPersona } from "@/lib/access";
import { passwordMatches } from "@/lib/session";
import { authSecret, demoPassword, setSessionCookie } from "@/server/auth";
import { getServices } from "@/server/store";

/** Same-origin relative path only (blocks open redirects like //evil.test). */
function safeNext(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : null;
}

/**
 * POST /api/session — demo login from the /login form.
 * Fields: persona, password, hireId (new hire only), next (optional).
 * Redirects (303) to the persona's home or `next`; back to /login on error.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const persona = form.get("persona");
  const next = safeNext(form.get("next"));
  const fail = (error: string) => {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", error);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };

  const secret = authSecret();
  const password = demoPassword();
  if (secret === null || password === null) return fail("Login is not configured on this server.");
  if (password && !(await passwordMatches(String(form.get("password") ?? ""), password))) {
    return fail("Wrong password.");
  }
  if (!isPersona(persona)) return fail("Pick a role.");

  let hireId: string | null = null;
  if (persona === "hire") {
    const id = String(form.get("hireId") ?? "");
    const { repo } = await getServices();
    if (!id || !(await repo.hires.get(id))) return fail("Pick a new hire.");
    hireId = id;
  }

  const dest = next && canOpenPath(persona, new URL(next, req.url).pathname) ? next : homePathFor(persona);
  const res = NextResponse.redirect(new URL(dest, req.url), 303);
  await setSessionCookie(res, { persona, hireId }, secret);
  return res;
}
