/**
 * The Onboarding Genie — an AI agent built on the Strands Agents SDK.
 *
 * It guides HR and managers through setting up a new hire's onboarding:
 * search the candidate, confirm, review a 30-day checklist, then publish a
 * plan. The two actions in the brief are Strands tools:
 *   - searchCandidateRecords  -> CandidateService.search
 *   - createOnboardingPlan    -> CandidateService.publishPlan
 *
 * Model: Amazon Bedrock (Strands' default provider) when AWS credentials are
 * present. With no creds, the agent can't call a model, so we fall back to a
 * deterministic scripted planner that walks the same beats using the same
 * domain functions — the demo and tests run offline, and the real agent takes
 * over the moment creds exist. Both paths go through the one CandidateService,
 * so neither can hand-write tasks or drift from the data model.
 */

import {Agent, configureLogging, tool} from '@strands-agents/sdk';
import {z} from 'zod';
import {
  CHECKLIST_CATEGORY_LABEL,
  classifyMatches,
  defaultChecklist,
  type ChecklistCategory,
} from '@/lib/candidates';
import {
  addSeat,
  includeTask,
  newPlan,
  removeSeat,
  resolveAppId,
  setRole,
  setStartDate,
  skipTask,
  type PendingPlan,
} from '@/lib/plan';
import type {AppCatalogItem, Candidate} from '@/lib/types';
import type {Repository} from '@/lib/repository';
import {getServices} from './store';

/**
 * Strands debug logging. The SDK's default logger silences debug/info and only
 * prints warn/error. Set GENIE_DEBUG=1 (or STRANDS_DEBUG=1) to route the SDK's
 * debug/info to the server console so we can see the agent loop, tool calls,
 * and model traffic. Off by default so it never spams normal runs.
 */
let loggingConfigured = false;
function configureStrandsDebug(): void {
  if (loggingConfigured) return;
  loggingConfigured = true;

  const debugOn =
    process.env.GENIE_DEBUG === '1' ||
    process.env.GENIE_DEBUG === 'true' ||
    process.env.STRANDS_DEBUG === '1' ||
    process.env.STRANDS_DEBUG === 'true';
  if (!debugOn) return;

  const stamp = () => new Date().toISOString();
  configureLogging({
    debug: (...args: unknown[]) =>
      console.debug(`[strands ${stamp()}] [debug]`, ...args),
    info: (...args: unknown[]) =>
      console.info(`[strands ${stamp()}] [info]`, ...args),
    warn: (...args: unknown[]) =>
      console.warn(`[strands ${stamp()}] [warn]`, ...args),
    error: (...args: unknown[]) =>
      console.error(`[strands ${stamp()}] [error]`, ...args),
  });
  console.info('[strands] debug logging enabled (GENIE_DEBUG)');
}

