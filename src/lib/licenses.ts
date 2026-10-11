/**
 * License grant/revoke transitions (BuildPlan §3).
 *
 *   grant:  mark a license active + write a recurring ledger_entry + bump budget
 *   revoke: mark a license revoked + write a crediting ledger_entry (recovers
 *           the recurring seat), dropping it from live burn
 *
 * Spend always flows through the LedgerService so the ledger stays the single
 * source of truth.
 */

import { LedgerService } from "./ledger";
import { monthlyCost } from "./finance";
import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from "./ids";
import type { Repository } from "./repository";
import type { License } from "./types";

export interface LicenseServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export class LicenseService {
  private readonly repo: Repository;
  private readonly ledger: LedgerService;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(repo: Repository, ledger: LedgerService, options: LicenseServiceOptions = {}) {
    this.repo = repo;
    this.ledger = ledger;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  /**
   * Assign a brand-new seat to an existing hire: create the license (active),
   * write the recurring ledger entry, and bump the budget — the create-and-grant
   * bridge for people who were already onboarded. Mirrors how a PO creates and
   * charges an asset in one call.
   */
  async assign(hireId: string, appId: string): Promise<License> {
    const hire = await this.repo.hires.get(hireId);
    if (!hire) throw new Error(`Hire "${hireId}" not found`);

    const app = await this.repo.appCatalog.get(appId);
    if (!app) throw new Error(`App "${appId}" not found`);

    const monthly = monthlyCost(app.costPerSeat, app.billing);
    const now = this.now().toISOString();

    const license: License = {
      id: this.nextId(),
      hireId,
      appId,
      status: "active",
      grantedAt: now,
      lastUsedAt: now,
    };
    await this.repo.licenses.insert(license);

    await this.ledger.writeEntry({
      hireId,
      type: "license_grant",
      label: `Assign: ${app.name}`,
      amount: monthly,
      costType: "recurring",
      refTable: "license",
      refId: license.id,
      budgetTeam: "it",
    });

    return license;
  }

  /** Grant a seat: license -> active, write recurring ledger entry, bump budget. */
  async grant(licenseId: string): Promise<License> {
    const license = await this.requireLicense(licenseId);

    const app = await this.repo.appCatalog.get(license.appId);
    if (!app) throw new Error(`App "${license.appId}" not found`);

    const monthly = monthlyCost(app.costPerSeat, app.billing);

    await this.ledger.writeEntry({
      hireId: license.hireId,
      type: "license_grant",
      label: `Grant: ${app.name}`,
      amount: monthly,
      costType: "recurring",
      refTable: "license",
      refId: license.id,
      budgetTeam: "it",
    });

    const now = new Date().toISOString();
    return this.repo.licenses.update(licenseId, {
      status: "active",
      grantedAt: license.grantedAt ?? now,
      lastUsedAt: now,
    });
  }

  /** Revoke a seat: license -> revoked, write crediting ledger entry, drop burn. */
  async revoke(licenseId: string): Promise<License> {
    const license = await this.requireLicense(licenseId);
    const app = await this.repo.appCatalog.get(license.appId);
    if (!app) throw new Error(`App "${license.appId}" not found`);

    const monthly = monthlyCost(app.costPerSeat, app.billing);

    await this.ledger.writeEntry({
      hireId: license.hireId,
      type: "license_revoke",
      label: `Revoke: ${app.name}`,
      amount: -monthly, // credit — recovers the recurring seat
      costType: "recurring",
      refTable: "license",
      refId: license.id,
      budgetTeam: "it",
    });

    return this.repo.licenses.update(licenseId, { status: "revoked" });
  }

  private async requireLicense(licenseId: string): Promise<License> {
    const license = await this.repo.licenses.get(licenseId);
    if (!license) throw new Error(`License "${licenseId}" not found`);
    return license;
  }
}
