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

import path from "node:path";
import fs from "node:fs";

import { createSqliteRepository, SqliteRepository } from "@/lib/sqlite-repository";
import { LedgerService } from "@/lib/ledger";
import { LicenseService } from "@/lib/licenses";
import { AssetService } from "@/lib/assets";
import { TemplateService } from "@/lib/templates";
import { MockAiClient } from "@/lib/ai";
import type { Repository } from "@/lib/repository";
import type { AiClient } from "@/lib/ai";
import { loadSeed } from "@/data/seed";

interface Services {
  repo: Repository;
  ledger: LedgerService;
  licenses: LicenseService;
  assets: AssetService;
  templates: TemplateService;
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
  if (configured === ":memory:") return configured;

  const file = configured
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "provision.sqlite");

  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function build(): { services: Services; repo: SqliteRepository } {
  const repo = createSqliteRepository(resolveDbPath());
  const ledger = new LedgerService(repo);
  return {
    repo,
    services: {
      repo,
      ledger,
      licenses: new LicenseService(repo, ledger),
      assets: new AssetService(repo, ledger),
      templates: new TemplateService(repo),
      ai: new MockAiClient(),
    },
  };
}

function services(): Services {
  if (!globalForStore.__provisionServices) {
    const { services: svc, repo } = build();
    globalForStore.__provisionServices = svc;
    // Seed only on a fresh store; a populated file is left as-is so data
    // survives restarts and re-seeding never collides on duplicate ids.
    globalForStore.__provisionSeeded = repo.isEmpty()
      ? loadSeed(svc.repo).then(() => loadOptionalHistory(svc.repo))
      : Promise.resolve();
  }
  return globalForStore.__provisionServices;
}

/**
 * Load backdated ledger history if the local (gitignored) history module is
 * present. It's optional dev-only demo data for trend views, so a missing file
 * is expected for teammates and must not break seeding.
 */
async function loadOptionalHistory(repo: Repository): Promise<void> {
  try {
    const mod = await import("@/data/history");
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