/** The Genie's persona + scripted workflow (from the product brief). */
export const GENIE_SYSTEM_PROMPT = `You are Genie, an intelligent assistant inside the workspace. Your goal is to help the team get things done — guiding them through setting up new hires and running the workflows that follow.

PERSONALITY & BEHAVIOR
- Proactive, concise, and professional with a welcoming tone.
- Never invent candidate information, roles, or resume details. Rely strictly on the tools provided.

CONVERSATIONAL WORKFLOW
1. GREETING: Open with "Hey, what can I help you with today?"
2. CANDIDATE SEARCH & VERIFICATION: When the user gives a first and last name, call searchCandidateRecords. Present the record clearly (Candidate Name, Role/Title, Hiring Manager, Resume File) and ask "Is this the correct candidate you'd like to onboard today?" If multiple are found, ask the user to pick one. If none, offer to input the role and hiring manager manually.
3. TASK LIST GENERATION: Once confirmed, generate a 30-day onboarding checklist in three categories: Day 1 Essentials (Docs, Legal, IT Hardware Setup); Role & Tool Access (Permissions, Figma/GitHub/Jira invites); 30-Day Milestones (1-on-1s, team intros, initial training). List the software seats you plan to grant. Then ask "How does this task list look? Would you like to adjust or publish this plan?"
3a. ADJUSTMENTS: The user may ask to change the plan before publishing — e.g. "she doesn't need Slack", "add Jira", "skip the badge", "use the Designer template", "she starts March 15". Track these: adjust the seat list (appIds) you'll pass to createOnboardingPlan, the roleName, the start date, and note any tasks to skip. Confirm the change and re-show the updated seats, then invite more adjustments or publishing. Never silently ignore an adjustment.
4. PUBLISH: When the user approves, call createOnboardingPlan with the final roleName and appIds (reflecting every adjustment). Keep the hireId it returns.
5. EXECUTE: Immediately after publishing, call executeOnboardingTasks with that hireId to actually carry out everything that can be automated — grant software seats, order the laptop, issue the badge, provision email/SSO. If the user asked to leave anything out, pass those as skipKeywords (e.g. ["slack","badge"]) so they're not done. Then confirm with: a direct link to the candidate's onboarding portal, a short summary of what you automated, and a list of the remaining tasks that need a person.

OFFBOARDING (destructive — handle with care)
- When the user asks to offboard someone, FIRST call previewOffboarding and show them exactly what will be reclaimed: the software seats (with monthly cost recovered) and the hardware (with residual value credited), plus the totals.
- Then ask them to confirm, clearly stating this will revoke seats and return hardware. Do NOT call executeOffboarding yet.
- Only after the user explicitly confirms (e.g. "yes, offboard them") call executeOffboarding with confirmed=true. Never set confirmed=true on your own initiative or from an ambiguous reply. If unsure whether they confirmed, preview again and ask.

Always use the tools for candidate data, publishing, executing, and offboarding. Never claim a task is done unless a tool reported it done. Keep replies short.`;

export const GENIE_GREETING = [
  `Hey! I'm Genie. I can help you get things done — just tell me what you need. A few things to try:`,
  ``,
  `- **Set someone up** — "Onboard Nora Alvarez" or just a name`,
  `- **Pick a template** — "Use the Designer template for Sam Rivera"`,
  `- **Adjust the plan** — "drop Slack", "add Jira", "skip the badge"`,
  `- **Set a start date** — "she starts March 15"`,
  `- **Publish & run it** — "publish" grants seats, orders the laptop, issues the badge`,
  ``,
  `What can I help you with today?`,
].join('\n');

/** Default Bedrock model id (Strands default provider). */
const MODEL_ID =
  process.env.GENIE_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6';

/** True when Bedrock credentials are available in the environment. */
export function hasBedrockCreds(): boolean {
  return Boolean(
    process.env.AWS_BEARER_TOKEN_BEDROCK ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
  );
}

