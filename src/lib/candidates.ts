/**
 * Candidate domain — the Onboarding Genie's data layer (pre-hire records).
 *
 * Two concerns:
 *   - searching candidates by name (what `searchCandidateRecords` reads), and
 *   - publishing an onboarding plan: convert a candidate into a `hire`, then
 *     instantiate tasks + licenses from the matching role template.
 *
 * Search is a pure function over records (unit-testable, no DB). Publishing is
 * a thin service over the Repository + TemplateService, reusing the existing
 * import path so the Genie never hand-writes tasks or ledger entries.
 */

import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from './ids';
import type {Repository} from './repository';
import {TemplateService} from './templates';
import type {Candidate, Hire, License, Task} from './types';

/** The three categories the Genie's 30-day checklist is grouped into. */
export type ChecklistCategory =
  | 'day_1_essentials'
  | 'role_tool_access'
  | '30_day_milestones';

export const CHECKLIST_CATEGORY_LABEL: Record<ChecklistCategory, string> = {
  day_1_essentials: 'Day 1 Essentials',
  role_tool_access: 'Role & Tool Access',
  '30_day_milestones': '30-Day Milestones',
};

/** A candidate paired with how well it matched the query (0..1). */
export interface CandidateMatch {
  candidate: Candidate;
  /** 0..1 — mean of each query token's best match against the name tokens. */
  score: number;
}

/** How confidently a query resolved to a candidate. Drives the Genie's reply:
 *  - "confident": one clear match, present it for confirmation.
 *  - "ambiguous": several plausible matches, ask the specialist to pick.
 *  - "none": nothing close enough, offer manual entry. */
export type MatchConfidence = 'confident' | 'ambiguous' | 'none';

export interface MatchResult {
  confidence: MatchConfidence;
  matches: CandidateMatch[];
}

/** Score at/above which a single token counts as a real match (tolerates a
 *  typo or two). Below this a token is treated as noise. */
const TOKEN_MATCH_THRESHOLD = 0.5;
/** A candidate must beat this overall to be offered at all. */
const CANDIDATE_MATCH_THRESHOLD = 0.5;
/** A clear leader is this much better than the runner-up, or alone. */
const CONFIDENT_MARGIN = 0.2;

/**
 * Fuzzy-rank candidates against a free-text name query. Each query token scores
 * against its best-matching name token (exact > prefix > substring > edit-
 * distance similarity), so first-name-only queries and misspellings both match.
 * Returns matches sorted best-first; a blank query returns everyone unscored.
 */
export function rankCandidates(
  candidates: Candidate[],
  query: string,
): CandidateMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates.map((candidate) => ({candidate, score: 1}));

  const queryTokens = q.split(/\s+/).filter(Boolean);
  const scored = candidates.map((candidate) => {
    const nameTokens = candidate.name
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const perToken = queryTokens.map((qt) =>
      Math.max(0, ...nameTokens.map((nt) => tokenScore(qt, nt))),
    );
    // Mean of per-token bests; tokens that didn't match drag the score down.
    const score = perToken.reduce((a, b) => a + b, 0) / perToken.length;
    return {candidate, score};
  });

  return scored
    .filter((m) => m.score >= CANDIDATE_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}

/**
 * Classify a query into confident / ambiguous / none so the Genie knows whether
 * to confirm one candidate, offer a pick list, or suggest manual entry.
 */
export function classifyMatches(
  candidates: Candidate[],
  query: string,
): MatchResult {
  const matches = rankCandidates(candidates, query);
  if (matches.length === 0) return {confidence: 'none', matches: []};

  const [top, next] = matches;
  const clearLeader =
    matches.length === 1 ||
    (next ? top!.score - next.score >= CONFIDENT_MARGIN : true);

  if (clearLeader && top!.score >= 0.75) {
    return {confidence: 'confident', matches: [top!]};
  }
  // Several plausible candidates — surface the close ones for the specialist.
  const cutoff = top!.score - 0.25;
  return {
    confidence: 'ambiguous',
    matches: matches.filter((m) => m.score >= cutoff).slice(0, 5),
  };
}

/**
 * Case- and whitespace-insensitive fuzzy name search. Kept returning
 * `Candidate[]` (best-first) so existing callers are unchanged; blank query
 * returns everyone. Use `rankCandidates`/`classifyMatches` when you need scores
 * or confidence.
 */
export function searchCandidates(
  candidates: Candidate[],
  query: string,
): Candidate[] {
  return rankCandidates(candidates, query).map((m) => m.candidate);
}

/** Similarity of one query token to one name token, 0..1. */
function tokenScore(q: string, n: string): number {
  if (q === n) return 1;
  if (n.startsWith(q) || q.startsWith(n)) return 0.9;
  if (n.includes(q) || q.includes(n)) return 0.75;
  const sim = 1 - levenshtein(q, n) / Math.max(q.length, n.length);
  // Only credit edit-distance similarity once it's meaningfully close, so
  // unrelated short words don't score as partial matches.
  return sim >= TOKEN_MATCH_THRESHOLD ? sim : 0;
}

/** Classic Levenshtein edit distance between two short strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

export interface PublishPlanInput {
  candidateId: string;
  /** Role template to instantiate. Falls back to the candidate's roleName. */
  roleName?: string;
  /** App ids to grant as seats. */
  appIds?: string[];
  /** Start date (ISO) if the candidate record has none. */
  startDate?: string;
}

export interface PublishPlanResult {
  hire: Hire;
  tasks: Task[];
  licenses: License[];
  /** Path to the new hire's onboarding portal. */
  portalUrl: string;
}

