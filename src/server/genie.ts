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
import type {OffboardPreview, OffboardResult} from '@/lib/offboarding';
import {monthlyCost} from '@/lib/finance';
import {
  classifyConfirmation,
  parseCreateTemplateIntent,
  parseListCandidatesIntent,
  parseListTemplatesIntent,
  parseOffboardIntent,
  parseRemoveSeatIntent,
  parseViewIntent,
} from '@/lib/intent';
import {
  getCompanyInfo,
  getHireStatus,
  getManagerCandidates,
  getManagerForHire,
  getManagerHireDetail,
  getManagerHires,
  getMyRoleInfo,
  getOnboardingNorms,
  type HireStatusSummary,
} from '@/server/queries';
import {
  ADMIN_GREETING,
  ADMIN_SYSTEM_PROMPT,
  allowsPreHandler,
  capabilitiesFor,
  greetingFor,
  promptFor,
  type GeniePreHandler,
  type GenieRole,
} from '@/lib/genie-access';
import type {AppCatalogItem, Candidate} from '@/lib/types';
import type {AiClient} from '@/lib/ai';
import type {Repository} from '@/lib/repository';
import type {AppRole} from '@/lib/access';
import {hasBedrockCreds} from '@/lib/bedrock';
import {currentSession} from './auth';
import {getServices} from './store';

/**
 * Scope passed through every turn alongside the role, so tools and the scripted
 * path operate within the signed-in user's data boundary. Resolved from the
 * session in the route (never from the client).
 */
export interface GenieScopeInput {
  /** The hire whose checklist an employee is viewing (employee only). */
  hireId: string | null;
  /** The manager user whose hires/candidates a manager may see (manager only). */
  managerUserId: string | null;
}

const DEFAULT_SCOPE: GenieScopeInput = {hireId: null, managerUserId: null};

export {hasBedrockCreds} from '@/lib/bedrock';

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

/**
 * The Genie's persona + scripted workflow. The per-role prompts and greetings
 * now live in `@/lib/genie-access` (one trusted policy table); these aliases
 * keep the original admin constants importable under their old names.
 */
export const GENIE_SYSTEM_PROMPT = ADMIN_SYSTEM_PROMPT;
export const GENIE_GREETING = ADMIN_GREETING;

/** The opening greeting for a given viewing role (what GET /api/genie returns). */
export function greetingForRole(role: GenieRole): string {
  return greetingFor(role);
}

/** The role + data scope for a Genie turn, resolved from the request context. */
export interface GenieContext {
  role: GenieRole;
  scope: GenieScopeInput;
}

/** Map the session's viewing role (AppRole) to a GenieRole. 1:1 today. */
function toGenieRole(viewAs: AppRole): GenieRole {
  switch (viewAs) {
    case 'manager':
      return 'manager';
    case 'employee':
      return 'employee';
    case 'admin':
    default:
      return 'admin';
  }
}

/**
 * Resolve the Genie role + scope from the signed session. The role is the
 * viewing role; the scope carries the employee's own hireId, and — for a
 * manager — the manager user's id so their tools filter to their own hires.
 * No session (shouldn't happen behind the auth gate) falls back to the
 * least-privileged employee with an empty scope.
 */
export async function resolveGenieContext(): Promise<GenieContext> {
  const session = await currentSession();
  if (!session) {
    return {role: 'employee', scope: {hireId: null, managerUserId: null}};
  }
  const role = toGenieRole(session.viewAs);

  let managerUserId: string | null = null;
  if (role === 'manager') {
    // The session identifies the viewing role, not a user row. Resolve the
    // manager user so manager tools can filter hires/candidates by ownership.
    // (The demo seeds a single manager; a real IdP would put the id on the
    // session.)
    const {repo} = await getServices();
    const [manager] = await repo.users.where((u) => u.role === 'manager');
    managerUserId = manager?.id ?? null;
  }

  return {
    role,
    scope: {
      hireId: role === 'employee' ? session.hireId : null,
      managerUserId,
    },
  };
}

/** Default Bedrock model id (Strands default provider). */
const MODEL_ID =
  process.env.GENIE_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6';

/**
 * Build the Genie's Strands tools for a role, bound to the shared services and
 * scoped to the signed-in user. Only the tools the role's policy
 * (`capabilitiesFor`) allows are constructed and returned, so an agent can
 * never be handed a capability outside its scope. Admin gets today's full set;
 * manager gets read-only, own-hires tools; employee gets self/company reads.
 */
