import { NextResponse } from "next/server";
import { getServices } from "@/server/store";
import { searchCandidates } from "@/lib/candidates";

export const runtime = "nodejs";

/**
 * GET /api/candidates — list candidate records (optionally ?q= to fuzzy-search
 * by name). Feeds the specialist Candidates view and gives a window into the
 * Genie's pipeline: who's `new` vs. already `onboarding`.
 */
export async function GET(req: Request) {
  const { repo } = await getServices();
  const all = await repo.candidates.list();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const candidates = q ? searchCandidates(all, q) : all;
  return NextResponse.json({ candidates });
}
