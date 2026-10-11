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
import type {
  CostType,
  License,
  Task,
  Team,
  Template,
  TemplateTask,
} from "./types";

export interface TemplateServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export interface InstantiateResult {
  tasks: Task[];
  /** Seats granted (active) for this hire. */
  licenses: License[];
}

/** A template plus its ordered template tasks — the shape the UI reads. */
export interface TemplateWithTasks extends Template {
  tasks: TemplateTask[];
}

/** Fields a caller supplies when adding/editing a template task. */
export interface TemplateTaskInput {
  title: string;
  ownerTeam: Team;
  cost?: number;
  costType?: CostType;
  appId?: string | null;
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

  // ---- Read models --------------------------------------------------------

  /** Every template with its template tasks attached, for the editor UI. */
  async listWithTasks(): Promise<TemplateWithTasks[]> {
    const [templates, templateTasks] = await Promise.all([
      this.repo.templates.list(),
      this.repo.templateTasks.list(),
    ]);
    return templates
      .map((template) => ({
        ...template,
        tasks: templateTasks.filter((t) => t.templateId === template.id),
      }))
      .sort((a, b) => a.roleName.localeCompare(b.roleName));
  }

  /** One template with its tasks, or null if the id is unknown. */
  async getWithTasks(templateId: string): Promise<TemplateWithTasks | null> {
    const template = await this.repo.templates.get(templateId);
    if (!template) return null;
    const tasks = await this.repo.templateTasks.where(
      (t) => t.templateId === templateId,
    );
    return { ...template, tasks };
  }

  // ---- Mutations ----------------------------------------------------------

  /**
   * Create a new role template. Role names are unique (case-insensitive) so a
   * hire's `roleName` maps to exactly one template.
   */
  async createTemplate(roleName: string): Promise<Template> {
    const name = roleName.trim();
    if (!name) throw new Error("roleName is required");

    const existing = await this.repo.templates.where(
      (t) => t.roleName.toLowerCase() === name.toLowerCase(),
    );
    if (existing.length > 0) {
      throw new Error(`A template for "${name}" already exists`);
    }

    return this.repo.templates.insert({ id: this.nextId(), roleName: name });
  }

  /** Add a task to a template. Validates the app id when the task grants a seat. */
  async addTask(
    templateId: string,
    input: TemplateTaskInput,
  ): Promise<TemplateTask> {
    const template = await this.repo.templates.get(templateId);
    if (!template) throw new Error(`Template "${templateId}" not found`);

    const task: TemplateTask = {
      id: this.nextId(),
      templateId,
      ...(await this.normalizeTaskInput(input)),
    };
    return this.repo.templateTasks.insert(task);
  }

  /** Edit an existing template task's fields. */
  async updateTask(
    taskId: string,
    input: Partial<TemplateTaskInput>,
  ): Promise<TemplateTask> {
    const existing = await this.repo.templateTasks.get(taskId);
    if (!existing) throw new Error(`Template task "${taskId}" not found`);

    const merged = await this.normalizeTaskInput({
      title: input.title ?? existing.title,
      ownerTeam: input.ownerTeam ?? existing.ownerTeam,
      cost: input.cost ?? existing.cost,
      costType: input.costType ?? existing.costType,
      appId: input.appId === undefined ? existing.appId : input.appId,
    });
    return this.repo.templateTasks.update(taskId, merged);
  }

  /** Remove a template task. */
  async removeTask(taskId: string): Promise<void> {
    const existing = await this.repo.templateTasks.get(taskId);
    if (!existing) throw new Error(`Template task "${taskId}" not found`);
    await this.repo.templateTasks.remove(taskId);
  }

  /**
   * Validate + default a task input into the stored shape. A task that grants a
   * seat (`appId` set) must reference a real catalog app; a `none` cost type
   * forces the cost to 0 so the ledger never sees a phantom charge.
   */
  private async normalizeTaskInput(
    input: TemplateTaskInput,
  ): Promise<Omit<TemplateTask, "id" | "templateId">> {
    const title = input.title.trim();
    if (!title) throw new Error("title is required");

    const appId = input.appId ?? null;
    if (appId) {
      const app = await this.repo.appCatalog.get(appId);
      if (!app) throw new Error(`Unknown app "${appId}"`);
    }

    const costType: CostType = input.costType ?? "none";
    const cost = costType === "none" ? 0 : Math.max(0, input.cost ?? 0);

    return { title, ownerTeam: input.ownerTeam, cost, costType, appId };
  }
}
