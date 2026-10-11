/**
 * Notification service — the in-app inbox write path (BuildPlan §2, §3).
 *
 * Drops messages into a team's queue so the Genie's actions (granting a seat,
 * raising a PO, offboarding a hire) are visible to the team that owns the
 * follow-up. Reads are the team-queue view's job; this owns writes + mark-read.
 *
 * Thin service over the Repository with an injectable id generator, matching
 * the ledger/asset services so tests stay deterministic. No ledger coupling —
 * a notification is a message, never spend.
 */

import {defaultIdGenerator, type IdGenerator} from './ids';
import type {Repository} from './repository';
import type {Notification, Team} from './types';

export interface NotifyInput {
  targetTeam: Team;
  message: string;
  /** Groups notifications raised together (e.g. one onboarding run). */
  batchId?: string | null;
}

export class NotificationService {
  private readonly repo: Repository;
  private readonly nextId: IdGenerator;

  constructor(repo: Repository, options: {idGenerator?: IdGenerator} = {}) {
    this.repo = repo;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
  }

  /** Post one notification to a team's inbox (unread). */
  async notify(input: NotifyInput): Promise<Notification> {
    const notification: Notification = {
      id: this.nextId(),
      targetTeam: input.targetTeam,
      message: input.message,
      batchId: input.batchId ?? null,
      read: false,
    };
    return this.repo.notifications.insert(notification);
  }

  /** Post several notifications under one batch id. */
  async notifyMany(
    items: NotifyInput[],
    batchId?: string,
  ): Promise<Notification[]> {
    const batch = batchId ?? this.nextId();
    const created: Notification[] = [];
    for (const item of items) {
      created.push(await this.notify({...item, batchId: item.batchId ?? batch}));
    }
    return created;
  }

  /** A team's inbox, unread first then newest-looking last-inserted order. */
  async forTeam(team: Team): Promise<Notification[]> {
    const all = await this.repo.notifications.where((n) => n.targetTeam === team);
    // Unread first; stable within each group (insertion order from the repo).
    return [...all].sort((a, b) => Number(a.read) - Number(b.read));
  }

  /** Count of unread notifications for a team. */
  async unreadCount(team: Team): Promise<number> {
    const all = await this.repo.notifications.where(
      (n) => n.targetTeam === team && !n.read,
    );
    return all.length;
  }

  /** Mark one notification read. */
  async markRead(id: string): Promise<Notification> {
    const existing = await this.repo.notifications.get(id);
    if (!existing) throw new Error(`Notification "${id}" not found`);
    return this.repo.notifications.update(id, {read: true});
  }

  /** Mark every notification for a team read; returns how many changed. */
  async markTeamRead(team: Team): Promise<number> {
    const unread = await this.repo.notifications.where(
      (n) => n.targetTeam === team && !n.read,
    );
    for (const n of unread) {
      await this.repo.notifications.update(n.id, {read: true});
    }
    return unread.length;
  }
}
