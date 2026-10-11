/**
 * Template instantiation (BuildPlan §3 import, §4 data-eng).
 *
 * Importing a hire against a role template instantiates:
 *   - a `task` per `template_task` (status todo), and
 *   - a `license` (status active) for every template task that implies an app.
 *
 * For the first pass, apps are matched to template tasks by a simple
 * title/category convention; callers can also pass an explicit app list. This
 * service is pure orchestration over the Repository + id/clock seams.
 */

import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from "./ids";
import { assignedSeats } from "./seats";
import type { Repository } from "./repository";
import type { License, Task } from "./types";

export interface TemplateServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

/** A seat that couldn't be granted on import because the pool was full. */
export interface DeferredSeat {
  appId: string;
  appName: string;
}

export interface InstantiateResult {
  tasks: Task[];
  /** Seats actually granted (active). */
  licenses: License[];
  /**
   * Seats that couldn't be granted because the app's pool was full. They are
   * created as pending (requested-but-not-granted) licenses so they land in
   * IT's "Seats waiting" queue instead of over-allocating.
   */
  deferred: DeferredSeat[];
}

export class TemplateService {
  private readonly repo: Repository;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(repo: Repository, options: TemplateServiceOptions = {}) {
    this.repo = repo;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  /**
   * Instantiate tasks (and optionally licenses) for a hire from a template.
   *
   * @param appIds optional app ids to grant as active licenses for this hire.
   *               Kept explicit so the caller (import flow) controls the stack.
   */
  async instantiateForHire(
    hireId: string,
    templateId: string,
    appIds: string[] = [],
  ): Promise<InstantiateResult> {
    const hire = await this.repo.hires.get(hireId);
    if (!hire) throw new Error(`Hire "${hireId}" not found`);

    const template = await this.repo.templates.get(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);

    const templateTasks = await this.repo.templateTasks.where(
      (t) => t.templateId === templateId,
    );

    const tasks: Task[] = [];
    for (const tt of templateTasks) {
      const task: Task = {
        id: this.nextId(),
        hireId,
        title: tt.title,
        ownerTeam: tt.ownerTeam,
        status: "todo",
        cost: tt.cost,
        costType: tt.costType,
        appId: tt.appId ?? null,
      };
      tasks.push(await this.repo.tasks.insert(task));
    }

    const licenses: License[] = [];
    const deferred: DeferredSeat[] = [];
    const grantedAt = this.now().toISOString();

    // Snapshot existing licenses; track in-batch grants so requesting more
    // seats than remain in a pool defers the overflow rather than over-granting.
    const poolLicenses = await this.repo.licenses.list();

    for (const appId of appIds) {
      const app = await this.repo.appCatalog.get(appId);
      // Unknown app: fall back to granting active (no pool to enforce).
      const hasRoom = app ? assignedSeats(app, poolLicenses) < app.seatsOwned : true;

      const license: License = {
        id: this.nextId(),
        hireId,
        appId,
        // Granted when there's room; otherwise created as pending (requested,
        // not granted) so it shows in IT's "Seats waiting" queue.
        status: hasRoom ? "active" : "revoked",
        grantedAt: hasRoom ? grantedAt : null,
        lastUsedAt: hasRoom ? grantedAt : null,
      };
      const created = await this.repo.licenses.insert(license);
      poolLicenses.push(created); // next seat in this batch sees the pool fill

      if (hasRoom) {
        licenses.push(created);
      } else if (app) {
        deferred.push({ appId, appName: app.name });
      }
    }

    return { tasks, licenses, deferred };
  }
}
