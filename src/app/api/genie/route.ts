import {NextResponse} from 'next/server';
import {
  greetingForRole,
  hasBedrockCreds,
  resolveGenieContext,
  runGenieTurn,
  type GenieTurnInput,
} from '@/server/genie';

// Strands + better-sqlite3 need the Node.js runtime (not Edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/genie — the opening greeting for the signed-in role + which engine
 * is active. The role comes from the session, so each role sees its own Genie.
 */
export async function GET() {
  const {role} = await resolveGenieContext();
  return NextResponse.json({
    greeting: greetingForRole(role),
    engine: hasBedrockCreds() ? 'strands-bedrock' : 'scripted',
    role,
  });
}

/** POST /api/genie — run one conversational turn, scoped to the session role. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    history?: {role: 'user' | 'genie'; text: string}[];
    confirmedCandidateId?: string | null;
    plan?: unknown;
    offboard?: unknown;
    templateDraft?: unknown;
  };
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({error: 'message is required'}, {status: 400});
  }
  // Role + scope are derived server-side from the signed session — never from
  // the request body — so a client can't request a higher-privilege agent.
  const {role, scope} = await resolveGenieContext();
  try {
    const reply = await runGenieTurn({
      message: body.message,
      role,
      scope,
      history: Array.isArray(body.history) ? body.history : [],
      confirmedCandidateId: body.confirmedCandidateId ?? null,
      // The client round-trips the pending plan + offboard + template state.
      plan: (body.plan as GenieTurnInput['plan']) ?? null,
      offboard: (body.offboard as GenieTurnInput['offboard']) ?? null,
      templateDraft:
        (body.templateDraft as GenieTurnInput['templateDraft']) ?? null,
    });
    return NextResponse.json(reply);
  } catch (err) {
    return NextResponse.json({error: (err as Error).message}, {status: 500});
  }
}