async function buildTools(role: GenieRole, scope: GenieScopeInput) {
  const {candidates, onboarding, offboarding, ai, repo} = await getServices();
  const allowed = new Set<string>(capabilitiesFor(role).tools);

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
      "Actually carry out a hire's onboarding tasks that can be automated: grant software seats (GitHub, Slack, etc.), order a laptop, issue an access badge, and provision email/SSO. Each automated task is marked done and its real spend hits the ledger. Tasks that need a person (manager 1-on-1s, training, goal-setting) are reported as skipped. HARDWARE OUT OF STOCK: if there's no laptop/badge on hand, that task comes back with outcome 'deferred' — nothing was bought and nothing hit the ledger; you MUST tell the user plainly that you couldn't provision that item because it's out of stock, and leave it for the team. Never claim a deferred item was ordered. Call this after a plan is published, using the hireId returned by createOnboardingPlan. If the user asked to leave something out (e.g. 'no Slack', 'skip the badge'), pass those as skipKeywords so they aren't done. Then summarize what was done, what's out of stock, and what's left for the team.",
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
        deferred: report.deferred,
        skipped: report.skipped,
        // When outcome is "deferred" the hardware was out of stock: nothing was
        // bought and the task is left blocked. Tell the user plainly what
        // couldn't be provisioned instead of claiming it's done.
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

  const viewHireStatus = tool({
    name: 'viewHireStatus',
    description:
      "Read-only. Pull up a hire's current onboarding status and what they hold — task progress, the software seats granted (with $/mo), and the hardware assigned. Use when the user wants to SEE or look up a person (e.g. 'pull up Nora', 'what does Sam have', 'how's Quinn doing'), NOT to start onboarding. Look up by hire name or id. Writes nothing.",
    inputSchema: z.object({
      hireName: z.string().optional().describe('The hire name to look up'),
      hireId: z.string().optional().describe('The hire id, if known'),
    }),
    callback: async ({hireName, hireId}) => {
      const id = hireId ?? (await resolveHireId(repo, hireName ?? ''));
      if (!id) return {error: `No hire found for "${hireName ?? hireId}"`};
      const s = await getHireStatus(id);
      if (!s) return {error: `No hire found for "${hireName ?? hireId}"`};
      return {
        hireName: s.name,
        role: s.roleName,
        startDate: s.startDate,
        manager: s.managerName,
        offboarding: s.offboarding,
        status: s.status,
        tasksDone: s.done,
        tasksTotal: s.total,
        nextTask: s.nextTask,
        software: s.seats.map((seat) => ({
          app: seat.app,
          status: seat.status,
          monthly: Math.round(seat.monthly),
        })),
        hardware: s.assets.map((a) => ({
          name: a.name,
          serial: a.serialTag,
          residual: Math.round(a.residual),
        })),
        monthlyRecurring: Math.round(s.monthlyRecurring),
      };
    },
  });

  const draftWelcomeBrief = tool({
    name: 'draftWelcomeBrief',
    description:
      "Draft a thorough welcome brief for a hire: one welcome, what's already set up (accounts, seats, hardware), anything still pending, and a 30-day timeline — NOT a separate welcome per tool. Call this AFTER executeOnboardingTasks so the state is real, using the hireId from createOnboardingPlan. Returns heading/body blurbs to share with the new hire. Read-only — writes nothing.",
    inputSchema: z.object({
      hireId: z.string().describe('The hire id to draft a welcome brief for'),
    }),
    callback: async ({hireId}) => {
      const hire = await repo.hires.get(hireId);
      if (!hire) return {error: `No hire found for "${hireId}"`};
      const [licenses, apps, assets, assetCatalog, tasks] = await Promise.all([
        repo.licenses.where(
          (l) => l.hireId === hireId && l.status === 'active',
        ),
        repo.appCatalog.list(),
        repo.assets.where((a) => a.assignedToHireId === hireId),
        repo.assetCatalog.list(),
        repo.tasks.where((t) => t.hireId === hireId),
      ]);
      const nameById = new Map(apps.map((a) => [a.id, a.name]));
      const appNames = licenses
        .map((l) => nameById.get(l.appId))
        .filter((n): n is string => Boolean(n));
      const assetNameById = new Map(assetCatalog.map((a) => [a.id, a.name]));
      const hardwareNames = assets
        .filter((a) => a.status === 'assigned')
        .map((a) => assetNameById.get(a.catalogId))
        .filter((n): n is string => Boolean(n));
      const completedSetup = tasks
        .filter(
          (t) =>
            t.status === 'done' &&
            t.appId === null &&
            t.costType !== 'one_time',
        )
        .map((t) => t.title);
      const pending = tasks
        .filter((t) => t.status === 'blocked')
        .map((t) => t.title);
      const blurbs = await ai.draftBrief({
        hireName: hire.name,
        appNames,
        roleName: hire.roleName,
        startDate: hire.startDate,
        hardwareNames,
        completedSetup,
        pending,
      });
      return {hireName: hire.name, blurbs};
    },
  });

  // ---- Manager tools (read-only, scoped to this manager's own hires) ------

  const managerUserId = scope.managerUserId;

  const listMyHires = tool({
    name: 'listMyHires',
    description:
      "List the hires this manager owns, with each hire's onboarding progress (tasks done/total, status, next task). Read-only. No costs. Use for 'show my hires', 'how's my team doing'.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!managerUserId) return {hires: [], note: 'No manager in scope.'};
      const rows = await getManagerHires(managerUserId);
      return {count: rows.length, hires: rows};
    },
  });

  const viewMyHireDetail = tool({
    name: 'viewMyHireDetail',
    description:
      "Pull up one of THIS MANAGER'S hires in detail: onboarding progress, the software seats they hold, and the hardware assigned — plus role, start date, and manager. Read-only and COST-FREE (no dollar amounts). Refuses hires this manager doesn't own. Look up by hire name.",
    inputSchema: z.object({
      hireName: z.string().describe("The hire's name to look up"),
    }),
    callback: async ({hireName}) => {
      if (!managerUserId) return {error: 'No manager in scope.'};
      const id = await resolveOwnedHireId(repo, managerUserId, hireName);
      if (!id)
        return {
          error: `No hire named "${hireName}" on your team.`,
        };
      const detail = await getManagerHireDetail(managerUserId, id);
      if (!detail) return {error: `No hire named "${hireName}" on your team.`};
      return detail;
    },
  });

  const listMyCandidates = tool({
    name: 'listMyCandidates',
    description:
      "List candidates relevant to THIS MANAGER: those whose hiring manager is them, plus candidates for roles the manager is already hiring for. Returns name, title, role, and start date. Read-only, no costs. Use for 'which candidates match my open roles', 'who am I hiring'.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!managerUserId) return {candidates: [], note: 'No manager in scope.'};
      const rows = await getManagerCandidates(managerUserId);
      return {count: rows.length, candidates: rows};
    },
  });

  // ---- Employee tools (read-only, self + company; strictly cost-free) -----

  const myHireId = scope.hireId;

  const getCompanyInfoTool = tool({
    name: 'getCompanyInfo',
    description:
      'Get basic public facts about the company the new hire is joining: name, size, and industry. Read-only. No costs.',
    inputSchema: z.object({}),
    callback: async () => {
      const info = await getCompanyInfo();
      return info ?? {error: 'Company info is not available right now.'};
    },
  });

  const getMyRoleInfoTool = tool({
    name: 'getMyRoleInfo',
    description:
      "Get THIS new hire's own role and what to expect: their role/title, start date, manager, and their cost-free onboarding checklist (task titles + whether each is done). Only ever returns this one hire — never anyone else. No costs.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!myHireId)
        return {error: "I don't have your onboarding record linked yet."};
      const info = await getMyRoleInfo(myHireId);
      return info ?? {error: "I couldn't find your onboarding record."};
    },
  });

  const getMyManagerTool = tool({
    name: 'getMyManager',
    description:
      "Get THIS new hire's manager — just name and work email, if one is assigned. Only this hire's manager, nobody else. No costs.",
    inputSchema: z.object({}),
    callback: async () => {
      if (!myHireId) return {manager: null, note: 'No hire record in scope.'};
      const mgr = await getManagerForHire(myHireId);
      return mgr ? {manager: mgr} : {manager: null};
    },
  });

  const getOnboardingNormsTool = tool({
    name: 'getOnboardingNorms',
    description:
      'Get general onboarding norms: roughly how long onboarding takes (in days) and the standard 30/60/90-day milestones. General company guidance, not about any specific person. No costs.',
    inputSchema: z.object({}),
    callback: async () => getOnboardingNorms(),
  });

  // Assemble the full set, then hand back only what this role's policy allows.
  const byName = {
    searchCandidateRecords,
    createOnboardingPlan,
    executeOnboardingTasks,
    previewOffboarding,
    executeOffboarding,
    draftWelcomeBrief,
    viewHireStatus,
    listMyHires,
    viewMyHireDetail,
    listMyCandidates,
    getCompanyInfo: getCompanyInfoTool,
    getMyRoleInfo: getMyRoleInfoTool,
    getMyManager: getMyManagerTool,
    getOnboardingNorms: getOnboardingNormsTool,
  };

  return Object.entries(byName)
    .filter(([name]) => allowed.has(name))
    .map(([, t]) => t);
}

/**
 * Resolve a hire name to an id, but only among the hires a given manager owns.
 * Fails closed: a name that resolves to another manager's hire returns null.
 */
async function resolveOwnedHireId(
  repo: Repository,
  managerUserId: string,
  name: string,
): Promise<string | null> {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const hires = await repo.hires.where((h) => h.managerId === managerUserId);
  const exact = hires.filter((h) => h.name.toLowerCase() === q);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null; // ambiguous — let the caller re-ask
  const partial = hires.filter((h) => h.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0]!.id : null;
}

/** Resolve a hire id from a name (exact-ish, case-insensitive). */
async function resolveHireId(
  repo: Repository,
  name: string,
): Promise<string | null> {
  const res = await resolveHire(repo, name);
  return res.kind === 'one' ? res.id : null;
}

