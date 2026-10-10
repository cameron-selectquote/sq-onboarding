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
import type { Repository } from "./repository";
import type { License } from "./types";

export class LicenseService {
  private readonly repo: Repository;
  private readonly ledger: LedgerService;

  constructor(repo: Repository, ledger: LedgerService) {
    this.repo = repo;
    this.ledger = ledger;
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