/** Build the Genie's Strands tools, bound to the shared services. */
async function buildTools() {
  const {candidates, onboarding, offboarding, repo} = await getServices();

  const searchCandidateRecords = tool({
    name: 'searchCandidateRecords',
    description:
      'Fuzzy-look up pre-hire candidate records by name (tolerates first-name-only queries and misspellings). Returns a confidence ("confident" = one clear match to confirm, "ambiguous" = several close matches to let the specialist pick from, "none" = nothing close, offer manual entry) and the matching records with name, title, role, hiring manager, resume file, and a 0..1 match score. Use before confirming who to onboard; when ambiguous, present the options and ask which one.',
    inputSchema: z.object({
      name: z.string().describe('Full or partial candidate name to search for'),
    }),
    callback: async ({name}) => {
      const result = await candidates.classify(name);
      return {
        confidence: result.confidence,
        count: result.matches.length,
        candidates: result.matches.map((m) => ({
          ...m.candidate,
          matchScore: Math.round(m.score * 100) / 100,
        })),
      };
    },
  });

  const createOnboardingPlan = tool({
    name: 'createOnboardingPlan',
    description:
      'Publish the onboarding plan for a confirmed candidate: creates the hire, instantiates onboarding tasks and tool seats, and returns the portal link. Only call after the user approves the plan.',
    inputSchema: z.object({
      candidateId: z.string().describe('The id of the confirmed candidate'),
      roleName: z
        .string()
        .optional()
        .describe('Role template to use if the candidate has no role on file'),
      appIds: z
        .array(z.string())
        .optional()
        .describe('Tool/app ids to grant as seats, e.g. github, slack, figma'),
    }),
    callback: async ({candidateId, roleName, appIds}) => {
      const result = await candidates.publishPlan({
        candidateId,
        roleName,
        appIds,
      });
      return {
        hireId: result.hire.id,
        hireName: result.hire.name,
        taskCount: result.tasks.length,
        seatCount: result.licenses.length,
        portalUrl: result.portalUrl,
      };
    },
  });

  const executeOnboardingTasks = tool({
    name: 'executeOnboardingTasks',
    description:
      "Actually carry out a hire's onboarding tasks that can be automated: grant software seats (GitHub, Slack, etc.), order a laptop, issue an access badge, and provision email/SSO. Each automated task is marked done and its real spend hits the ledger. Tasks that need a person (manager 1-on-1s, training, goal-setting) are reported as skipped. Call this after a plan is published, using the hireId returned by createOnboardingPlan. If the user asked to leave something out (e.g. 'no Slack', 'skip the badge'), pass those as skipKeywords so they aren't done. Then summarize what was done vs. left for the team.",
    inputSchema: z.object({
      hireId: z
        .string()
        .describe(
          'The hire id to run onboarding tasks for (from createOnboardingPlan)',
        ),
      skipKeywords: z
        .array(z.string())
        .optional()
        .describe(
          "Lowercase keywords of tasks to NOT do, from the user's adjustments, e.g. ['slack','badge'].",
        ),
    }),
    callback: async ({hireId, skipKeywords}) => {
      const report = await onboarding.executeForHire(hireId, {skipKeywords});
      return {
        hireId: report.hireId,
        automated: report.automated,
        skipped: report.skipped,
        actions: report.executions.map((e) => ({
          task: e.title,
          team: e.ownerTeam,
          outcome: e.outcome,
          detail: e.detail,
        })),
      };
    },
  });

  const previewOffboarding = tool({
    name: 'previewOffboarding',
    description:
      'Read-only. Show what offboarding a hire would reclaim: their active/idle software seats (recurring monthly cost recovered) and assigned hardware (residual value credited back). Changes nothing. ALWAYS call this first and show the user the seats, assets, and totals before any offboarding. Look up the hire id by name via searchCandidateRecords (a published candidate has a hireId) or by the hire name.',
    inputSchema: z.object({
      hireName: z
        .string()
        .optional()
        .describe('The hire name to preview offboarding for'),
      hireId: z.string().optional().describe('The hire id, if known'),
    }),
    callback: async ({hireName, hireId}) => {
      const id = hireId ?? (await resolveHireId(repo, hireName ?? ''));
      if (!id) return {error: `No hire found for "${hireName ?? hireId}"`};
      const p = await offboarding.preview(id);
      return {
        hireId: p.hireId,
        hireName: p.hireName,
        seats: p.seats.map((s) => ({app: s.appName, monthly: s.monthly})),
        assets: p.assets.map((a) => ({
          name: a.name,
          serial: a.serialTag,
          residual: Math.round(a.residual),
        })),
        monthlyRecovered: Math.round(p.monthlyRecovered),
        oneTimeRecovered: Math.round(p.oneTimeRecovered),
        nothingToReclaim: p.nothingToReclaim,
      };
    },
  });

  const executeOffboarding = tool({
    name: 'executeOffboarding',
    description:
      "DESTRUCTIVE. Revoke the hire's software seats and return their hardware (recovers spend; writes crediting ledger entries). NEVER call this until you have (1) called previewOffboarding, (2) shown the user exactly what will be reclaimed, and (3) received an explicit yes/confirm to proceed. You MUST pass confirmed=true, which you may only set after the user confirms. If you are not certain the user confirmed, call previewOffboarding instead and ask.",
    inputSchema: z.object({
      hireId: z
        .string()
        .describe('The hire id to offboard (from previewOffboarding)'),
      confirmed: z
        .boolean()
        .describe(
          'Must be true, and only after the user explicitly confirmed the destructive action',
        ),
    }),
    callback: async ({hireId, confirmed}) => {
      if (!confirmed) {
        return {
          refused: true,
          message:
            'Not confirmed. Show the previewOffboarding result and ask the user to confirm before executing.',
        };
      }
      const r = await offboarding.execute(hireId);
      return {
        hireId: r.hireId,
        hireName: r.hireName,
        revokedSeats: r.revokedSeatIds.length,
        returnedAssets: r.returnedAssetIds.length,
        monthlyRecovered: Math.round(r.monthlyRecovered),
        oneTimeRecovered: Math.round(r.oneTimeRecovered),
      };
    },
  });

  return [
    searchCandidateRecords,
    createOnboardingPlan,
    executeOnboardingTasks,
    previewOffboarding,
    executeOffboarding,
  ];
}

