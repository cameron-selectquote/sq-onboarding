import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * GET /api/catalog — app catalog, asset catalog, and role templates.
 * Feeds the import form (roles + apps), license names, and the PO form.
 */
export async function GET() {
  const { repo } = await getServices();
  const [apps, assetCatalog, templates] = await Promise.all([
    repo.appCatalog.list(),
    repo.assetCatalog.list(),
    repo.templates.list(),
  ]);
  return NextResponse.json({ apps, assetCatalog, templates });
}