/** A hire-name lookup that distinguishes no match, one match, and several. */
type HireLookup =
  | {kind: 'none'}
  | {kind: 'one'; id: string; name: string}
  | {kind: 'many'; matches: {id: string; name: string}[]};

/**
 * Resolve a hire name to exactly one hire, or report ambiguity so the caller
 * can ask the user to disambiguate instead of silently picking the first.
 * Exact (case-insensitive) wins outright; otherwise substring matches are
 * collected and "many" is returned when more than one survives.
 */
async function resolveHire(
  repo: Repository,
  name: string,
): Promise<HireLookup> {
  const q = name.trim().toLowerCase();
  if (!q) return {kind: 'none'};
  const hires = await repo.hires.list();

  const exact = hires.filter((h) => h.name.toLowerCase() === q);
  if (exact.length === 1)
    return {kind: 'one', id: exact[0]!.id, name: exact[0]!.name};
  if (exact.length > 1)
    return {
      kind: 'many',
      matches: exact.map((h) => ({id: h.id, name: h.name})),
    };

  const partial = hires.filter((h) => h.name.toLowerCase().includes(q));
  if (partial.length === 0) return {kind: 'none'};
  if (partial.length === 1)
    return {kind: 'one', id: partial[0]!.id, name: partial[0]!.name};
  return {
    kind: 'many',
    matches: partial.map((h) => ({id: h.id, name: h.name})),
  };
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

/**
 * Build the live Strands agent (Bedrock-backed) for a role, with that role's
 * system prompt and its allowed, scope-bound tools. Throws if creds are absent.
 */
export async function buildGenieAgent(
  role: GenieRole = 'admin',
  scope: GenieScopeInput = DEFAULT_SCOPE,
): Promise<Agent> {
  configureStrandsDebug();
  const tools = await buildTools(role, scope);
  return new Agent({
    model: MODEL_ID,
    systemPrompt: promptFor(role),
    tools,
    // Stream the agent loop to the console when debugging; silent otherwise.
    printer: strandsDebugOn(),
  });
}

/**
 * A structured recovered-spend card the chat renders as a visual panel next to
 * the prose. Used for the offboard preview (`pending` kind, before confirming)
 * and the confirmed result (`done` kind). Totals are kept as numbers so the UI
 * can format them; `message` still carries a text fallback.
 */
export interface ReclaimCard {
  type: 'reclaim';
  /** `pending` = previewed, awaiting yes/no; `done` = executed. */
  kind: 'pending' | 'done';
  hireName: string;
  seats: {label: string; monthly: number}[];
  assets: {label: string; residual: number}[];
  /** Recurring $/mo recovered by revoking the seats. */
  monthlyRecovered: number;
  /** One-time $ credited back from returned hardware. */
  oneTimeRecovered: number;
}

/**
 * A read-only status card for "pull up a person": where they are in onboarding
 * and what software/hardware they hold. Render-only, like ReclaimCard.
 */
export interface StatusCard {
  type: 'status';
  hireName: string;
  roleName: string;
  startDate: string;
  managerName: string | null;
  offboarding: boolean;
  /** Roll-up status label, e.g. "In progress", "Blocked", "Done". */
  statusLabel: string;
  done: number;
  total: number;
  pct: number;
  nextTask: string | null;
  seats: {label: string; status: string; monthly: number}[];
  assets: {label: string; residual: number}[];
  monthlyRecurring: number;
}

/**
 * A simple table of candidates available to onboard, rendered as a card so the
 * user can see the pipeline at a glance ("show me the candidates").
 */
export interface CandidateTableCard {
  type: 'candidates';
  rows: {
    id: string;
    name: string;
    title: string;
    roleName: string | null;
    manager: string | null;
    startDate: string | null;
    onboarded: boolean;
  }[];
}

/**
 * All onboarding templates with the tasks + seats each one applies, rendered as
 * a card so an admin can see what's on offer ("show me the templates").
 */
export interface TemplateTableCard {
  type: 'templates';
  templates: {
    id: string;
    roleName: string;
    tasks: {title: string; detail: string}[];
    monthlyRecurring: number;
  }[];
}

export type GenieCard =
  | ReclaimCard
  | StatusCard
  | CandidateTableCard
  | TemplateTableCard;

/**
 * An in-progress new-template build, carried across turns. The Genie asks for
 * each field one at a time; this holds what's been collected so far and which
 * question is next.
 */
export interface TemplateDraft {
  step: 'role' | 'tasks' | 'seats' | 'confirm';
  roleName: string | null;
  /** Collected task titles (admin/hardware tasks, one per line). */
  taskTitles: string[];
  /** Collected app ids to grant as seats. */
  seatAppIds: string[];
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
  /** An in-progress new-template build, carried across turns. */
  templateDraft?: TemplateDraft | null;
  /**
   * An optional structured card to render alongside the message (recovered
   * spend on offboard). Not round-tripped — it's render-only for this turn.
   */
  card?: GenieCard | null;
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
  /**
   * The signed-in user's viewing role, resolved server-side from the session.
   * Decides which tools, pre-handlers, and prompt this turn uses. Defaults to
   * 'admin' so existing callers (and tests) keep today's full behaviour.
   */
  role?: GenieRole;
  /**
   * The data boundary for this turn, resolved from the session. Employee turns
   * carry their `hireId`; manager turns carry their `managerUserId`. The client
   * never sets this.
   */
  scope?: GenieScopeInput;
  /** Prior turns (oldest first), so the agent has conversation memory. */
  history?: GenieHistoryTurn[];
  /** The candidate the user has confirmed this session, if any. */
  confirmedCandidateId?: string | null;
  /** The pending plan from the previous turn, if any. */
  plan?: PendingPlan | null;
  /** A previewed offboard waiting on a yes/no, carried across turns. */
  offboard?: PendingOffboard | null;
  /** An in-progress template build from the previous turn, if any. */
  templateDraft?: TemplateDraft | null;
}

/** Resolve the effective role for a turn, defaulting to admin (full access). */
function roleOf(input: GenieTurnInput): GenieRole {
  return input.role ?? 'admin';
}

/** Resolve the effective scope for a turn. */
function scopeOf(input: GenieTurnInput): GenieScopeInput {
  return input.scope ?? DEFAULT_SCOPE;
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
  const role = roleOf(input);
  const scope = scopeOf(input);
  const may = (handler: GeniePreHandler) => allowsPreHandler(role, handler);

  // The deterministic pre-handlers below run trusted, mutating/cost-bearing
  // flows (template builder, offboard gate, candidate list, seat removal,
  // status lookup). Each is gated by the role's policy so a manager or employee
  // can never reach a path outside their scope — on EITHER engine.

  // Building a new template is a multi-step, one-question-at-a-time flow run
  // deterministically on BOTH engines. If a draft is already in play, this
  // turn feeds it; "create a template" with no draft starts one. Highest
  // priority so a reply like "github, slack" lands in the builder, not search.
  if (may('templateBuilder')) {
    const templating = await resolveTemplateBuilder(input);
    if (templating) return templating;
  }

  // "show me the templates" -> a read-only card of every role template with the
  // tasks + seats it applies. Available to the role that can build templates.
  if (may('listTemplates') && !input.templateDraft) {
    const templates = await resolveListTemplates(input);
    if (templates) return templates;
  }

  // Destructive offboarding is gated deterministically server-side, on BOTH
  // engines, so the confirmation never depends on the model threading a hire
  // id correctly. If an offboard was previewed last turn, this turn's yes/no
  // decides it here.
  if (may('offboard')) {
    const gated = await resolveOffboardConfirmation(input);
    if (gated) return gated;
  }

  // No plan/offboard in play: handle the read-only lookups + direct actions
  // deterministically so they don't get mistaken for an onboarding search.
  if (!input.plan && !input.offboard) {
    // "show me the candidates" -> a table card of who's available to onboard.
    if (may('listCandidates')) {
      const listed = await resolveListCandidates(input);
      if (listed) return listed;
    }

    // "revoke Nora's Figma seat" -> real revoke (reclaim from the chat).
    if (may('removeSeat')) {
      const removed = await resolveRemoveSeat(input);
      if (removed) return removed;
    }

    // "pull up Nora" -> read-only status card (admin only; managers use their
    // own scoped tools, employees never look up other people).
    if (may('viewStatus')) {
      const viewed = await resolveViewRequest(input);
      if (viewed) return viewed;
    }
  }

  if (hasBedrockCreds()) {
    try {
      const agent = await buildGenieAgent(role, scope);
      const messages = toMessages(input.history ?? [], input.message);
      const result = await agent.invoke(messages);
      return {
        message: extractText(result.lastMessage),
        engine: 'strands-bedrock',
        // The live agent manages flow through its tools + conversation; just
        // echo the plan/offboard state back so the client keeps it.
        plan: input.plan ?? null,
        offboard: input.offboard ?? null,
        templateDraft: input.templateDraft ?? null,
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
        templateDraft: input.templateDraft ?? null,
      };
    }
  }
  const r = await scripted(input);
  return {
    message: r.message,
    engine: 'scripted',
    plan: r.plan,
    offboard: r.offboard ?? null,
    templateDraft: input.templateDraft ?? null,
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
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const pending = input.offboard ?? null;

  if (pending) {
    const decision = classifyConfirmation(text);
    if (decision === 'negative') {
      return {
        message: `Okay — I won't offboard ${pending.hireName}. Nothing changed.`,
        engine,
        offboard: null,
        plan: input.plan ?? null,
      };
    }
    if (decision === 'affirmative') {
      const r = await offboarding.execute(pending.hireId);
      return {
        message: renderOffboardResult(r),
        engine,
        offboard: null,
        plan: input.plan ?? null,
        card: reclaimCardFromResult(r),
      };
    }
    // Unclear — re-ask rather than guess on a destructive action.
    return {
      message: `Just to confirm — reply **yes** to offboard ${pending.hireName} (revoke seats + return hardware), or **no** to cancel.`,
      engine,
      offboard: pending,
      plan: input.plan ?? null,
    };
  }

  const name = parseOffboardIntent(text);
  if (!name) return null;

  const lookup = await resolveHire(repo, name);
  if (lookup.kind === 'none') {
    return {
      message: `I couldn't find a current hire named "${name}". Who should I offboard?`,
      engine,
      offboard: null,
      plan: input.plan ?? null,
    };
  }
  if (lookup.kind === 'many') {
    const list = lookup.matches.map((m) => `- ${m.name}`).join('\n');
    return {
      message: [
        `More than one current hire matches "${name}":`,
        ``,
        list,
        ``,
        `Which one should I offboard? Reply with the full name.`,
      ].join('\n'),
      engine,
      offboard: null,
      plan: input.plan ?? null,
    };
  }
  const preview = await offboarding.preview(lookup.id);
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
    card: reclaimCardFromPreview(preview),
  };
}

/**
 * Deterministic read-only lookup: "pull up Nora", "show me Sam's status",
 * "what does Quinn have". Resolves the name against published hires first
 * (status card), then unonboarded candidates (offer to onboard). Returns null
 * when the turn isn't a lookup, so normal handling runs.
 */
async function resolveViewRequest(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  const name = parseViewIntent(input.message);
  if (!name) return null;

  const {repo} = await getServices();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const base = {engine, plan: null, offboard: null} as const;

  // Published hires first — those are the people with a live onboarding status.
  const lookup = await resolveHire(repo, name);
  if (lookup.kind === 'many') {
    const list = lookup.matches.map((m) => `- ${m.name}`).join('\n');
    return {
      ...base,
      message: [
        `More than one person matches "${name}":`,
        ``,
        list,
        ``,
        `Which one? Reply with the full name.`,
      ].join('\n'),
    };
  }
  if (lookup.kind === 'one') {
    const status = await getHireStatus(lookup.id);
    if (status) {
      return {
        ...base,
        message: renderStatusSummary(status),
        card: statusCardFrom(status),
      };
    }
  }

  // Not a published hire — maybe a candidate who hasn't been onboarded yet.
  const all = await repo.candidates.list();
  const {confidence, matches} = classifyMatches(all, name);
  if (confidence === 'confident' && matches[0]) {
    const c = matches[0].candidate;
    return {
      ...base,
      message: [
        `**${c.name}** is a candidate (${c.title}) but hasn't been onboarded yet, so there's no onboarding status or tools to show.`,
        ``,
        `Want me to onboard them? Just say "onboard ${c.name}".`,
      ].join('\n'),
    };
  }

  return {
    ...base,
    message: `I couldn't find anyone named "${name}" to pull up. Try a different spelling, or a first or last name.`,
  };
}

/**
 * Deterministic "show me the templates" handler. Lists every onboarding
 * template with the tasks + seats it applies, as a card. Read-only. Returns
 * null when the message isn't a list-templates request.
 */
async function resolveListTemplates(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  if (!parseListTemplatesIntent(input.message)) return null;

  const {repo} = await getServices();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const base = {engine, plan: null, offboard: null} as const;

  const [templates, templateTasks, apps] = await Promise.all([
    repo.templates.list(),
    repo.templateTasks.list(),
    repo.appCatalog.list(),
  ]);

  if (templates.length === 0) {
    return {
      ...base,
      message: `There are no templates yet. Say "create a template" and I'll build one with you.`,
    };
  }

  const appNameById = new Map(apps.map((a) => [a.id, a.name]));
  const sorted = [...templates].sort((a, b) =>
    a.roleName.localeCompare(b.roleName),
  );

  const cards = sorted.map((t) => {
    const tasks = templateTasks.filter((tt) => tt.templateId === t.id);
    let monthlyRecurring = 0;
    const taskRows = tasks.map((tt) => {
      if (tt.costType === 'recurring') monthlyRecurring += tt.cost;
      const app = tt.appId ? appNameById.get(tt.appId) : null;
      const cost =
        tt.costType === 'recurring' ? `${money0(tt.cost)}/mo`
        : tt.costType === 'one_time' ? money0(tt.cost)
        : '';
      const detail = [app ? `grants ${app}` : '', cost]
        .filter(Boolean)
        .join(' · ');
      return {title: tt.title, detail};
    });
    return {
      id: t.id,
      roleName: t.roleName,
      tasks: taskRows,
      monthlyRecurring,
    };
  });

  return {
    ...base,
    message: `We have ${templates.length} onboarding template${templates.length === 1 ? '' : 's'}. Here's what each one applies:`,
    card: {type: 'templates', templates: cards},
  };
}

/**
 * Deterministic new-template builder. Walks the user through creating a role
 * template one question at a time (role -> tasks -> seats -> confirm), carrying
 * a TemplateDraft across turns. On confirmation it persists the template via
 * TemplateService.createTemplate. Returns null when the turn isn't about
 * building a template (no draft in play and not a "create template" request).
 */
async function resolveTemplateBuilder(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  const draft = input.templateDraft ?? null;
  const text = input.message.trim();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const base = {engine, plan: null, offboard: null} as const;

  // No draft yet: only start one if the user explicitly asked to.
  if (!draft) {
    if (!parseCreateTemplateIntent(text)) return null;
    return {
      ...base,
      message: [
        `Let's build a new onboarding template. I'll ask a few questions.`,
        ``,
        `**1 of 3 — Role name.** What role is this template for? (e.g. "Data Analyst")`,
        ``,
        `Say "cancel" any time to stop.`,
      ].join('\n'),
      templateDraft: {
        step: 'role',
        roleName: null,
        taskTitles: [],
        seatAppIds: [],
      },
    };
  }

  // A draft is in play — let the user bail out cleanly.
  if (/^(cancel|stop|never ?mind|abort|quit)\b/i.test(text)) {
    return {
      ...base,
      message: `Okay — I've scrapped that template. Nothing was saved.`,
      templateDraft: null,
    };
  }

  const {repo, templates} = await getServices();
  const apps = await repo.appCatalog.list();

  if (draft.step === 'role') {
    const roleName = text.replace(/[.?!]+$/, '').trim();
    if (!roleName) {
      return {
        ...base,
        message: `I need a role name to continue. What role is this template for?`,
        templateDraft: draft,
      };
    }
    const existing = await repo.templates.where(
      (t) => t.roleName.toLowerCase() === roleName.toLowerCase(),
    );
    if (existing.length > 0) {
      return {
        ...base,
        message: `There's already a template for **${roleName}**. Give me a different role name, or say "cancel".`,
        templateDraft: draft,
      };
    }
    return {
      ...base,
      message: [
        `Got it — **${roleName}**.`,
        ``,
        `**2 of 3 — Tasks.** List the onboarding tasks (comma-separated), e.g. "Create email + SSO, Order laptop, Issue access badge". Or say "none" to skip straight to seats.`,
      ].join('\n'),
      templateDraft: {...draft, step: 'tasks', roleName},
    };
  }

  if (draft.step === 'tasks') {
    const taskTitles = /^(none|skip|no)\b/i.test(text) ? [] : splitList(text);
    return {
      ...base,
      message: [
        taskTitles.length ?
          `Added ${taskTitles.length} task${taskTitles.length === 1 ? '' : 's'}.`
        : `No tasks — got it.`,
        ``,
        `**3 of 3 — Software seats.** Which app seats should this role get? (comma-separated, e.g. "GitHub, Slack, Jira"). Available: ${apps.map((a) => a.name).join(', ')}. Or say "none".`,
      ].join('\n'),
      templateDraft: {...draft, step: 'seats', taskTitles},
    };
  }

  if (draft.step === 'seats') {
    const seatAppIds: string[] = [];
    const unresolved: string[] = [];
    if (!/^(none|skip|no)\b/i.test(text)) {
      for (const ref of splitList(text)) {
        const id = resolveSeatRef(ref, apps);
        if (id && !seatAppIds.includes(id)) seatAppIds.push(id);
        else if (!id) unresolved.push(ref);
      }
    }
    const next: TemplateDraft = {...draft, step: 'confirm', seatAppIds};
    const seatNameList =
      seatAppIds.length ? seatNames(seatAppIds, apps).join(', ') : 'none';
    const taskList =
      next.taskTitles.length ?
        next.taskTitles.map((t) => `- ${t}`).join('\n')
      : '- (none)';
    const warn =
      unresolved.length ?
        `\n\nI didn't recognize: ${unresolved.join(', ')} — skipped those.`
      : '';
    return {
      ...base,
      message: [
        `Here's the template I'll create:`,
        ``,
        `**Role:** ${next.roleName}`,
        ``,
        `**Tasks**`,
        taskList,
        ``,
        `**Seats:** ${seatNameList}`,
        warn,
        ``,
        `Reply **create** to save it, or tell me what to change.`,
      ].join('\n'),
      templateDraft: next,
    };
  }

  // step === 'confirm'
  if (
    !/\b(create|save|confirm|yes|yep|do it|looks good|publish|go ahead)\b/i.test(
      text,
    )
  ) {
    // Not a confirmation — nudge, keep the draft so nothing is lost.
    return {
      ...base,
      message: `Reply **create** to save this template, or say "cancel" to discard it.`,
      templateDraft: draft,
    };
  }
  try {
    // Create the template, then add each collected task + seat via the same
    // validated TemplateService.addTask the templates UI uses.
    const template = await templates.createTemplate(draft.roleName ?? '');
    let added = 0;

    // Plain admin/hardware tasks (owner inferred from the title; no cost).
    for (const title of draft.taskTitles) {
      if (!title.trim()) continue;
      await templates.addTask(template.id, {
        title: title.trim(),
        ownerTeam: inferOwnerTeam(title),
      });
      added++;
    }

    // One recurring "Grant <App> seat" task per requested seat.
    for (const appId of draft.seatAppIds) {
      const app = apps.find((a) => a.id === appId);
      if (!app) continue;
      await templates.addTask(template.id, {
        title: `Grant ${app.name} seat`,
        ownerTeam: 'it',
        cost: monthlyCost(app.costPerSeat, app.billing),
        costType: 'recurring',
        appId: app.id,
      });
      added++;
    }

    return {
      ...base,
      message: [
        `Created the **${template.roleName}** template with ${added} task${added === 1 ? '' : 's'}.`,
        ``,
        `You can now onboard someone with it — e.g. "use the ${template.roleName} template for <name>".`,
      ].join('\n'),
      templateDraft: null,
    };
  } catch (err) {
    return {
      ...base,
      message: `I couldn't save that template: ${(err as Error).message}. Say "cancel" to discard, or give me a different role name.`,
      templateDraft: draft,
    };
  }
}

/** Infer the owning team from a task title keyword; defaults to IT. */
function inferOwnerTeam(title: string): import('@/lib/types').Team {
  const t = title.toLowerCase();
  if (/\b(laptop|monitor|headset|phone|hardware|ship|order)\b/.test(t)) {
    return 'vendor';
  }
  if (/\b(badge|desk|building|office|facilit)\b/.test(t)) return 'facilities';
  if (/\b(paperwork|benefits|offer|hr|payroll|i-9|w-?4)\b/.test(t)) return 'hr';
  return 'it';
}

/** Split a comma / "and" / newline separated list into trimmed items. */
function splitList(text: string): string[] {
  return text
    .split(/[,\n]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Deterministic "show me the candidates" handler. Lists candidates still
 * waiting to be onboarded as a table card, so the user can see the pipeline
 * at a glance. Returns null when the message isn't a list request.
 */
async function resolveListCandidates(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  if (!parseListCandidatesIntent(input.message)) return null;

  const {repo} = await getServices();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const base = {engine, plan: null, offboard: null} as const;

  const [candidates, users] = await Promise.all([
    repo.candidates.list(),
    repo.users.list(),
  ]);
  const managerById = new Map(users.map((u) => [u.id, u.name]));

  // The pipeline = candidates not yet converted to a hire. Sort unonboarded
  // first, then by name, so the actionable ones lead.
  const sorted = [...candidates].sort((a, b) => {
    const aDone = a.hireId ? 1 : 0;
    const bDone = b.hireId ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return a.name.localeCompare(b.name);
  });

  const open = sorted.filter((c) => !c.hireId);
  if (candidates.length === 0) {
    return {...base, message: `There are no candidates in the pipeline yet.`};
  }

  const rows = sorted.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    roleName: c.roleName,
    manager:
      c.hiringManagerId ? (managerById.get(c.hiringManagerId) ?? null) : null,
    startDate: c.startDate,
    onboarded: Boolean(c.hireId),
  }));

  const total = rows.length;
  const readyNote =
    open.length === 0 ? `All of them are already onboarded.`
    : open.length === total ?
      `All ${total === 1 ? 'is' : 'are'} ready to onboard — say "onboard <name>" to start one.`
    : `${open.length} ${open.length === 1 ? 'is' : 'are'} ready to onboard; the rest are already underway. Say "onboard <name>" to start one.`;
  const lead = `Here ${total === 1 ? 'is' : 'are'} ${total} candidate${total === 1 ? '' : 's'}. ${readyNote}`;

  return {
    ...base,
    message: lead,
    card: {type: 'candidates', rows},
  };
}

