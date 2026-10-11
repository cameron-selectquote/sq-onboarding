import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import type { TemplateTaskInput } from "@/lib/templates";

/**
 * POST /api/templates/:id/tasks — add a task to a role template.
 *
 * Body: { title, ownerTeam, cost?, costType?, appId? }. A task with an `appId`
 * grants that seat when a hire starts it; the service validates the app id.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<TemplateTaskInput>;

  if (!body.title || !body.ownerTeam) {
    return NextResponse.json(
      { error: "title and ownerTeam are required" },
      { status: 400 },
    );
  }

  const { templates } = await getServices();
  try {
    const task = await templates.addTask(id, body as TemplateTaskInput);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