/** Resolve a hire id from a name (exact-ish, case-insensitive). */
async function resolveHireId(
  repo: Repository,
  name: string,
): Promise<string | null> {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const hires = await repo.hires.list();
  const exact = hires.find((h) => h.name.toLowerCase() === q);
  if (exact) return exact.id;
  const partial = hires.find((h) => h.name.toLowerCase().includes(q));
  return partial?.id ?? null;
}

/** True when Strands debug logging is requested via env. */
function strandsDebugOn(): boolean {
  return (
    process.env.GENIE_DEBUG === '1' ||
    process.env.GENIE_DEBUG === 'true' ||
    process.env.STRANDS_DEBUG === '1' ||
    process.env.STRANDS_DEBUG === 'true'
  );
}

/** Build the live Strands agent (Bedrock-backed). Throws if creds are absent. */
export async function buildGenieAgent(): Promise<Agent> {
  configureStrandsDebug();
  const tools = await buildTools();
  return new Agent({
    model: MODEL_ID,
    systemPrompt: GENIE_SYSTEM_PROMPT,
    tools,
    // Stream the agent loop to the console when debugging; silent otherwise.
    printer: strandsDebugOn(),
  });
}

export interface GenieReply {
  /** Assistant text to show the user. */
  message: string;
  /** How the reply was produced — surfaced in the UI as a small badge. */
  engine: 'strands-bedrock' | 'scripted';
  /**
   * The pending onboarding plan after this turn (or null if none is in play).
   * The client holds it and sends it back next turn so adjustments persist.
   */
  plan?: PendingPlan | null;
  /** A previewed-but-unconfirmed offboard, carried across turns. */
  offboard?: PendingOffboard | null;
}

/** One prior turn of the conversation, oldest first. */
export interface GenieHistoryTurn {
  role: 'user' | 'genie';
  text: string;
}

/** A destructive offboard awaiting the user's explicit confirmation. */
export interface PendingOffboard {
  hireId: string;
  hireName: string;
}

export interface GenieTurnInput {
  message: string;
  /** Prior turns (oldest first), so the agent has conversation memory. */
  history?: GenieHistoryTurn[];
  /** The candidate the user has confirmed this session, if any. */
  confirmedCandidateId?: string | null;
  /** The pending plan from the previous turn, if any. */
  plan?: PendingPlan | null;
  /** A previewed offboard waiting on a yes/no, carried across turns. */
  offboard?: PendingOffboard | null;
}

/**
 * Run one user turn. Uses the live Strands agent when Bedrock creds exist;
 * otherwise the scripted planner.
 *
 * The Strands agent is stateless across requests (we rebuild it each turn), so
 * we replay the whole conversation as messages on every invoke — that's what
 * gives it memory and lets a bare "yes" land in context.
 */
export async function runGenieTurn(input: GenieTurnInput): Promise<GenieReply> {
  // Destructive offboarding is gated deterministically server-side, on BOTH
  // engines, so the confirmation never depends on the model threading a hire
  // id correctly. If an offboard was previewed last turn, this turn's yes/no
  // decides it here.
  const gated = await resolveOffboardConfirmation(input);
  if (gated) return gated;

  if (hasBedrockCreds()) {
    try {
      const agent = await buildGenieAgent();
      const messages = toMessages(input.history ?? [], input.message);
      const result = await agent.invoke(messages);
      return {
        message: extractText(result.lastMessage),
        engine: 'strands-bedrock',
        // The live agent manages flow through its tools + conversation; just
        // echo the plan/offboard state back so the client keeps it.
        plan: input.plan ?? null,
        offboard: input.offboard ?? null,
      };
    } catch (err) {
      // Fall through to scripted so a model/credential hiccup never dead-ends
      // the demo. Surface the reason once in the message.
      const r = await scripted(input);
      return {
        message: `${r.message}\n\n_(Live model unavailable: ${(err as Error).message}. Falling back to the built-in planner.)_`,
        engine: 'scripted',
        plan: r.plan,
        offboard: r.offboard ?? null,
      };
    }
  }
  const r = await scripted(input);
  return {
    message: r.message,
    engine: 'scripted',
    plan: r.plan,
    offboard: r.offboard ?? null,
  };
}

