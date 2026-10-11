/**
 * App-level repository singleton.
 *
 * All API routes share one SqliteRepository backed by a local file, so the
 * dataset persists across server restarts (and across requests within a single
 * Next.js process). The seed runs once, only when the store is empty.
 *
 * The DB file lives at `data/provision.sqlite` under the project root by
 * default; override with the PROVISION_DB_PATH env var (e.g. ":memory:" for an
 * ephemeral store). Route handlers never see any of this — they depend only on
 * the Repository interface, so swapping in Postgres/Supabase later means
 * changing only this file.
 */

import path from 'node:path';
import fs from 'node:fs';

import {
  createSqliteRepository,
  SqliteRepository,
} from '@/lib/sqlite-repository';
import {LedgerService} from '@/lib/ledger';
import {LicenseService} from '@/lib/licenses';
import {AssetService} from '@/lib/assets';
import {TemplateService} from '@/lib/templates';
import {CandidateService} from '@/lib/candidates';
import {OnboardingExecutor} from '@/lib/onboarding';
import {OffboardingService} from '@/lib/offboarding';
import {MockAiClient} from '@/lib/ai';
import type {Repository} from '@/lib/repository';
import type {AiClient} from '@/lib/ai';
import {loadSeed, seedData} from '@/data/seed';

interface Services {
  repo: Repository;
  ledger: LedgerService;
  licenses: LicenseService;
  assets: AssetService;
  templates: TemplateService;
  candidates: CandidateService;
  onboarding: OnboardingExecutor;
  offboarding: OffboardingService;
  ai: AiClient;
}

// Stash on globalThis so Next.js hot-reload doesn't create duplicate stores
// (or multiple handles to the same SQLite file).
const globalForStore = globalThis as unknown as {
  __provisionServices?: Services;
  __provisionSeeded?: Promise<void>;
};

/** Resolve the SQLite file path, creating its parent directory if needed. */
function resolveDbPath(): string {
  const configured = process.env.PROVISION_DB_PATH;
  if (configured === ':memory:') return configured;

  const file =
    configured ?
      path.resolve(configured)
    : path.join(process.cwd(), 'data', 'provision.sqlite');

  fs.mkdirSync(path.dirname(file), {recursive: true});
  return file;
}

function build(): {services: Services; repo: SqliteRepository} {
  const repo = createSqliteRepository(resolveDbPath());
  const ledger = new LedgerService(repo);
  const templates = new TemplateService(repo);
  const licenses = new LicenseService(repo, ledger);
  const assets = new AssetService(repo, ledger);
  return {
    repo,
    services: {
      repo,
      ledger,
      licenses,
      assets,
      templates,
      candidates: new CandidateService(repo, templates),
      onboarding: new OnboardingExecutor(repo, licenses, assets),
      offboarding: new OffboardingService(repo, licenses, assets),
      ai: new MockAiClient(),
    },
  };
}

function services(): Services {
  if (!globalForStore.__provisionServices) {
    const {services: svc, repo} = build();
    globalForStore.__provisionServices = svc;
    // Seed only on a fresh store; a populated file is left as-is so data
    // survives restarts and re-seeding never collides on duplicate ids.
    globalForStore.__provisionSeeded =
      repo.isEmpty() ?
        loadSeed(svc.repo).then(() => loadOptionalHistory(svc.repo))
      : backfillCandidates(svc.repo);
  }
  return globalForStore.__provisionServices;
}

/**
 * Candidates were added after the first-pass store shipped, so an existing DB
 * file won't have them even though it's "not empty". Insert the seed
 * candidates once if the table is bare, leaving every other table untouched.
 */
async function backfillCandidates(repo: Repository): Promise<void> {
  const existing = await repo.candidates.list();
  if (existing.length > 0) return;
  for (const c of seedData.candidates) {
    const already = await repo.candidates.get(c.id);
    if (!already) await repo.candidates.insert(c);
  }
}

/**
 * Load backdated ledger history if the local (gitignored) history module is
 * present. It's optional dev-only demo data for trend views, so a missing file
 * is expected for teammates and must not break seeding.
 */
async function loadOptionalHistory(repo: Repository): Promise<void> {
  try {
    const mod = await import('@/data/history');
    await mod.loadHistory(repo);
  } catch {
    // No history module (not committed) — fine, trends just start empty.
  }
}

/** Await before touching data in a route so any seed has finished loading. */
export async function getServices(): Promise<Services> {
  const svc = services();
  await globalForStore.__provisionSeeded;
  return svc;
}

/** Per-collection row count after a reseed. */
export interface ResetSummary {
  ok: true;
  reseeded: true;
  counts: Record<string, number>;
}

/**
 * Dev-only: wipe the store and reload the committed seed (plus optional
 * backdated history), returning it to its first-boot baseline. Operates on the
 * live shared repo in place, so every route sees the reseeded data. The
 * `__provisionSeeded` promise is reset to the reseed so a concurrent
 * `getServices()` awaits the fresh load, not a stale resolved one.
 *
 * Not for production — the API route guards on NODE_ENV.
 */
export async function resetStore(): Promise<ResetSummary> {
  const svc = await getServices();
  const reseed = (async () => {
    await svc.repo.reset();
    await loadSeed(svc.repo);
    await loadOptionalHistory(svc.repo);
  })();
  globalForStore.__provisionSeeded = reseed;
  await reseed;
  return {ok: true, reseeded: true, counts: await collectionCounts(svc.repo)};
}

/** Row count per collection, keyed by collection name, for the reset summary. */
async function collectionCounts(
  repo: Repository,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(repo)) {
    if (
      value &&
      typeof (value as {list?: unknown}).list === 'function' &&
      name !== 'reset'
    ) {
      const rows = await (value as {list(): Promise<unknown[]>}).list();
      counts[name] = rows.length;
    }
  }
  return counts;
}