/**
 * Deterministic "revoke this person's seat" handler — the reclaim-from-chat
 * action. Resolves the hire + the app, finds their matching license, and
 * revokes it for real via LicenseService (credits the ledger). Returns null
 * when the message isn't a seat-removal request.
 */
async function resolveRemoveSeat(
  input: GenieTurnInput,
): Promise<GenieReply | null> {
  const intent = parseRemoveSeatIntent(input.message);
  if (!intent) return null;

  const {repo, licenses: licenseService} = await getServices();
  const engine: GenieReply['engine'] =
    hasBedrockCreds() ? 'strands-bedrock' : 'scripted';
  const base = {engine, plan: null, offboard: null} as const;

  const apps = await repo.appCatalog.list();
  const appId = resolveSeatRef(intent.appRef, apps);
  const app = appId ? apps.find((a) => a.id === appId) : undefined;
  if (!app) {
    return {
      ...base,
      message: `I couldn't tell which app you meant by "${intent.appRef}". Try the app name, e.g. "revoke ${intent.hint}'s Figma seat".`,
    };
  }

  const lookup = await resolveHire(repo, intent.hint);
  if (lookup.kind === 'none') {
    return {
      ...base,
      message: `I couldn't find a current hire named "${intent.hint}".`,
    };
  }
  if (lookup.kind === 'many') {
    const list = lookup.matches.map((m) => `- ${m.name}`).join('\n');
    return {
      ...base,
      message: [
        `More than one hire matches "${intent.hint}":`,
        ``,
        list,
        ``,
        `Which one? Reply with the full name and the app, e.g. "revoke <full name>'s ${app.name} seat".`,
      ].join('\n'),
    };
  }

  // Find a live (active/idle/reclaim) seat for this hire + app.
  const held = await repo.licenses.where(
    (l) =>
      l.hireId === lookup.id && l.appId === app.id && l.status !== 'revoked',
  );
  const license = held[0];
  if (!license) {
    return {
      ...base,
      message: `${lookup.name} doesn't have an active ${app.name} seat to revoke.`,
    };
  }

  const monthly = monthlyCost(app.costPerSeat, app.billing);
  await licenseService.revoke(license.id);
  return {
    ...base,
    message: [
      `Revoked ${lookup.name}'s **${app.name}** seat. That credits ${money0(monthly)}/mo back — it'll show on the finance reclaim view.`,
    ].join('\n'),
  };
}