/**
 * Deterministic offboarding gate, run before either engine so the destructive
 * action is always controlled by trusted code (never left to the model):
 *   - pending offboard + "yes"  -> execute (revoke seats, return assets)
 *   - pending offboard + "no"   -> cancel
 *   - pending offboard + other  -> re-ask
 *   - "offboard <name>"         -> read-only preview + set pending (await yes/no)
 * Returns null when the turn isn't about offboarding, so normal handling runs.
 */
async function resolveOffboardConfirmation(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  const {offboarding, repo} = await getServices();
  const text = input.message.trim();
  const lower = text.toLowerCase();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const pending = input.offboard ?? null;

  const affirmative =
    /\b(yes|yep|yeah|yup|sure|confirm|do it|go ahead|offboard (?:them|her|him)|proceed)\b/.test(
      lower,
    );
  const negative =
    /\b(no|cancel|stop|don'?t|do not|nevermind|never mind|abort)\b/.test(lower);

  if (pending) {
    if (negative) {
      return {
        message: `Okay — I won't offboard ${pending.hireName}. Nothing changed.`,
        engine,
        offboard: null,
        plan: input.plan ?? null,
      };
    }
    if (affirmative) {
      const r = await offboarding.execute(pending.hireId);
      return {
        message: renderOffboardResult(r),
        engine,
        offboard: null,
        plan: input.plan ?? null,
      };
    }
    return {
      message: `Just to confirm — reply **yes** to offboard ${pending.hireName} (revoke seats + return hardware), or **no** to cancel.`,
      engine,
      offboard: pending,
      plan: input.plan ?? null,
    };
  }

  const name = parseOffboardIntent(text);
  if (!name) return null;

  const hireId = await resolveHireId(repo, name);
  if (!hireId) {
    return {
      message: `I couldn't find a current hire named "${name}". Who should I offboard?`,
      engine,
      offboard: null,
      plan: input.plan ?? null,
    };
  }
  const preview = await offboarding.preview(hireId);
  if (preview.nothingToReclaim) {
    return {
      message: `${preview.hireName} has no active seats or assigned hardware to reclaim — nothing to offboard.`,
      engine,
      offboard: null,
      plan: input.plan ?? null,
    };
  }
  return {
    message: renderOffboardPreview(preview),
    engine,
    offboard: {hireId: preview.hireId, hireName: preview.hireName},
    plan: input.plan ?? null,
  };
}

/** Replay prior turns + the new message as Strands MessageData the model reads. */
function toMessages(
  history: GenieHistoryTurn[],
  message: string,
): {role: 'user' | 'assistant'; content: {text: string}[]}[] {
  const prior = history.map((t) => ({
    role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: [{text: t.text}],
  }));
  return [...prior, {role: 'user', content: [{text: message}]}];
}

// ---- scripted fallback ----------------------------------------------------

function candidateLine(c: Candidate, managerName: string | null): string {
  // Markdown bullet list with bold labels — one field per line.
  return [
    `- **Candidate:** ${c.name}`,
    `- **Role/Title:** ${c.title}${c.roleName ? ` (${c.roleName})` : ' (no role on file)'}`,
    `- **Hiring Manager:** ${managerName ?? '—'}`,
    `- **Resume:** ${c.resumeFile ?? '—'}`,
    `- **Candidate ID:** \`${c.id}\``,
  ].join('\n');
}

function renderChecklist(
  name: string,
  title: string,
  roleName: string | null,
): string {
  const items = defaultChecklist({name, title, roleName});
  const order: ChecklistCategory[] = [
    'day_1_essentials',
    'role_tool_access',
    '30_day_milestones',
  ];
  // Each category is a bold header, blank line, then one bullet per item.
  // Blank lines between blocks are what make Markdown render them separately.
  return order
    .map((cat) => {
      const bullets = items
        .filter((i) => i.category === cat)
        .map((i) => `- ${i.title}`)
        .join('\n');
      return `**${CHECKLIST_CATEGORY_LABEL[cat]}**\n\n${bullets}`;
    })
    .join('\n\n');
}

interface ScriptedResult {
  message: string;
  plan: PendingPlan | null;
  offboard?: PendingOffboard | null;
}

/**
 * Deterministic planner mirroring the scripted workflow. Runs the full
 * search -> confirm -> ADJUST -> publish -> execute beats without a model, and
 * carries a PendingPlan across turns so adjustments ("drop Slack", "add Jira",
 * "she starts March 15") stick.
 */
async function scripted(input: GenieTurnInput): Promise<ScriptedResult> {
  const {candidates, onboarding, repo} = await getServices();
  const text = input.message.trim();
  const lower = text.toLowerCase();
  const apps = await repo.appCatalog.list();
  const plan = input.plan ?? null;

  const affirmative =
    /\b(publish|approve|looks good|go ahead|ship it|confirm|correct|do it|that'?s right|yes|yep|yeah|yup|sure)\b/.test(
      lower,
    );

  // Note: offboarding (preview + destructive confirm) is handled earlier and
  // deterministically in resolveOffboardConfirmation, before this runs.

  // --- With a plan in play, first try to apply an adjustment ---------------
  if (plan) {
    const adjusted = applyAdjustment(plan, text, apps);
    if (adjusted) {
      return {
        message: [
          adjusted.note,
          ``,
          renderPlanSummary(adjusted.plan, apps),
          ``,
          `Reply **publish** when it looks right, or keep adjusting.`,
        ].join('\n'),
        plan: adjusted.plan,
      };
    }

    // Publish + execute, honoring the plan's seats, role, start date, skips.
    if (affirmative) {
      const result = await candidates.publishPlan({
        candidateId: plan.candidateId,
        roleName: plan.roleName ?? undefined,
        appIds: plan.seatAppIds,
        startDate: plan.startDate ?? undefined,
      });
      const report = await onboarding.executeForHire(result.hire.id, {
        skipKeywords: plan.skipTaskKeywords,
      });
      return {
        message: renderExecution(result.hire.name, report, result.portalUrl),
        plan: null,
      };
    }
  }

  // A short affirmative with no plan in play — nudge for a name.
  if (!plan && /^(yes|yep|yeah|yup|sure|ok|okay)\b/.test(lower)) {
    return {
      message: `Happy to help — who are we onboarding? Give me a candidate's name.`,
      plan: null,
    };
  }

  // --- Otherwise treat the message as a candidate search -------------------
  const all = await repo.candidates.list();
  const {confidence, matches} = classifyMatches(all, text);

  if (confidence === 'none') {
    return {
      message: `I couldn't find anyone matching "${text}". Want to try a different spelling, give me just a first or last name, or input the role and hiring manager manually?`,
      plan,
    };
  }

  if (confidence === 'ambiguous') {
    const list = matches
      .map((m) => {
        const c = m.candidate;
        return `- ${c.name} — ${c.title}${c.roleName ? '' : ' (no role on file)'} (id: ${c.id})`;
      })
      .join('\n');
    return {
      message: [
        `I found a few people who could match "${text}" — I want to make sure I onboard the right person:`,
        ``,
        list,
        ``,
        `Which one did you mean? You can reply with the full name or the id.`,
      ].join('\n'),
      plan,
    };
  }

  // Confident single match — build the pending plan and present it.
  const c = matches[0]!.candidate;
  const manager =
    c.hiringManagerId ? await repo.users.get(c.hiringManagerId) : null;
  const built = newPlan({
    candidateId: c.id,
    candidateName: c.name,
    roleName: c.roleName ?? c.title,
    startDate: c.startDate,
  });
  const checklist = renderChecklist(c.name, c.title, c.roleName);
  return {
    message: [
      `Here's who I found:`,
      ``,
      candidateLine(c, manager?.name ?? null),
      ``,
      `Is this the correct candidate you'd like to onboard today? Here's a starting 30-day plan:`,
      ``,
      checklist,
      ``,
      `**Seats I'll grant:** ${seatNames(built.seatAppIds, apps).join(', ') || 'none'}`,
      ``,
      `Reply **publish** to commit and run it, or adjust — e.g. "drop Slack", "add Jira", or "she starts March 15".`,
    ].join('\n'),
    plan: built,
  };
}

/** Pretty seat names for a list of app ids. */
function seatNames(appIds: string[], apps: AppCatalogItem[]): string[] {
  return appIds.map((id) => apps.find((a) => a.id === id)?.name ?? id);
}

/** The seats + skips + role/date summary shown after an adjustment. */
function renderPlanSummary(plan: PendingPlan, apps: AppCatalogItem[]): string {
  const seats = seatNames(plan.seatAppIds, apps).join(', ') || 'none';
  const lines = [
    `**Role:** ${plan.roleName ?? '—'}`,
    `**Start date:** ${plan.startDate ?? '(default)'}`,
    `**Seats I'll grant:** ${seats}`,
  ];
  if (plan.skipTaskKeywords.length) {
    lines.push(`**Skipping:** ${plan.skipTaskKeywords.join(', ')}`);
  }
  return lines.join('\n');
}

/** The publish + execute summary. */
function renderExecution(
  name: string,
  report: {
    automated: number;
    skipped: number;
    executions: {outcome: string; title: string; detail: string}[];
  },
  portalUrl: string,
): string {
  const did = report.executions
    .filter((e) => e.outcome !== 'skipped')
    .map((e) => `- ${e.detail}`);
  const left = report.executions
    .filter((e) => e.outcome === 'skipped')
    .map((e) => `- ${e.title}`);
  const sections = [
    `**${name}'s onboarding is published and running.**`,
    ``,
    `**Automated (${report.automated})**`,
    ``,
    did.length ? did.join('\n') : '- (nothing to automate)',
  ];
  if (left.length) {
    sections.push(
      ``,
      `**Left for the team (${report.skipped})**`,
      ``,
      left.join('\n'),
    );
  }
  sections.push(``, `Onboarding portal: ${portalUrl}`);
  return sections.join('\n');
}

/** Detect an offboarding request and extract the name. Null if not offboarding. */
function parseOffboardIntent(text: string): string | null {
  const lower = text.toLowerCase();
  if (
    !/\b(offboard|off-board|deprovision|de-provision|terminate|is leaving|leaving the company|last day)\b/.test(
      lower,
    )
  ) {
    return null;
  }
  // "offboard Quinn Baker" / "deprovision Quinn" — take the name after the verb.
  const m = text.match(
    /\b(?:offboard|off-board|deprovision|de-provision|terminate)\s+(.+)/i,
  );
  if (m) return m[1]!.replace(/[.?!]+$/, '').trim();
  // "Quinn Baker is leaving" — take the name before the phrase.
  const m2 = text.match(
    /^(.+?)\s+(?:is leaving|leaving the company|last day)/i,
  );
  if (m2) return m2[1]!.trim();
  return null;
}

function money0(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The read-only reclaim preview shown before confirmation. */
function renderOffboardPreview(p: {
  hireName: string;
  seats: {appName: string; monthly: number}[];
  assets: {name: string; serialTag: string; residual: number}[];
  monthlyRecovered: number;
  oneTimeRecovered: number;
}): string {
  const lines = [`**Offboarding ${p.hireName} would reclaim:**`, ``];
  if (p.seats.length) {
    lines.push(`**Seats to revoke**`, ``);
    for (const s of p.seats)
      lines.push(`- ${s.appName} — ${money0(s.monthly)}/mo`);
    lines.push(``);
  }
  if (p.assets.length) {
    lines.push(`**Hardware to return**`, ``);
    for (const a of p.assets)
      lines.push(
        `- ${a.name} (${a.serialTag}) — ${money0(a.residual)} residual`,
      );
    lines.push(``);
  }
  lines.push(
    `**Recovers ${money0(p.monthlyRecovered)}/mo recurring + ${money0(p.oneTimeRecovered)} one-time.**`,
    ``,
    `⚠️ This revokes the seats and returns the hardware. Reply **yes** to offboard ${p.hireName}, or **no** to cancel.`,
  );
  return lines.join('\n');
}

/** The summary after a confirmed offboard. */
function renderOffboardResult(r: {
  hireName: string;
  revokedSeatIds: string[];
  returnedAssetIds: string[];
  monthlyRecovered: number;
  oneTimeRecovered: number;
}): string {
  return [
    `**${r.hireName} offboarded.**`,
    ``,
    `- Revoked ${r.revokedSeatIds.length} seat(s) — ${money0(r.monthlyRecovered)}/mo recovered`,
    `- Returned ${r.returnedAssetIds.length} asset(s) — ${money0(r.oneTimeRecovered)} credited back`,
    ``,
    `Finance will show the recovered spend on the reclaim view.`,
  ].join('\n');
}

interface Adjustment {
  plan: PendingPlan;
  note: string;
}

/**
 * Parse a plan-adjustment request and apply it. Returns null if the message
 * isn't an adjustment (so the caller can fall through to publish/search).
 * Handles: drop/remove a seat, add/grant a seat, skip a task (laptop/badge),
 * change role, set start date.
 */
function applyAdjustment(
  plan: PendingPlan,
  text: string,
  apps: AppCatalogItem[],
): Adjustment | null {
  const lower = text.toLowerCase();

  // Start date: "starts March 15", "start date 2026-03-15".
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (/\bstart|starts|start date\b/.test(lower) && iso) {
    return {
      plan: setStartDate(plan, iso[1]!),
      note: `Set start date to ${iso[1]}.`,
    };
  }

  // Change role: "use the Designer template", "make her a Designer".
  const roleMatch = lower.match(
    /\b(?:role|template|make (?:her|him|them))\b.*?\b(software engineer|engineer|designer|operations|ops)\b/,
  );
  if (roleMatch) {
    const role =
      /design/.test(roleMatch[1]!) ? 'Designer'
      : /ops|operations/.test(roleMatch[1]!) ? 'Operations'
      : 'Software Engineer';
    return {
      plan: setRole(plan, role),
      note: `Switched the role template to ${role}.`,
    };
  }

  const removing =
    /\b(drop|remove|no|without|doesn'?t need|don'?t need|skip|take out|exclude)\b/.test(
      lower,
    );
  const adding = /\b(add|also|include|grant|give (?:her|him|them)?)\b/.test(
    lower,
  );

  // Skip a hardware/admin task by keyword.
  for (const kw of ['laptop', 'badge', 'monitor', 'headset', 'phone']) {
    if (lower.includes(kw)) {
      if (removing) {
        return {plan: skipTask(plan, kw), note: `Okay, I'll skip the ${kw}.`};
      }
      if (adding) {
        return {plan: includeTask(plan, kw), note: `Added the ${kw} back in.`};
      }
    }
  }

  // Add/remove a software seat by app name.
  const appId = resolveSeatRef(text, apps);
  if (appId) {
    const app = apps.find((a) => a.id === appId);
    const name = app?.name ?? appId;
    if (removing) {
      // Drop the seat AND skip the matching "Grant X seat" task so the
      // executor doesn't grant it anyway. Skip by the app's first word
      // (e.g. "slack", "github", "google") which appears in the task title.
      const kw = (name.split(/\s+/)[0] ?? name).toLowerCase();
      return {
        plan: skipTask(removeSeat(plan, appId), kw),
        note: `Removed the ${name} seat.`,
      };
    }
    if (adding) {
      const kw = (name.split(/\s+/)[0] ?? name).toLowerCase();
      return {
        plan: includeTask(addSeat(plan, appId), kw),
        note: `Added a ${name} seat.`,
      };
    }
  }

  return null;
}

/** Find an app the message is referring to (ignoring the verb words). */
function resolveSeatRef(text: string, apps: AppCatalogItem[]): string | null {
  // Try the whole message first, then each catalog app by name presence.
  const direct = resolveAppId(text, apps);
  if (direct) return direct;
  const lower = text.toLowerCase();
  for (const a of apps) {
    if (lower.includes(a.name.toLowerCase()) || lower.includes(a.id))
      return a.id;
  }
  return null;
}

function extractText(message: unknown): string {
  // AgentResult.lastMessage is a Message with content blocks. Pull text blocks.
  const content = (message as {content?: Array<{text?: string}>})?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  if (typeof message === 'string') return message;
  return '';
}
