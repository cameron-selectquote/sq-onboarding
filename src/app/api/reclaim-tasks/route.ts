import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** POST /api/reclaim-tasks — open a reclaim job for a seat (finance or IT). */
export async function POST(req: Request) {
  const body = (await req.json()) as {
    licenseId?: string;
    createdByTeam?: "finance" | "it";
  };

  if (!body.licenseId || (body.createdByTeam !== "finance" && body.createdByTeam !== "it")) {
    return NextResponse.json(
      { error: "licenseId and createdByTeam ('finance'|'it') are required" },
      { status: 400 },
    );
  }

  const { reclaimTasks } = await getServices();
  try {
    const task = await reclaimTasks.open(body.licenseId, body.createdByTeam);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
