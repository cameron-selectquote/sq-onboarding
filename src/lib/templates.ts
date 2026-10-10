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
import type { Repository } from "./repository";
import type { License, Task } from "./types";

export interface TemplateServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export interface InstantiateResult {
  tasks: Task[];
  licenses: License[];
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
      };
      tasks.push(await this.repo.tasks.insert(task));
    }

    const licenses: License[] = [];
    const grantedAt = this.now().toISOString();
    for (const appId of appIds) {
      const license: License = {
        id: this.nextId(),
        hireId,
        appId,
        status: "active",
        grantedAt,
        lastUsedAt: grantedAt,
      };
      licenses.push(await this.repo.licenses.insert(license));
    }

    return { tasks, licenses };
  }
}
