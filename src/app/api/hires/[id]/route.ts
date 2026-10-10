import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** GET /api/hires/:id — hire detail with tasks, licenses, and total spend. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { repo, ledger } = await getServices();

  const hire = await repo.hires.get(id);
  if (!hire) {
    return NextResponse.json({ error: "Hire not found" }, { status: 404 });
  }

  const [tasks, licenses, totalSpend] = await Promise.all([
    repo.tasks.where((t) => t.hireId === id),
    repo.licenses.where((l) => l.hireId === id),
    ledger.totalForHire(id),
  ]);

  return NextResponse.json({ hire, tasks, licenses, totalSpend });
}
