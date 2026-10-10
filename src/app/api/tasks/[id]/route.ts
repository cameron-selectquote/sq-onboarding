import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import type { TaskStatus } from "@/lib/types";

const VALID: ReadonlySet<TaskStatus> = new Set([
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
]);

/** PATCH /api/tasks/:id — update task status (board drag, queue actions). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as { status?: string };

  if (!body.status || !VALID.has(body.status as TaskStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { repo } = await getServices();
  const existing = await repo.tasks.get(id);
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const task = await repo.tasks.update(id, { status: body.status as TaskStatus });
  return NextResponse.json({ task });
}
