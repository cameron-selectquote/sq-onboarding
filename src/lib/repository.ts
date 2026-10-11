/**
 * Repository seam.
 *
 * The domain logic (ledger, finance, reclaim, templates) talks only to this
 * interface — never to a database driver directly. For the first-pass build we
 * ship an in-memory implementation (see ./memory-repository.ts). When DevOps is
 * ready, a SupabaseRepository implementing the same interface drops in with no
 * changes to lib/ or the API routes.
 */

import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  Candidate,
  Company,
  Hire,
  LedgerEntry,
  License,
  Notification,
  Task,
  Template,
  TemplateTask,
  User,
} from './types';

/** A single typed collection of records keyed by `id`. */
export interface Collection<T extends {id: string}> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(record: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T>;
  remove(id: string): Promise<void>;
  /** Convenience filter over the full list. */
  where(predicate: (record: T) => boolean): Promise<T[]>;
}

export interface Repository {
  companies: Collection<Company>;
  users: Collection<User>;
  appCatalog: Collection<AppCatalogItem>;
  assetCatalog: Collection<AssetCatalogItem>;
  assets: Collection<Asset>;
  templates: Collection<Template>;
  templateTasks: Collection<TemplateTask>;
  hires: Collection<Hire>;
  tasks: Collection<Task>;
  licenses: Collection<License>;
  budgets: Collection<Budget>;
  ledgerEntries: Collection<LedgerEntry>;
  notifications: Collection<Notification>;
  candidates: Collection<Candidate>;
}
