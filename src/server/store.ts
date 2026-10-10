/**
 * App-level repository singleton for the first-pass build.
 *
 * All API routes share one seeded in-memory Repository. This is a deliberate
 * dev-only choice: the module instance persists across requests in a single
 * Next.js server process, giving the demo a consistent, mutable dataset without
 * a database.
 *
 * When Supabase lands, replace the body of `getRepository()` with a real
 * Repository — route handlers won't change.
 */

import { createMemoryRepository } from "@/lib/memory-repository";
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

// Stash on globalThis so Next.js hot-reload doesn't create duplicate stores.
const globalForStore = globalThis as unknown as {
  __provisionServices?: Services;
  __provisionSeeded?: Promise<void>;
};

function build(): Services {
  const repo = createMemoryRepository();
  const ledger = new LedgerService(repo);
  return {
    repo,
    ledger,
    licenses: new LicenseService(repo, ledger),
    assets: new AssetService(repo, ledger),
    templates: new TemplateService(repo),
    ai: new MockAiClient(),
  };
}

function services(): Services {
  if (!globalForStore.__provisionServices) {
    globalForStore.__provisionServices = build();
    globalForStore.__provisionSeeded = loadSeed(globalForStore.__provisionServices.repo);
  }
  return globalForStore.__provisionServices;
}

/** Await before touching data in a route so the seed has finished loading. */
export async function getServices(): Promise<Services> {
  const svc = services();
  await globalForStore.__provisionSeeded;
  return svc;
}
