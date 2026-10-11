import { NextResponse, type NextRequest } from "next/server";
import { canCallApi, canOpenPath, homePathFor } from "@/lib/access";
import { SESSION_COOKIE } from "@/lib/session";
import { readSession } from "@/server/auth";

/** Reachable without a session. */
const PUBLIC_PATHS = new Set(["/login", "/api/session", "/api/session/logout", "/api/health"]);

/**
 * Deny-by-default gate for every page and API route.
 * - No valid session: pages redirect to /login, APIs return 401.
 * - Signed in: pages follow the persona's role views (lib/access.ts); a new
 *   hire is limited to their checklist and gets 403 from every API.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (isApi) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const login = new URL("/login", req.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  if (isApi) {
    return canCallApi(session.persona)
      ? NextResponse.next()
      : NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pathname === "/" || !canOpenPath(session.persona, pathname)) {
    return NextResponse.redirect(new URL(homePathFor(session.persona), req.url));
  }
  return NextResponse.next();
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
