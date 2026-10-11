/**
 * Offboarding — the Genie's reclaim muscle (the money-shot beat).
 *
 * Offboarding a hire recovers spend:
 *   - revoke their active software seats  (LicenseService.revoke -> credit)
 *   - return their assigned hardware       (AssetService.returnAsset -> credit)
 * Both are DESTRUCTIVE (they change license/asset state and move the ledger),
 * so this module separates a read-only PREVIEW from EXECUTE. The Genie must
 * preview and get explicit confirmation before calling execute.
 *
 * Reuses the real services, so every credit flows through the ledger and the
 * finance/reclaim views reflect the recovery automatically.
 */

import { monthlyCost, residualValue } from "./finance";
import type { AssetService } from "./assets";
import type { LicenseService } from "./licenses";
import type { Repository } from "./repository";

export interface OffboardSeat {
  licenseId: string;
  appId: string;
  appName: string;
  /** Recurring monthly cost recovered by revoking. */
  monthly: number;
}

export interface OffboardAsset {
  assetId: string;
  catalogId: string;
  name: string;
  serialTag: string;
  /** Residual (depreciated) value credited back on return. */
  residual: number;
}

export interface OffboardPreview {
  hireId: string;
  hireName: string;
  seats: OffboardSeat[];
  assets: OffboardAsset[];
  /** Sum of seat monthly costs recovered (recurring burn dropped). */
  monthlyRecovered: number;
  /** Sum of asset residual values credited (one-time recovery). */
  oneTimeRecovered: number;
  /** True when there's nothing active to reclaim. */
  nothingToReclaim: boolean;
}

export interface OffboardResult extends OffboardPreview {
  revokedSeatIds: string[];
  returnedAssetIds: string[];
}

export class OffboardingService {
  private readonly repo: Repository;
  private readonly licenses: LicenseService;
  private readonly assets: AssetService;

  constructor(repo: Repository, licenses: LicenseService, assets: AssetService) {
    this.repo = repo;
    this.licenses = licenses;
    this.assets = assets;
  }

  /**
   * Read-only: what offboarding this hire would reclaim. Safe to call anytime;
   * changes nothing. The Genie shows this before asking to confirm.
   */
  async preview(hireId: string): Promise<OffboardPreview> {
    const hire = await this.repo.hires.get(hireId);
    if (!hire) throw new Error(`Hire "${hireId}" not found`);

    const [licenses, apps, assets, assetCatalog] = await Promise.all([
      this.repo.licenses.where((l) => l.hireId === hireId),
      this.repo.appCatalog.list(),
      this.repo.assets.where((a) => a.assignedToHireId === hireId),
      this.repo.assetCatalog.list(),
    ]);
    const appById = new Map(apps.map((a) => [a.id, a]));
    const catById = new Map(assetCatalog.map((c) => [c.id, c]));
    const now = new Date();

    // Only seats that currently cost money (active or idle) are worth revoking.
    const seats: OffboardSeat[] = licenses
      .filter((l) => l.status === "active" || l.status === "idle")
      .map((l) => {
        const app = appById.get(l.appId);
        return {
          licenseId: l.id,
          appId: l.appId,
          appName: app?.name ?? l.appId,
          monthly: app ? monthlyCost(app.costPerSeat, app.billing) : 0,
        };
      });

    // Hardware still assigned to the hire can be returned for residual value.
    const assetRows: OffboardAsset[] = assets
      .filter((a) => a.status === "assigned")
      .map((a) => {
        const cat = catById.get(a.catalogId);
        return {
          assetId: a.id,
          catalogId: a.catalogId,
          name: cat?.name ?? a.catalogId,
          serialTag: a.serialTag,
          residual: cat ? residualValue(cat, a, now) : 0,
        };
      });

    const monthlyRecovered = seats.reduce((s, x) => s + x.monthly, 0);
    const oneTimeRecovered = assetRows.reduce((s, x) => s + x.residual, 0);

    return {
      hireId,
      hireName: hire.name,
      seats,
      assets: assetRows,
      monthlyRecovered,
      oneTimeRecovered,
      nothingToReclaim: seats.length === 0 && assetRows.length === 0,
    };
  }

  /**
   * DESTRUCTIVE. Revoke the hire's seats and return their assets. Only call
   * after the user has seen the preview and explicitly confirmed. Returns the
   * same shape as the preview plus what was actually acted on.
   */
  async execute(hireId: string): Promise<OffboardResult> {
    const preview = await this.preview(hireId);

    const revokedSeatIds: string[] = [];
    for (const seat of preview.seats) {
      await this.licenses.revoke(seat.licenseId);
      revokedSeatIds.push(seat.licenseId);
    }

    const returnedAssetIds: string[] = [];
    for (const asset of preview.assets) {
      await this.assets.returnAsset(asset.assetId);
      returnedAssetIds.push(asset.assetId);
    }

    return { ...preview, revokedSeatIds, returnedAssetIds };
  }
}
