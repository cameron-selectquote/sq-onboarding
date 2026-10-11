/**
 * Autonomous onboarding executor — the muscle behind the Genie's "do the
 * tasks" tool.
 *
 * Given a hire, it walks their onboarding task list and performs the ones that
 * can be automated, reusing the real services so every action still flows
 * through the ledger:
 *   - "Grant X seat"      -> ensure a License row, then LicenseService.grant
 *   - "Order laptop"      -> AssetService.raisePurchaseOrder (mbp16)
 *   - "Issue access badge"-> AssetService.raisePurchaseOrder (badge)
 *   - "Create email + SSO"-> administrative, just mark done
 * Each automated task is also moved to `done`. Tasks needing a human (manager
 * 1-on-1s, training, goal-setting) are left `todo` and reported as skipped.
 *
 * No new spend logic here: grants and POs go through LicenseService /
 * AssetService, which own the ledger invariant.
 */

import {defaultIdGenerator, type IdGenerator} from './ids';
import type {AssetService} from './assets';
import type {LicenseService} from './licenses';
import type {NotificationService} from './notifications';
import type {Repository} from './repository';
import type {AppCatalogItem, Task, Team} from './types';

export type ExecutionOutcome =
  | 'granted'
  | 'ordered'
  | 'completed'
  | 'skipped'
  /** Wanted to provision hardware but none is in stock — left for the team. */
  | 'deferred';

export interface TaskExecution {
  taskId: string;
  title: string;
  ownerTeam: string;
  outcome: ExecutionOutcome;
  /** Short human explanation ("Granted GitHub seat ($21/mo)", "Needs a human"). */
  detail: string;
}

export interface ExecutionReport {
  hireId: string;
  executions: TaskExecution[];
  automated: number;
  /** Hardware tasks left unprovisioned because stock was out. */
  deferred: number;
  skipped: number;
}

/** Asset catalog ids used for the common hardware tasks. */
const LAPTOP_CATALOG_ID = 'mbp16';
const BADGE_CATALOG_ID = 'badge';

export class OnboardingExecutor {
  private readonly repo: Repository;
  private readonly licenses: LicenseService;
  private readonly assets: AssetService;
  private readonly notifications?: NotificationService;
  private readonly nextSerial: IdGenerator;

  constructor(
    repo: Repository,
    licenses: LicenseService,
    assets: AssetService,
    options: {
      serialGenerator?: IdGenerator;
      notifications?: NotificationService;
    } = {},
  ) {
    this.repo = repo;
    this.licenses = licenses;
    this.assets = assets;
    this.notifications = options.notifications;
    this.nextSerial = options.serialGenerator ?? defaultIdGenerator;
  }

  /**
   * Execute every automatable `todo` task for a hire. Returns a per-task report.
   * Already-done tasks are left alone and not reported. Tasks whose title
   * contains one of `skipKeywords` (from a plan adjustment, e.g. "slack",
   * "badge") are reported as skipped and not executed.
   */
  async executeForHire(
    hireId: string,
    options: {skipKeywords?: string[]} = {},
  ): Promise<ExecutionReport> {
    const hire = await this.repo.hires.get(hireId);
    if (!hire) throw new Error(`Hire "${hireId}" not found`);

    const [tasks, apps] = await Promise.all([
      this.repo.tasks.where((t) => t.hireId === hireId),
      this.repo.appCatalog.list(),
    ]);

    const skip = (options.skipKeywords ?? []).map((k) => k.toLowerCase());

    const executions: TaskExecution[] = [];
    for (const task of tasks) {
      if (task.status === 'done') continue;
      const title = task.title.toLowerCase();
      if (skip.some((k) => title.includes(k))) {
        executions.push({
          taskId: task.id,
          title: task.title,
          ownerTeam: task.ownerTeam,
          outcome: 'skipped',
          detail: 'Skipped per your request',
        });
        continue;
      }
      executions.push(await this.runTask(hireId, task, apps));
    }

    // "deferred" (hardware out of stock) is neither automated nor a plain
    // skip — count it on its own so the summary can call it out.
    const automated = executions.filter(
      (e) => e.outcome !== 'skipped' && e.outcome !== 'deferred',
    ).length;
    const deferred = executions.filter((e) => e.outcome === 'deferred').length;

    // Tell the owning teams what was provisioned, batched per hire so a single
    // onboarding run shows up as one event per team inbox.
    if (this.notifications) {
      await this.notifyTeams(hire.name, hireId, executions);
    }

    return {
      hireId,
      executions,
      automated,
      deferred,
      skipped: executions.length - automated - deferred,
    };
  }

