import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { clearSessionCookie } from "@/server/auth";

/** POST /api/session/logout — clear the session, back to /login. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(publicUrl("/login", req), 303);
  clearSessionCookie(res);
  return res;
}
