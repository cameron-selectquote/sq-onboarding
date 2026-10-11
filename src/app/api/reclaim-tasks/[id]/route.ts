import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

type ReclaimAction = "start" | "complete" | "cancel";
const VALID: ReadonlySet<ReclaimAction> = new Set(["start", "complete", "cancel"]);

/** PATCH /api/reclaim-tasks/:id — drive a reclaim job (start/complete/cancel). */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = (await req.json()) as { action?: string };

  if (!body.action || !VALID.has(body.action as ReclaimAction)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { id } = await params;
  const { reclaimTasks } = await getServices();
  try {
    const action = body.action as ReclaimAction;
    const task =
      action === "start"
        ? await reclaimTasks.start(id)
        : action === "complete"
          ? await reclaimTasks.complete(id)
          : await reclaimTasks.cancel(id);
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
