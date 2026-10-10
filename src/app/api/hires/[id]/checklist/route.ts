import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { toChecklist } from "@/lib/checklist";

/**
 * GET /api/hires/:id/checklist — the new-hire view's only data source.
 * Returns the cost-free projection (no costs, budgets, or ledger data).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { repo } = await getServices();
  const hire = await repo.hires.get(id);
  if (!hire) {
    return NextResponse.json({ error: "Hire not found" }, { status: 404 });
  }
  const tasks = await repo.tasks.where((t) => t.hireId === id);
  return NextResponse.json(toChecklist(hire, tasks));
}
