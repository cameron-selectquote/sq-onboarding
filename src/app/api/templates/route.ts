import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * GET /api/templates — every role template with its template tasks attached.
 * POST /api/templates — create a new role template. Body: { roleName }.
 */
export async function GET() {
  const { templates } = await getServices();
  return NextResponse.json({ templates: await templates.listWithTasks() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { roleName?: string };
  if (!body.roleName) {
    return NextResponse.json({ error: "roleName is required" }, { status: 400 });
  }

  const { templates } = await getServices();
  try {
    const template = await templates.createTemplate(body.roleName);
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
