/**
 * Reclaim job lifecycle — finance flags, IT executes (reclaim-tracked-jobs).
 *
 *   open:     finance (or IT) flags a seat for reclaim. License -> 'reclaim'.
 *             Idempotent: an existing open job for the seat is returned as-is.
 *             NO ledger entry.
 *   start:    IT begins work. 'pending' -> 'reclaiming'. NO ledger entry.
 *   complete: IT finished. -> 'done', then LicenseService.revoke() runs — the
 *             ONLY ledger-credit point in the whole lifecycle.
 *   cancel:   abandon the job. -> 'cancelled', license restored to 'active'.
 *             NO ledger entry.
 *
 * The ledger credit flows exclusively through LicenseService.revoke(), so the
 * ledger stays the single source of truth and a reclaim never double-counts.
 */

import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from "./ids";
import type { LicenseService } from "./licenses";
import type { Repository } from "./repository";
import type { ReclaimTask } from "./types";

export interface ReclaimTaskServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

/** A job is "open" (occupying the one-per-seat slot) while in these states. */
const OPEN_STATUSES: ReclaimTask["status"][] = ["pending", "reclaiming"];

export class ReclaimTaskService {
  private readonly repo: Repository;
  private readonly licenses: LicenseService;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(
    repo: Repository,
    licenses: LicenseService,
    options: ReclaimTaskServiceOptions = {},
  ) {
    this.repo = repo;
    this.licenses = licenses;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  /**
   * Flag a seat for reclaim. License -> 'reclaim'; no ledger change. If an open
   * job (pending/reclaiming) already exists for the seat, it's returned
   * unchanged — one open job per license, no second job, no ledger change.
   */
  async open(
    licenseId: string,
    createdByTeam: ReclaimTask["createdByTeam"],
  ): Promise<ReclaimTask> {
    const license = await this.repo.licenses.get(licenseId);
    if (!license) throw new Error(`License "${licenseId}" not found`);

    const existingOpen = (
      await this.repo.reclaimTasks.where((t) => t.licenseId === licenseId)
    ).find((t) => OPEN_STATUSES.includes(t.status));
    if (existingOpen) return existingOpen;

    const task: ReclaimTask = {
      id: this.nextId(),
      licenseId,
      status: "pending",
      createdByTeam,
      createdAt: this.now().toISOString(),
      completedAt: null,
      cancelledAt: null,
    };
    const created = await this.repo.reclaimTasks.insert(task);

    await this.repo.licenses.update(licenseId, { status: "reclaim" });

    return created;
  }

  /** IT begins work: 'pending' -> 'reclaiming'. License stays 'reclaim'. */
  async start(taskId: string): Promise<ReclaimTask> {
    const task = await this.requireTask(taskId);
    if (task.status !== "pending") {
      throw new Error(
        `Reclaim task "${taskId}" cannot be started from status "${task.status}"`,
      );
    }
    return this.repo.reclaimTasks.update(taskId, { status: "reclaiming" });
  }

  /**
   * IT finished: -> 'done', then revoke the seat. revoke() is called LAST so a
   * revoke failure doesn't leave a 'done' job without its ledger credit. This
   * is the only method in the lifecycle that writes a ledger entry.
   */
  async complete(taskId: string): Promise<ReclaimTask> {
    const task = await this.requireTask(taskId);
    if (!OPEN_STATUSES.includes(task.status)) {
      throw new Error(
        `Reclaim task "${taskId}" cannot be completed from status "${task.status}"`,
      );
    }
    const updated = await this.repo.reclaimTasks.update(taskId, {
      status: "done",
      completedAt: this.now().toISOString(),
    });
    await this.licenses.revoke(task.licenseId);
    return updated;
  }

  /**
   * Abandon the job: -> 'cancelled', restore the license. The pre-reclaim
   * status isn't stored, so 'active' is the safe restore target. No ledger
   * change.
   */
  async cancel(taskId: string): Promise<ReclaimTask> {
    const task = await this.requireTask(taskId);
    if (!OPEN_STATUSES.includes(task.status)) {
      throw new Error(
        `Reclaim task "${taskId}" cannot be cancelled from status "${task.status}"`,
      );
    }
    const updated = await this.repo.reclaimTasks.update(taskId, {
      status: "cancelled",
      cancelledAt: this.now().toISOString(),
    });
    await this.repo.licenses.update(task.licenseId, { status: "active" });
    return updated;
  }

  private async requireTask(taskId: string): Promise<ReclaimTask> {
    const task = await this.repo.reclaimTasks.get(taskId);
    if (!task) throw new Error(`Reclaim task "${taskId}" not found`);
    return task;
  }
}
