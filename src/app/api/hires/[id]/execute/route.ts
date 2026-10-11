import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

export const runtime = "nodejs";

/**
 * POST /api/hires/:id/execute — run the automatable onboarding tasks for a hire
 * (grant seats, order laptop, issue badge, provision email/SSO). Mirrors the
 * Genie's executeOnboardingTasks tool for direct/testing use.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { onboarding } = await getServices();
  try {
    const report = await onboarding.executeForHire(id);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
