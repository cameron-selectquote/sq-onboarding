/**
 * Ledger logic — the fintech core (BuildPlan §4).
 *
 * The ledger is the single source of truth for all spend. Every grant, PO, and
 * revoke writes a ledger_entry. These functions own that invariant and keep the
 * matching budget.spent in sync.
 *
 * Design: a thin service bound to a Repository + injectable id/clock. No DB
 * driver, no framework — fully unit-testable.
 */

import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from "./ids";
import type { Repository } from "./repository";
import type {
  Budget,
  CostType,
  LedgerEntry,
  LedgerEntryType,
  Team,
} from "./types";

export interface LedgerServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export interface WriteEntryInput {
  hireId: string | null;
  type: LedgerEntryType;
  label: string;
  /** Positive = spend, negative = credit/recovery. */
  amount: number;
  costType: CostType;
  refTable?: string | null;
  refId?: string | null;
  /** If set, the matching budget's `spent` is adjusted by `amount`. */
  budgetTeam?: Team | null;
  /** Budget period to target when `budgetTeam` is set. */
  budgetPeriod?: string | null;
}

export class LedgerService {
  private readonly repo: Repository;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(repo: Repository, options: LedgerServiceOptions = {}) {
    this.repo = repo;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  /**
   * Write a ledger entry. When `budgetTeam` is provided, the matching budget's
   * `spent` is adjusted by the same amount (so credits reduce spend). Budget
   * sync and entry creation are intended to move together.
   */
  async writeEntry(input: WriteEntryInput): Promise<LedgerEntry> {
    if (!Number.isFinite(input.amount)) {
      throw new Error("Ledger amount must be a finite number");
    }

    const entry: LedgerEntry = {
      id: this.nextId(),
      hireId: input.hireId,
      type: input.type,
      label: input.label,
      amount: input.amount,
      costType: input.costType,
      refTable: input.refTable ?? null,
      refId: input.refId ?? null,
      createdAt: this.now().toISOString(),
    };

    const created = await this.repo.ledgerEntries.insert(entry);

    if (input.budgetTeam) {
      await this.adjustBudget(input.budgetTeam, input.budgetPeriod ?? null, input.amount);
    }

    return created;
  }

  /** All ledger entries for a hire. */
  async entriesForHire(hireId: string): Promise<LedgerEntry[]> {
    return this.repo.ledgerEntries.where((e) => e.hireId === hireId);
  }

  /** Sum of every ledger entry for a hire — the cost-per-hire primitive. */
  async totalForHire(hireId: string): Promise<number> {
    const entries = await this.entriesForHire(hireId);
    return sum(entries.map((e) => e.amount));
  }

  private async adjustBudget(
    team: Team,
    period: string | null,
    delta: number,
  ): Promise<Budget | null> {
    const matches = await this.repo.budgets.where(
      (b) => b.team === team && (period === null || b.period === period),
    );
    const budget = matches[0];
    if (!budget) {
      return null;
    }
    return this.repo.budgets.update(budget.id, {
      spent: budget.spent + delta,
    });
  }
}

/** Pure sum helper, kept exported so finance.ts and tests can reuse it. */
export function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