export class CandidateService {
  private readonly repo: Repository;
  private readonly templates: TemplateService;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(
    repo: Repository,
    templates: TemplateService,
    options: {idGenerator?: IdGenerator; clock?: Clock} = {},
  ) {
    this.repo = repo;
    this.templates = templates;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  async search(query: string): Promise<Candidate[]> {
    const all = await this.repo.candidates.list();
    return searchCandidates(all, query);
  }

  /** Fuzzy-match + confidence (confident / ambiguous / none) for a name query. */
  async classify(query: string): Promise<MatchResult> {
    const all = await this.repo.candidates.list();
    return classifyMatches(all, query);
  }

  /**
   * Publish an onboarding plan: create a hire from the candidate, instantiate
   * tasks + licenses from the role template, link the candidate to the hire,
   * and flip its status to `onboarding`. Idempotent-ish: a candidate already
   * published returns its existing hire untouched.
   */
  async publishPlan(input: PublishPlanInput): Promise<PublishPlanResult> {
    const candidate = await this.repo.candidates.get(input.candidateId);
    if (!candidate)
      throw new Error(`Candidate "${input.candidateId}" not found`);

    if (candidate.status === 'onboarding' && candidate.hireId) {
      const existing = await this.repo.hires.get(candidate.hireId);
      if (existing) {
        const [tasks, licenses] = await Promise.all([
          this.repo.tasks.where((t) => t.hireId === existing.id),
          this.repo.licenses.where((l) => l.hireId === existing.id),
        ]);
        return {
          hire: existing,
          tasks,
          licenses,
          portalUrl: portalUrlFor(existing.id),
        };
      }
    }

    const roleName = input.roleName ?? candidate.roleName;
    if (!roleName) {
      throw new Error(
        `No role for candidate "${candidate.name}". Pass a roleName to publish.`,
      );
    }

    const [template] = await this.repo.templates.where(
      (t) => t.roleName === roleName,
    );
    if (!template) throw new Error(`No template for role "${roleName}"`);

    const startDate =
      input.startDate ??
      candidate.startDate ??
      this.now().toISOString().slice(0, 10);

    const hire: Hire = {
      id: this.nextId(),
      name: candidate.name,
      email: emailFromName(candidate.name),
      roleName,
      managerId: candidate.hiringManagerId,
      startDate,
      cohort: null,
    };
    await this.repo.hires.insert(hire);

    const {tasks, licenses} = await this.templates.instantiateForHire(
      hire.id,
      template.id,
      input.appIds ?? [],
    );

    await this.repo.candidates.update(candidate.id, {
      status: 'onboarding',
      hireId: hire.id,
    });

    return {hire, tasks, licenses, portalUrl: portalUrlFor(hire.id)};
  }
}

export interface ChecklistTaskItem {
  category: ChecklistCategory;
  title: string;
}

/**
 * A sensible 30-day onboarding checklist for a title/role, grouped into the
 * three categories the Genie presents. Deterministic so the mock fallback and
 * tests produce the same plan the live model would be asked to produce.
 */
export function defaultChecklist(input: {
  name: string;
  title: string;
  roleName: string | null;
}): ChecklistTaskItem[] {
  const firstName = input.name.split(/\s+/)[0] ?? input.name;
  const role = (input.roleName ?? input.title).toLowerCase();
  const isEngineer = /engineer|developer|swe/.test(role);
  const isDesigner = /design/.test(role);

  const items: ChecklistTaskItem[] = [
    {
      category: 'day_1_essentials',
      title: 'Sign offer letter and I-9 / tax forms',
    },
    {
      category: 'day_1_essentials',
      title: 'Complete HR paperwork and benefits enrollment',
    },
    {category: 'day_1_essentials', title: 'Issue laptop and peripherals'},
    {category: 'day_1_essentials', title: 'Create email + SSO account'},
    {category: 'day_1_essentials', title: 'Issue building access badge'},

    {category: 'role_tool_access', title: 'Grant Slack workspace access'},
    {category: 'role_tool_access', title: 'Grant Google Workspace access'},
  ];

  if (isEngineer) {
    items.push(
      {category: 'role_tool_access', title: 'Grant GitHub organization access'},
      {category: 'role_tool_access', title: 'Grant Jira project access'},
      {
        category: 'role_tool_access',
        title: 'Provision cloud / dev environment',
      },
    );
  } else if (isDesigner) {
    items.push(
      {category: 'role_tool_access', title: 'Grant Figma team access'},
      {category: 'role_tool_access', title: 'Grant Jira project access'},
    );
  } else {
    items.push({
      category: 'role_tool_access',
      title: 'Grant Notion workspace access',
    });
  }

  items.push(
    {
      category: '30_day_milestones',
      title: `Day 1: welcome 1-on-1 with ${firstName}'s manager`,
    },
    {
      category: '30_day_milestones',
      title: 'Week 1: meet the team and key partners',
    },
    {
      category: '30_day_milestones',
      title: 'Week 1: complete role-specific onboarding training',
    },
    {
      category: '30_day_milestones',
      title: 'Week 2: set 30/60/90 goals with manager',
    },
    {
      category: '30_day_milestones',
      title: 'Day 30: first-month check-in and feedback',
    },
  );

  return items;
}

export function portalUrlFor(hireId: string): string {
  return `/myonboarding?hire=${encodeURIComponent(hireId)}`;
}

function emailFromName(name: string): string {
  const handle = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z.]/g, '');
  return `${handle}@acme.test`;
}
