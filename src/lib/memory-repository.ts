/**
 * In-memory Repository implementation for the first-pass build.
 *
 * Zero infrastructure: everything lives in Maps. This unblocks the whole team
 * (domain logic, API routes, and the frontend against mock data) before
 * Supabase exists. Swap for a real DB-backed Repository later without touching
 * callers.
 */

import type {Collection, Repository} from './repository';
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

class MemoryCollection<T extends {id: string}> implements Collection<T> {
  private readonly store = new Map<string, T>();

  async list(): Promise<T[]> {
    return [...this.store.values()].map(clone);
  }

  async get(id: string): Promise<T | null> {
    const record = this.store.get(id);
    return record ? clone(record) : null;
  }

  async insert(record: T): Promise<T> {
    if (this.store.has(record.id)) {
      throw new Error(`Record with id "${record.id}" already exists`);
    }
    this.store.set(record.id, clone(record));
    return clone(record);
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const existing = this.store.get(id);
    if (!existing) {
      throw new Error(`Record with id "${id}" not found`);
    }
    // Never let a patch change the primary key.
    const next = {...existing, ...patch, id: existing.id} as T;
    this.store.set(id, next);
    return clone(next);
  }

  async remove(id: string): Promise<void> {
    this.store.delete(id);
  }

  async where(predicate: (record: T) => boolean): Promise<T[]> {
    return [...this.store.values()].filter(predicate).map(clone);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/** Defensive copy so callers can't mutate stored records by reference. */
function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryRepository implements Repository {
  companies = new MemoryCollection<Company>();
  users = new MemoryCollection<User>();
  appCatalog = new MemoryCollection<AppCatalogItem>();
  assetCatalog = new MemoryCollection<AssetCatalogItem>();
  assets = new MemoryCollection<Asset>();
  templates = new MemoryCollection<Template>();
  templateTasks = new MemoryCollection<TemplateTask>();
  hires = new MemoryCollection<Hire>();
  tasks = new MemoryCollection<Task>();
  licenses = new MemoryCollection<License>();
  budgets = new MemoryCollection<Budget>();
  ledgerEntries = new MemoryCollection<LedgerEntry>();
  notifications = new MemoryCollection<Notification>();
  candidates = new MemoryCollection<Candidate>();

  /** Empty every collection. Covers any collection on this repo generically. */
  async reset(): Promise<void> {
    const collections = Object.values(this).filter(
      (value): value is MemoryCollection<{id: string}> =>
        value instanceof MemoryCollection,
    );
    for (const collection of collections) await collection.clear();
  }
}

/** Factory kept separate so callers depend on the interface, not the class. */
export function createMemoryRepository(): Repository {
  return new MemoryRepository();
}
