import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/**
 * GET /api/health — unauthenticated readiness check (deploy smoke test).
 * Opens the store and runs a real query, so a schema/DB problem returns 503
 * and the deploy rolls back. Returns no data.
 */
export async function GET() {
  try {
    const { repo } = await getServices();
    await repo.appCatalog.list();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health] store check failed", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
