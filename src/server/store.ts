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
import {ReclaimTaskService} from '@/lib/reclaim-tasks';
import {AssetService} from '@/lib/assets';
import {TemplateService} from '@/lib/templates';
import {CandidateService} from '@/lib/candidates';
import {OnboardingExecutor} from '@/lib/onboarding';
import {OffboardingService} from '@/lib/offboarding';
import {NotificationService} from '@/lib/notifications';
import {MockAiClient} from '@/lib/ai';
import type {Repository} from '@/lib/repository';
import type {AiClient, BriefBlurb, TemplateMatch} from '@/lib/ai';
import {hasBedrockCreds} from '@/lib/bedrock';
import {backfillSeedFields, loadSeed, seedData} from '@/data/seed';

/**
 * An `AiClient` that defers loading the Strands SDK until the first call.
 *
 * `store.ts` is imported by API routes AND by the unit tests (via the shared
 * services). The Strands SDK ships ESM-only, which ts-jest's CommonJS runtime
 * can't parse, so a *static* import of `StrandsAiClient` here would crash any
 * test that touches the store — even though tests run with no Bedrock creds and
 * never call the AI. Deferring the import to the first method call keeps the
 * SDK out of the module graph entirely in that path. It's only ever
 * constructed when `hasBedrockCreds()` is true, i.e. at runtime with creds.
 */
class LazyStrandsAiClient implements AiClient {
  private delegate: Promise<AiClient> | null = null;

  constructor(private readonly repo: Repository) {}

  private load(): Promise<AiClient> {
    if (!this.delegate) {
      this.delegate = import('@/lib/strands-ai').then(
        (m) => new m.StrandsAiClient(this.repo),
      );
    }
    return this.delegate;
  }

  async matchTemplate(input: {
    title: string;
    offerText?: string;
  }): Promise<TemplateMatch> {
    return (await this.load()).matchTemplate(input);
  }

  async draftBrief(input: {
    hireName: string;
    appNames: string[];
  }): Promise<BriefBlurb[]> {
    return (await this.load()).draftBrief(input);
  }
}

interface Services {
  repo: Repository;
  ledger: LedgerService;
  licenses: LicenseService;
  reclaimTasks: ReclaimTaskService;
  assets: AssetService;
  templates: TemplateService;
  candidates: CandidateService;
  onboarding: OnboardingExecutor;
  offboarding: OffboardingService;
  notifications: NotificationService;
  ai: AiClient;
}

// Stash on globalThis so Next.js hot-reload doesn't create duplicate stores
// (or multiple handles to the same SQLite file).
const globalForStore = globalThis as unknown as {
  __provisionServices?: Services;
  __provisionSqlite?: SqliteRepository;
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
  const reclaimTasks = new ReclaimTaskService(repo, licenses);
  const assets = new AssetService(repo, ledger);
  const notifications = new NotificationService(repo);
  return {
    repo,
    services: {
      repo,
      ledger,
      licenses,
      reclaimTasks,
      assets,
      templates,
      candidates: new CandidateService(repo, templates),
      onboarding: new OnboardingExecutor(repo, licenses, assets, {
        notifications,
      }),
      offboarding: new OffboardingService(repo, licenses, assets, {
        notifications,
      }),
      notifications,
      // Strands-backed AI (Bedrock) when creds exist; deterministic mock
      // otherwise, so the demo and tests run offline. Same graceful-degradation
      // policy as the Genie — the one `hasBedrockCreds()` check decides both.
      // Built lazily so the Strands SDK (ESM-only) is never pulled into module
      // load — importing it statically breaks ts-jest's CommonJS test runtime.
      ai:
        hasBedrockCreds() ? new LazyStrandsAiClient(repo) : new MockAiClient(),
    },
  };
}

function services(): Services {
  if (!globalForStore.__provisionServices) {
    const {services: svc, repo} = build();
    globalForStore.__provisionServices = svc;
    globalForStore.__provisionSqlite = repo;
    // Seed only on a fresh store; a populated file is left as-is so data
    // survives restarts and re-seeding never collides on duplicate ids.
    globalForStore.__provisionSeeded =
      repo.isEmpty() ?
        loadSeed(svc.repo).then(() => loadOptionalHistory(svc.repo))
      : migrateExisting(repo);
  }
  return globalForStore.__provisionServices;
}

/**
 * An existing DB file from an older release: ensureSchema already added any
 * missing columns; fill those from the seed for seed rows, then add any
 * collections that shipped after the file was created.
 */
async function migrateExisting(repo: SqliteRepository): Promise<void> {
  if (repo.addedColumns.length > 0) {
    const cols = repo.addedColumns
      .map((c) => `${c.table}.${c.column}`)
      .join(', ');
    const patched = await backfillSeedFields(repo, repo.addedColumns);
    console.info(
      `[store] migrated DB: added ${cols}; backfilled ${patched} seed row(s)`,
    );
  }
  await backfillCandidates(repo);
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
  /** Where the pre-reset snapshot was written; null for a `:memory:` store. */
  backup: string | null;
  counts: Record<string, number>;
}

/**
 * Snapshot the live DB next to it as `<db>-backup-<timestamp>` (matches the
 * `/data/*.sqlite-*` gitignore rule). Returns the path, or null for an
 * in-memory store. Throws on failure so the caller never wipes un-backed-up data.
 */
async function backupStore(repo: SqliteRepository): Promise<string | null> {
  if (repo.inMemory) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = `${resolveDbPath()}-backup-${stamp}`;
  await repo.backup(destination);
  return destination;
}

/**
 * Wipe the store and reload the committed seed (plus optional backdated
 * history), returning it to its first-boot baseline. A snapshot of the current
 * DB is written first; if that fails, nothing is wiped. Operates on the live
 * shared repo in place, so every route sees the reseeded data. The
 * `__provisionSeeded` promise is reset to the reseed so a concurrent
 * `getServices()` awaits the fresh load, not a stale resolved one.
 *
 * Who may call it is decided by the API route (`canResetStore`).
 */
export async function resetStore(): Promise<ResetSummary> {
  const svc = await getServices();
  const sqlite = globalForStore.__provisionSqlite;
  const backup = sqlite ? await backupStore(sqlite) : null;
  const reseed = (async () => {
    await svc.repo.reset();
    await loadSeed(svc.repo);
    await loadOptionalHistory(svc.repo);
  })();
  globalForStore.__provisionSeeded = reseed;
  await reseed;
  return {
    ok: true,
    reseeded: true,
    backup,
    counts: await collectionCounts(svc.repo),
  };
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
