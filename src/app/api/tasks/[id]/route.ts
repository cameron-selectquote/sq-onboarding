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

/**
 * PATCH /api/tasks/:id — update task status (board drag, queue actions).
 *
 * Starting a seat-granting task (one with an `appId`) assigns the seat (active
 * license + ledger + budget) and moves the task to in_progress.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as { status?: string };

  if (!body.status || !VALID.has(body.status as TaskStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const nextStatus = body.status as TaskStatus;

  const { repo, licenses } = await getServices();
  const existing = await repo.tasks.get(id);
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Starting a seat-granting task also assigns the seat.
  const startingSeatTask =
    nextStatus === "in_progress" &&
    existing.status !== "in_progress" &&
    existing.appId !== null;

  if (startingSeatTask) {
    try {
      const license = await licenses.assign(existing.hireId, existing.appId!);
      const task = await repo.tasks.update(id, { status: "in_progress" });
      return NextResponse.json({ task, license });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  const task = await repo.tasks.update(id, { status: nextStatus });
  return NextResponse.json({ task });
}