/** The prose lead-in shown above a status card. */
function renderStatusSummary(s: {
  name: string;
  roleName: string;
  offboarding: boolean;
  done: number;
  total: number;
}): string {
  if (s.offboarding) {
    return `Here's **${s.name}** (${s.roleName}) — currently offboarding.`;
  }
  const progress =
    s.total === 0 ?
      'no onboarding tasks yet'
    : `${s.done} of ${s.total} onboarding tasks done`;
  return `Here's where **${s.name}** (${s.roleName}) stands — ${progress}. Details below.`;
}

/** Status roll-up label for the card header. */
const STATUS_LABEL: Record<string, string> = {
  none: 'No tasks',
  todo: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
};

/** Build the render-only status card from a hire-status summary. */
function statusCardFrom(s: HireStatusSummary): StatusCard {
  const pct = s.total === 0 ? 0 : Math.round((s.done / s.total) * 100);
  return {
    type: 'status',
    hireName: s.name,
    roleName: s.roleName,
    startDate: s.startDate,
    managerName: s.managerName,
    offboarding: s.offboarding,
    statusLabel: STATUS_LABEL[s.status] ?? s.status,
    done: s.done,
    total: s.total,
    pct,
    nextTask: s.nextTask,
    seats: s.seats.map((seat) => ({
      label: seat.app,
      status: seat.status,
      monthly: seat.monthly,
    })),
    assets: s.assets.map((a) => ({
      label: `${a.name} (${a.serialTag})`,
      residual: a.residual,
    })),
    monthlyRecurring: s.monthlyRecurring,
  };
}

