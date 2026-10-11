import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/server/auth";

/** POST /api/session/logout — clear the session, back to /login. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  clearSessionCookie(res);
  return res;
}
