import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import type { TemplateTaskInput } from "@/lib/templates";

/**
 * PATCH  /api/templates/:id/tasks/:taskId — edit a template task.
 * DELETE /api/templates/:id/tasks/:taskId — remove a template task.
 *
 * The template id is in the path for a tidy REST shape; the task id alone
 * identifies the row, so the service keys off `taskId`.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { taskId } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<TemplateTaskInput>;

  const { templates } = await getServices();
  try {
    const task = await templates.updateTask(taskId, body);
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const { taskId } = await params;

  const { templates } = await getServices();
  try {
    await templates.removeTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
