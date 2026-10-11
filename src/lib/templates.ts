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
} from './ids';
import {assignedSeats} from './seats';
import {monthlyCost} from './finance';
import type {Repository} from './repository';
import type {License, Task, Team, Template, TemplateTask} from './types';

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
        status: 'todo',
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
      const hasRoom =
        app ? assignedSeats(app, poolLicenses) < app.seatsOwned : true;

      const license: License = {
        id: this.nextId(),
        hireId,
        appId,
        // Granted when there's room; otherwise created as `requested` so it
        // shows in IT's "Seats waiting" queue (holds no seat, no ledger spend).
        status: hasRoom ? 'active' : 'requested',
        grantedAt: hasRoom ? grantedAt : null,
        lastUsedAt: hasRoom ? grantedAt : null,
      };
      const created = await this.repo.licenses.insert(license);
      poolLicenses.push(created); // next seat in this batch sees the pool fill

      if (hasRoom) {
        licenses.push(created);
      } else if (app) {
        deferred.push({appId, appName: app.name});
      }
    }

    return {tasks, licenses, deferred};
  }

  /**
   * Create a brand-new role template from a role name, a list of plain task
   * titles, and a list of seat app ids. Persists one `template` row plus a
   * `template_task` per task + per seat:
   *   - each plain title becomes a `none`-cost task (owner inferred from the
   *     title; defaults to IT),
   *   - each seat app becomes a recurring "Grant <App> seat" task carrying the
   *     app's monthly cost, so the ledger stays correct when it's instantiated.
   *
   * Rejects a duplicate roleName so templates stay 1:1 with a role (the import
   * flow looks a template up by roleName).
   */
  async createTemplate(input: {
    roleName: string;
    taskTitles: string[];
    seatAppIds: string[];
  }): Promise<{template: Template; templateTasks: TemplateTask[]}> {
    const roleName = input.roleName.trim();
    if (!roleName) throw new Error('Template roleName is required');

    const existing = await this.repo.templates.where(
      (t) => t.roleName.toLowerCase() === roleName.toLowerCase(),
    );
    if (existing.length > 0) {
      throw new Error(`A template for "${roleName}" already exists`);
    }

    const template = await this.repo.templates.insert({
      id: this.nextId(),
      roleName,
    });

    const created: TemplateTask[] = [];

    // Plain admin/hardware tasks (no app, no recurring cost by default).
    for (const rawTitle of input.taskTitles) {
      const title = rawTitle.trim();
      if (!title) continue;
      const tt = await this.repo.templateTasks.insert({
        id: this.nextId(),
        templateId: template.id,
        title,
        ownerTeam: inferOwnerTeam(title),
        cost: 0,
        costType: 'none',
        appId: null,
      });
      created.push(tt);
    }

    // One "Grant <App> seat" recurring task per requested seat.
    for (const appId of input.seatAppIds) {
      const app = await this.repo.appCatalog.get(appId);
      if (!app) continue;
      const monthly = monthlyCost(app.costPerSeat, app.billing);
      const tt = await this.repo.templateTasks.insert({
        id: this.nextId(),
        templateId: template.id,
        title: `Grant ${app.name} seat`,
        ownerTeam: 'it',
        cost: monthly,
        costType: 'recurring',
        appId: app.id,
      });
      created.push(tt);
    }

    return {template, templateTasks: created};
  }
}

/** Infer the owning team from a task title keyword; defaults to IT. */
function inferOwnerTeam(title: string): Team {
  const t = title.toLowerCase();
  if (/\b(laptop|monitor|headset|phone|hardware|ship|order)\b/.test(t)) {
    return 'vendor';
  }
  if (/\b(badge|desk|building|office|facilit)\b/.test(t)) return 'facilities';
  if (/\b(paperwork|benefits|offer|hr|payroll|i-9|w-?4)\b/.test(t)) return 'hr';
  return 'it';
}