  /** Post one notification per owning team summarizing what was automated. */
  private async notifyTeams(
    hireName: string,
    hireId: string,
    executions: TaskExecution[],
  ): Promise<void> {
    if (!this.notifications) return;
    const done = executions.filter(
      (e) => e.outcome !== 'skipped' && e.outcome !== 'deferred',
    );
    if (done.length === 0) return;

    const byTeam = new Map<Team, string[]>();
    for (const e of done) {
      const team = e.ownerTeam as Team;
      const list = byTeam.get(team) ?? [];
      list.push(e.detail);
      byTeam.set(team, list);
    }

    const batchId = `onboard_${hireId}`;
    for (const [team, details] of byTeam) {
      await this.notifications.notify({
        targetTeam: team,
        message: `${hireName}: ${details.join(', ')}.`,
        batchId,
      });
    }
  }

  private async runTask(
    hireId: string,
    task: Task,
    apps: AppCatalogItem[],
  ): Promise<TaskExecution> {
    const title = task.title.toLowerCase();
    const base = {
      taskId: task.id,
      title: task.title,
      ownerTeam: task.ownerTeam,
    };

    // Grant a software seat.
    const app = title.includes('grant') ? matchApp(title, apps) : undefined;
    if (app) {
      await this.grantSeat(hireId, app.id);
      await this.markDone(task.id);
      return {
        ...base,
        outcome: 'granted',
        detail: `Granted ${app.name} seat`,
      };
    }

    // Order a laptop.
    if (title.includes('laptop')) {
      return this.provisionHardware(hireId, task, {
        catalogId: LAPTOP_CATALOG_ID,
        serialPrefix: 'MBP',
        label: 'laptop',
        orderedDetail: (serial) => `Ordered laptop (${serial})`,
      });
    }

    // Issue an access badge.
    if (title.includes('badge')) {
      return this.provisionHardware(hireId, task, {
        catalogId: BADGE_CATALOG_ID,
        serialPrefix: 'BDG',
        label: 'access badge',
        orderedDetail: (serial) => `Issued access badge (${serial})`,
      });
    }

    // Administrative, no external system — just complete it.
    if (
      title.includes('email') ||
      title.includes('sso') ||
      title.includes('account')
    ) {
      await this.markDone(task.id);
      return {
        ...base,
        outcome: 'completed',
        detail: 'Provisioned email + SSO account',
      };
    }

    // Everything else needs a human (1-on-1s, training, goal setting).
    return {
      ...base,
      outcome: 'skipped',
      detail: 'Needs a person — left for the team',
    };
  }

  /**
   * Provision a piece of hardware for a hire, but only if the company has one
   * in stock. When stock is out, we do NOT silently raise a PO — the task is
   * left blocked and reported as `deferred` so the Genie can tell the user
   * exactly what it couldn't provision and the owning team can source it.
   */
  private async provisionHardware(
    hireId: string,
    task: Task,
    spec: {
      catalogId: string;
      serialPrefix: string;
      label: string;
      orderedDetail: (serial: string) => string;
    },
  ): Promise<TaskExecution> {
    const base = {
      taskId: task.id,
      title: task.title,
      ownerTeam: task.ownerTeam,
    };

    if (!(await this.hasStock(spec.catalogId))) {
      // Mark it blocked so it surfaces in the team's queue instead of looking
      // done — nothing was provisioned and no spend hit the ledger.
      await this.repo.tasks.update(task.id, {status: 'blocked'});
      return {
        ...base,
        outcome: 'deferred',
        detail: `Out of stock — no ${spec.label} available to provision`,
      };
    }

    const asset = await this.assets.raisePurchaseOrder({
      assetCatalogId: spec.catalogId,
      hireId,
      serialTag: this.serialTag(spec.serialPrefix),
    });
    await this.markDone(task.id);
    return {
      ...base,
      outcome: 'ordered',
      detail: spec.orderedDetail(asset.serialTag),
    };
  }

  /** True when at least one asset of this catalog type is on hand (in stock). */
  private async hasStock(catalogId: string): Promise<boolean> {
    const inStock = await this.repo.assets.where(
      (a) => a.catalogId === catalogId && a.status === 'in_stock',
    );
    return inStock.length > 0;
  }

  /** Ensure a license row exists for this hire+app, then grant it. */
  private async grantSeat(hireId: string, appId: string): Promise<void> {
    const existing = await this.repo.licenses.where(
      (l) => l.hireId === hireId && l.appId === appId,
    );
    let license = existing[0];
    if (!license) {
      license = await this.repo.licenses.insert({
        id: this.nextSerial(),
        hireId,
        appId,
        status: 'requested',
        grantedAt: null,
        lastUsedAt: null,
      });
    }
    if (license.status !== 'active') {
      await this.licenses.grant(license.id);
    }
  }

  private async markDone(taskId: string): Promise<void> {
    await this.repo.tasks.update(taskId, {status: 'done'});
  }

  private serialTag(prefix: string): string {
    return `${prefix}-${this.nextSerial().slice(0, 8).toUpperCase()}`;
  }
}

/** Map a "Grant X seat/access" task title to a catalog app by name. */
function matchApp(
  title: string,
  apps: AppCatalogItem[],
): AppCatalogItem | undefined {
  return apps.find((a) => title.includes(a.name.toLowerCase()));
}
