import { NextResponse, type NextRequest } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { canSwitchRole, homePathFor, isAppRole } from "@/lib/access";
import { authSecret, currentSession, setSessionCookie } from "@/server/auth";
import { getServices } from "@/server/store";

/**
 * POST /api/session/view-as — admin role picker.
 * Fields: viewAs (admin | manager | employee), hireId (required for employee).
 * Public in middleware so an admin viewing as employee can switch back; the
 * admin check happens here, against the session's *real* role.
 */
export async function POST(req: NextRequest) {
  const session = await currentSession();
  const secret = authSecret();
  if (!session || !secret) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canSwitchRole(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const viewAs = form.get("viewAs");
  if (!isAppRole(viewAs)) return NextResponse.json({ error: "Unknown role" }, { status: 400 });

  let hireId: string | null = null;
  if (viewAs === "employee") {
    const id = String(form.get("hireId") ?? "");
    const { repo } = await getServices();
    if (!id || !(await repo.hires.get(id))) return NextResponse.json({ error: "Pick an employee" }, { status: 400 });
    hireId = id;
  }

  const res = NextResponse.redirect(publicUrl(homePathFor(viewAs), req), 303);
  await setSessionCookie(res, { ...session, viewAs, hireId }, secret);
  return res;
}
