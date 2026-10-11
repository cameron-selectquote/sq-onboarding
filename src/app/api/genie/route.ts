import {NextResponse} from 'next/server';
import {
  GENIE_GREETING,
  hasBedrockCreds,
  runGenieTurn,
  type GenieTurnInput,
} from '@/server/genie';

// Strands + better-sqlite3 need the Node.js runtime (not Edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/genie — the opening greeting + which engine is active. */
export async function GET() {
  return NextResponse.json({
    greeting: GENIE_GREETING,
    engine: hasBedrockCreds() ? 'strands-bedrock' : 'scripted',
  });
}

/** POST /api/genie — run one conversational turn. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    history?: {role: 'user' | 'genie'; text: string}[];
    confirmedCandidateId?: string | null;
    plan?: unknown;
    offboard?: unknown;
  };
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({error: 'message is required'}, {status: 400});
  }
  try {
    const reply = await runGenieTurn({
      message: body.message,
      history: Array.isArray(body.history) ? body.history : [],
      confirmedCandidateId: body.confirmedCandidateId ?? null,
      // The client round-trips the pending plan + offboard state across turns.
      plan: (body.plan as GenieTurnInput['plan']) ?? null,
      offboard: (body.offboard as GenieTurnInput['offboard']) ?? null,
    });
    return NextResponse.json(reply);
  } catch (err) {
    return NextResponse.json({error: (err as Error).message}, {status: 500});
  }
}