/** Build the render-only reclaim card from a read-only offboard preview. */
function reclaimCardFromPreview(p: OffboardPreview): ReclaimCard {
  return {
    type: 'reclaim',
    kind: 'pending',
    hireName: p.hireName,
    seats: p.seats.map((s) => ({label: s.appName, monthly: s.monthly})),
    assets: p.assets.map((a) => ({
      label: `${a.name} (${a.serialTag})`,
      residual: a.residual,
    })),
    monthlyRecovered: p.monthlyRecovered,
    oneTimeRecovered: p.oneTimeRecovered,
  };
}

/** Build the render-only reclaim card from a confirmed offboard result. */
function reclaimCardFromResult(r: OffboardResult): ReclaimCard {
  return {...reclaimCardFromPreview(r), kind: 'done'};
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
 * Deterministic employee concierge (no creds, no model). Classifies the
 * message into the handful of things an employee may ask — company, role,
 * manager, onboarding norms — and answers from the cost-free read models. Never
 * returns money, never another person. Anything else gets a warm redirect.
 */
async function scriptedEmployee(
  input: GenieTurnInput,
): Promise<ScriptedResult> {
  const lower = input.message.trim().toLowerCase();
  const scope = scopeOf(input);
  const hireId = scope.hireId;
  const base = {plan: null, offboard: null} as const;

  // Manager / "who do I report to".
  if (/\b(manager|report to|boss|lead|who do i|who's my)\b/.test(lower)) {
    if (!hireId)
      return {
        ...base,
        message: `I don't have your onboarding record linked yet, so I can't look up your manager. Your onboarding specialist can help.`,
      };
    const mgr = await getManagerForHire(hireId);
    return {
      ...base,
      message:
        mgr ?
          `Your manager is **${mgr.name}** (${mgr.email}). They'll help you get settled and set your first goals.`
        : `You don't have a manager assigned yet — your onboarding specialist can sort that out.`,
    };
  }

  // Onboarding norms / timeline.
  if (
    /\b(how long|onboarding take|first (?:few )?weeks?|first (?:30|thirty|60|90) days?|timeline|what happens|milestone|ramp)\b/.test(
      lower,
    )
  ) {
    const norms = await getOnboardingNorms();
    return {
      ...base,
      message: [
        `Onboarding here usually takes around **${norms.averageDays} days** to feel fully up to speed. Here's the shape of it:`,
        ``,
        ...norms.milestones.map((m) => `- ${m}`),
      ].join('\n'),
    };
  }

  // Company info.
  if (
    /\b(company|where do i work|about (?:the )?(?:org|business|place|us)|who (?:are|is) we|industry|how big)\b/.test(
      lower,
    )
  ) {
    const info = await getCompanyInfo();
    return {
      ...base,
      message:
        info ?
          `You're joining **${info.name}** — a ${info.industry.toLowerCase()} company of about ${info.size.toLocaleString('en-US')} people. Glad to have you aboard!`
        : `I don't have the company details handy right now — your onboarding specialist can fill you in.`,
    };
  }

  // Role / "what will I be doing" / "what should I expect".
  if (
    /\b(my role|my job|what (?:will|do|should) i|what am i|expect|title|position|checklist|tasks?)\b/.test(
      lower,
    )
  ) {
    if (!hireId)
      return {
        ...base,
        message: `I don't have your onboarding record linked yet. Your onboarding specialist can get that set up.`,
      };
    const info = await getMyRoleInfo(hireId);
    if (!info)
      return {
        ...base,
        message: `I couldn't find your onboarding record — your onboarding specialist can help.`,
      };
    const upcoming = info.tasks.filter((t) => !t.done).slice(0, 5);
    const lines = [
      `You're joining as a **${info.roleName}**, starting ${info.startDate}.`,
      info.managerName ? `You'll report to **${info.managerName}**.` : ``,
      ``,
      upcoming.length ?
        `Here's what's coming up on your checklist:`
      : `You're all set on your checklist — nice.`,
      ...upcoming.map((t) => `- ${t.title}`),
    ].filter(Boolean);
    return {...base, message: lines.join('\n')};
  }

  // Fallback — stay in scope, warmly.
  return {
    ...base,
    message: [
      `Happy to help you settle in! I can tell you about:`,
      ``,
      `- **the company** you're joining`,
      `- **your role** and what to expect`,
      `- **your manager**`,
      `- **how onboarding usually goes**`,
      ``,
      `What would you like to know?`,
    ].join('\n'),
  };
}

/**
 * Deterministic manager assistant (no creds, no model). Read-only and scoped to
 * the manager's own hires and candidates. Classifies the message into: list my
 * hires, look up one of my hires, or list my candidates. Never costs, never
 * another manager's data.
 */
async function scriptedManager(input: GenieTurnInput): Promise<ScriptedResult> {
  const text = input.message.trim();
  const lower = text.toLowerCase();
  const scope = scopeOf(input);
  const managerUserId = scope.managerUserId;
  const base = {plan: null, offboard: null} as const;

  if (!managerUserId) {
    return {
      ...base,
      message: `I couldn't tell which manager you are, so I can't look up your team. Try signing in again.`,
    };
  }

  // Reject any change/action request up front — managers are read-only here.
  if (
    /\b(onboard|offboard|revoke|grant|publish|order|provision|remove|add|create|delete|change|update)\b/.test(
      lower,
    )
  ) {
    return {
      ...base,
      message: `I'm read-only — I can report on your team, but the onboarding specialist handles any changes. I can show your hires, check on one of them, or list candidates for your roles.`,
    };
  }

  // Candidates for my roles.
  if (
    /\bcandidate|hiring|open roles?|pipeline|recruit\b/.test(lower) ||
    /\bwho am i hiring\b/.test(lower)
  ) {
    const rows = await getManagerCandidates(managerUserId);
    if (rows.length === 0)
      return {
        ...base,
        message: `You don't have any candidates in the pipeline for your roles right now.`,
      };
    const open = rows.filter((r) => !r.onboarded);
    const list = rows
      .map(
        (c) =>
          `- **${c.name}** — ${c.title}${c.roleName ? ` (${c.roleName})` : ''}${c.onboarded ? ' · onboarded' : ''}`,
      )
      .join('\n');
    return {
      ...base,
      message: [
        `Here ${rows.length === 1 ? 'is' : 'are'} ${rows.length} candidate${rows.length === 1 ? '' : 's'} for your roles (${open.length} still open):`,
        ``,
        list,
      ].join('\n'),
    };
  }

  // Look up one of my hires by name.
  const name = parseViewIntent(text);
  if (name) {
    const id = await resolveOwnedHireId(await repoOf(), managerUserId, name);
    if (!id)
      return {
        ...base,
        message: `I couldn't find anyone named "${name}" on your team. I can only see your own hires.`,
      };
    const d = await getManagerHireDetail(managerUserId, id);
    if (!d)
      return {
        ...base,
        message: `I couldn't find anyone named "${name}" on your team.`,
      };
    const sw =
      d.software.length ?
        d.software.map((s) => `- ${s.app} (${s.status})`).join('\n')
      : '- (none yet)';
    const hw =
      d.hardware.length ?
        d.hardware.map((h) => `- ${h.name} (${h.serialTag})`).join('\n')
      : '- (none assigned)';
    return {
      ...base,
      message: [
        `**${d.name}** — ${d.roleName}, starts ${d.startDate}${d.offboarding ? ' · offboarding' : ''}.`,
        `Onboarding: ${d.done} of ${d.total} tasks done${d.nextTask ? ` · up next: ${d.nextTask}` : ''}.`,
        ``,
        `**Software**`,
        sw,
        ``,
        `**Hardware**`,
        hw,
      ].join('\n'),
    };
  }

  // Default: list my hires.
  const rows = await getManagerHires(managerUserId);
  if (rows.length === 0)
    return {...base, message: `You don't have any hires yet.`};
  const list = rows
    .map(
      (h) =>
        `- **${h.name}** — ${h.roleName}, starts ${h.startDate} · ${h.done}/${h.total} tasks${h.nextTask ? ` · next: ${h.nextTask}` : ''}`,
    )
    .join('\n');
  return {
    ...base,
    message: [
      `Here ${rows.length === 1 ? 'is' : 'are'} your ${rows.length} hire${rows.length === 1 ? '' : 's'}:`,
      ``,
      list,
      ``,
      `Ask me "how's <name> doing" for details, or "which candidates match my roles".`,
    ].join('\n'),
  };
}

/** Tiny helper so the manager script can resolve the shared repo once. */
async function repoOf(): Promise<Repository> {
  const {repo} = await getServices();
  return repo;
}

/**
 * Deterministic planner mirroring the scripted workflow. Runs the full
 * search -> confirm -> ADJUST -> publish -> execute beats without a model, and
 * carries a PendingPlan across turns so adjustments ("drop Slack", "add Jira",
 * "she starts March 15") stick.
 */
async function scripted(input: GenieTurnInput): Promise<ScriptedResult> {
  const role = roleOf(input);

  // Non-admin roles get their own deterministic, read-only, cost-free scripts
  // so they work with no Bedrock creds — never the onboarding/publish flow.
  if (role === 'employee') return scriptedEmployee(input);
  if (role === 'manager') return scriptedManager(input);

  const {candidates, onboarding, ai, repo} = await getServices();
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
      // If the role template changed, narrate what the new template applies so
      // the user sees exactly what's coming in with the switch.
      const roleChanged = adjusted.plan.roleName !== plan.roleName;
      const templateBlock =
        roleChanged ?
          await describeTemplate(repo, adjusted.plan.roleName)
        : null;
      return {
        message: [
          adjusted.note,
          ``,
          ...(templateBlock ? [templateBlock, ``] : []),
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
      // Draft a short AI welcome brief from the seats actually granted, so the
      // run ends with something to hand the new hire (BuildPlan §4 draft-brief).
      const welcome = await draftWelcomeBrief(
        ai,
        repo,
        result.hire.id,
        result.hire.name,
      );
      return {
        message:
          renderExecution(result.hire.name, report, result.portalUrl) +
          (welcome ? `\n\n${welcome}` : ''),
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
  const templateBlock = await describeTemplate(repo, built.roleName);
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
      ...(templateBlock ? [templateBlock, ``] : []),
      `**Seats I'll grant:** ${seatNames(built.seatAppIds, apps).join(', ') || 'none'}`,
      ``,
      `Reply **publish** to commit and run it, or adjust — e.g. "drop Slack", "add Jira", or "she starts March 15".`,
    ].join('\n'),
    plan: built,
  };
}

/**
 * Describe the stored template for a role: the exact tasks and seats it will
 * instantiate, so the user knows what's actually being applied (not just the
 * generic checklist). Returns null when there's no matching stored template.
 */
async function describeTemplate(
  repo: Repository,
  roleName: string | null,
): Promise<string | null> {
  if (!roleName) return null;
  const matches = await repo.templates.where(
    (t) => t.roleName.toLowerCase() === roleName.toLowerCase(),
  );
  const template = matches[0];
  if (!template) return null;

  const [tasks, apps] = await Promise.all([
    repo.templateTasks.where((t) => t.templateId === template.id),
    repo.appCatalog.list(),
  ]);
  if (tasks.length === 0) return null;

  const appNameById = new Map(apps.map((a) => [a.id, a.name]));
  const lines = tasks.map((t) => {
    const cost =
      t.costType === 'recurring' ? ` (${money0(t.cost)}/mo)`
      : t.costType === 'one_time' ? ` (${money0(t.cost)})`
      : '';
    const app =
      t.appId ? ` — grants ${appNameById.get(t.appId) ?? t.appId}` : '';
    return `- ${t.title}${app}${cost}`;
  });
  return [`**The ${template.roleName} template applies:**`, ``, ...lines].join(
    '\n',
  );
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
    deferred?: number;
    skipped: number;
    executions: {outcome: string; title: string; detail: string}[];
  },
  portalUrl: string,
): string {
  const did = report.executions
    .filter((e) => e.outcome !== 'skipped' && e.outcome !== 'deferred')
    .map((e) => `- ${e.detail}`);
  const deferred = report.executions
    .filter((e) => e.outcome === 'deferred')
    .map((e) => `- ${e.title} — ${e.detail}`);
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
  if (deferred.length) {
    sections.push(
      ``,
      `**Couldn't provision — out of stock (${deferred.length})**`,
      ``,
      deferred.join('\n'),
      ``,
      `I didn't buy replacements. Hardware is out, so these are left for the team to source and assign.`,
    );
  }
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

/**
 * Draft a short welcome brief from the hire's granted (active) seats via the
 * AiClient, rendered as a Markdown section. Returns null when there are no
 * active seats yet or the AI call fails — the brief is a bonus, never a
 * blocker, so a failure must not break the publish confirmation.
 */
async function draftWelcomeBrief(
  ai: AiClient,
  repo: Repository,
  hireId: string,
  hireName: string,
): Promise<string | null> {
  try {
    const hire = await repo.hires.get(hireId);
    const [licenses, apps, assets, assetCatalog, tasks] = await Promise.all([
      repo.licenses.where((l) => l.hireId === hireId && l.status === 'active'),
      repo.appCatalog.list(),
      repo.assets.where((a) => a.assignedToHireId === hireId),
      repo.assetCatalog.list(),
      repo.tasks.where((t) => t.hireId === hireId),
    ]);
    const nameById = new Map(apps.map((a) => [a.id, a.name]));
    const appNames = licenses
      .map((l) => nameById.get(l.appId))
      .filter((n): n is string => Boolean(n));

    const assetNameById = new Map(assetCatalog.map((a) => [a.id, a.name]));
    const hardwareNames = assets
      .filter((a) => a.status === 'assigned')
      .map((a) => assetNameById.get(a.catalogId))
      .filter((n): n is string => Boolean(n));
    const completedSetup = tasks
      .filter(
        (t) =>
          t.status === 'done' && t.appId === null && t.costType !== 'one_time',
      )
      .map((t) => t.title);
    const pending = tasks
      .filter((t) => t.status === 'blocked')
      .map((t) => t.title);

    // Nothing to brief on yet — no seats, no hardware, no finished setup.
    if (
      appNames.length === 0 &&
      hardwareNames.length === 0 &&
      completedSetup.length === 0
    ) {
      return null;
    }

    const blurbs = await ai.draftBrief({
      hireName,
      appNames,
      roleName: hire?.roleName,
      startDate: hire?.startDate,
      hardwareNames,
      completedSetup,
      pending,
    });
    if (blurbs.length === 0) return null;

    const lines = [`**Welcome brief for ${hireName}**`, ``];
    for (const b of blurbs) lines.push(`- **${b.heading}** — ${b.body}`);
    return lines.join('\n');
  } catch {
    return null;
  }
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
  // The breakdown + totals are shown in the attached reclaim card; keep the
  // prose to the ask so the two don't duplicate each other.
  const seatCount = p.seats.length;
  const assetCount = p.assets.length;
  const parts: string[] = [];
  if (seatCount) parts.push(`${seatCount} seat${seatCount === 1 ? '' : 's'}`);
  if (assetCount)
    parts.push(`${assetCount} asset${assetCount === 1 ? '' : 's'}`);
  return [
    `Here's what offboarding **${p.hireName}** would reclaim — ${parts.join(' and ')}, worth ${money0(p.monthlyRecovered)}/mo recurring + ${money0(p.oneTimeRecovered)} one-time.`,
    ``,
    `Heads up: this revokes the seats and returns the hardware. Reply **yes** to offboard ${p.hireName}, or **no** to cancel.`,
  ].join('\n');
}

/** The summary after a confirmed offboard. */
function renderOffboardResult(r: {
  hireName: string;
  revokedSeatIds: string[];
  returnedAssetIds: string[];
  monthlyRecovered: number;
  oneTimeRecovered: number;
}): string {
  // Totals live in the attached reclaim card; the prose confirms + points on.
  return [
    `**${r.hireName} offboarded.** Revoked ${r.revokedSeatIds.length} seat(s) and returned ${r.returnedAssetIds.length} asset(s).`,
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
