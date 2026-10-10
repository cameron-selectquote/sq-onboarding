import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * POST /api/ai/draft-brief — hire's granted tools -> welcome-brief blurbs.
 *
 * Body: { hireId: string }. Resolves the hire's active licenses to app names
 * and hands them to the AiClient. The access-brief view renders the result.
 */
export async function POST(req: Request) {
  const body = (await req.json()) as { hireId?: string };

  if (!body.hireId) {
    return NextResponse.json({ error: "hireId is required" }, { status: 400 });
  }

  const { repo, ai } = await getServices();

  const hire = await repo.hires.get(body.hireId);
  if (!hire) {
    return NextResponse.json({ error: "Hire not found" }, { status: 404 });
  }

  const licenses = await repo.licenses.where(
    (l) => l.hireId === hire.id && l.status === "active",
  );

  const apps = await repo.appCatalog.list();
  const appNameById = new Map(apps.map((a) => [a.id, a.name]));
  const appNames = licenses
    .map((l) => appNameById.get(l.appId))
    .filter((name): name is string => Boolean(name));

  const blurbs = await ai.draftBrief({ hireName: hire.name, appNames });
  return NextResponse.json({ blurbs });
}
