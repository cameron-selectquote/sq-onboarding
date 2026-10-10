/**
 * PO + asset provisioning (BuildPlan §2 "How assets flow", §3 /api/pos).
 *
 *   raisePurchaseOrder: one-time ledger_entry against a budget -> provision an
 *                       `asset` (status assigned, linked to the hire)
 *   returnAsset:        mark an asset returned on offboarding (hardware analog
 *                       of license revoke) and credit residual value back
 *
 * Hardware is capital that gets tracked, assigned, and recovered — the physical
 * mirror of the seat-reclaim story.
 */

import { residualValue } from "./finance";
import {
  defaultClock,
  defaultIdGenerator,
  type Clock,
  type IdGenerator,
} from "./ids";
import { LedgerService } from "./ledger";
import type { Repository } from "./repository";
import type { Asset } from "./types";

export interface AssetServiceOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export interface PurchaseOrderInput {
  assetCatalogId: string;
  hireId: string;
  serialTag: string;
}

export class AssetService {
  private readonly repo: Repository;
  private readonly ledger: LedgerService;
  private readonly nextId: IdGenerator;
  private readonly now: Clock;

  constructor(
    repo: Repository,
    ledger: LedgerService,
    options: AssetServiceOptions = {},
  ) {
    this.repo = repo;
    this.ledger = ledger;
    this.nextId = options.idGenerator ?? defaultIdGenerator;
    this.now = options.clock ?? defaultClock;
  }

  /**
   * Raise a PO: write a one-time ledger entry against the vendor budget and
   * provision a new asset assigned to the hire.
   */
  async raisePurchaseOrder(input: PurchaseOrderInput): Promise<Asset> {
    const catalog = await this.repo.assetCatalog.get(input.assetCatalogId);
    if (!catalog) {
      throw new Error(`Asset catalog item "${input.assetCatalogId}" not found`);
    }

    const acquiredAt = this.now().toISOString();
    const asset: Asset = {
      id: this.nextId(),
      catalogId: catalog.id,
      serialTag: input.serialTag,
      status: "assigned",
      assignedToHireId: input.hireId,
      acquiredAt,
      returnedAt: null,
    };
    const created = await this.repo.assets.insert(asset);

    await this.ledger.writeEntry({
      hireId: input.hireId,
      type: "asset_purchase",
      label: `PO: ${catalog.name}`,
      amount: catalog.standardCost,
      costType: "one_time",
      refTable: "asset",
      refId: created.id,
      budgetTeam: "vendor",
    });

    return created;
  }

  /**
   * Return an asset on offboarding: mark it returned and credit back its
   * residual (depreciated) value against the vendor budget.
   */
  async returnAsset(assetId: string): Promise<Asset> {
    const asset = await this.repo.assets.get(assetId);
    if (!asset) throw new Error(`Asset "${assetId}" not found`);

    const catalog = await this.repo.assetCatalog.get(asset.catalogId);
    if (!catalog) {
      throw new Error(`Asset catalog item "${asset.catalogId}" not found`);
    }

    const returnedAt = this.now();
    const residual = residualValue(catalog, asset, returnedAt);

    await this.ledger.writeEntry({
      hireId: asset.assignedToHireId,
      type: "asset_return",
      label: `Return: ${catalog.name}`,
      amount: -residual, // credit — recovers residual capital value
      costType: "one_time",
      refTable: "asset",
      refId: asset.id,
      budgetTeam: "vendor",
    });

    return this.repo.assets.update(assetId, {
      status: "returned",
      assignedToHireId: null,
      returnedAt: returnedAt.toISOString(),
    });
  }
}
