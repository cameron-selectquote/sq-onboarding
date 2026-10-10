/**
 * Seed dataset (BuildPlan §4 QA workstream, §8 step 3).
 *
 * One company, ~5 teams, catalog apps, catalog asset types with a small on-hand
 * inventory, templates, hires, and budgets. Realistic enough to make the demo
 * land and to unblock the frontend before the backend is done.
 *
 * `seedData` is the raw dataset; `loadSeed(repo)` inserts it into any
 * Repository. Keep ids human-readable so they're easy to reference in the UI
 * and tests.
 */

import type { Repository } from "@/lib/repository";
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  Company,
  Hire,
  License,
  Template,
  TemplateTask,
  User,
} from "@/lib/types";

/**
 * Cohort convention for a hire that's offboarding. The reclaim route treats
 * hires with this cohort as "assets should come back" (see the reclaim-
 * visibility spec). A stand-in for a real offboarding column — swap later
 * without touching the type contract.
 */
export const OFFBOARDING_COHORT = "offboarding";

export interface SeedData {
  companies: Company[];
  users: User[];
  appCatalog: AppCatalogItem[];
  assetCatalog: AssetCatalogItem[];
  assets: Asset[];
  templates: Template[];
  templateTasks: TemplateTask[];
  hires: Hire[];
  licenses: License[];
  budgets: Budget[];
}

/** A recent timestamp so "actively used" seats never trip the idle rule. */
const RECENTLY_USED = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

export const seedData: SeedData = {
  companies: [
    { id: "acme", name: "Acme Robotics", size: 240, industry: "Hardware" },
  ],

  users: [
    { id: "u_admin", name: "Avery Admin", email: "avery@acme.test", role: "admin", team: null, managerId: null },
    { id: "u_spec", name: "Sam Specialist", email: "sam@acme.test", role: "specialist", team: "hr", managerId: null },
    { id: "u_mgr", name: "Morgan Manager", email: "morgan@acme.test", role: "manager", team: null, managerId: null },
    { id: "u_it", name: "Ivy IT", email: "ivy@acme.test", role: "team_member", team: "it", managerId: null },
    { id: "u_vendor", name: "Val Vendor", email: "val@acme.test", role: "team_member", team: "vendor", managerId: null },
    { id: "u_fin", name: "Fin Finance", email: "fin@acme.test", role: "team_member", team: "finance", managerId: null },
  ],

  appCatalog: [
    { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly" },
    { id: "gitlab", name: "GitLab", category: "dev", costPerSeat: 19, billing: "monthly" },
    { id: "slack", name: "Slack", category: "comms", costPerSeat: 8, billing: "monthly" },
    { id: "jira", name: "Jira", category: "pm", costPerSeat: 14, billing: "monthly" },
    { id: "figma", name: "Figma", category: "design", costPerSeat: 15, billing: "monthly" },
    { id: "notion", name: "Notion", category: "docs", costPerSeat: 10, billing: "monthly" },
    { id: "zoom", name: "Zoom", category: "comms", costPerSeat: 180, billing: "annual" },
    { id: "gsuite", name: "Google Workspace", category: "docs", costPerSeat: 12, billing: "monthly" },
    { id: "1password", name: "1Password", category: "security", costPerSeat: 8, billing: "monthly" },
  ],

  assetCatalog: [
    { id: "mbp16", name: "MacBook Pro 16\"", category: "laptop", standardCost: 2800, depreciationMonths: 36 },
    { id: "mon27", name: "27\" Monitor", category: "monitor", standardCost: 420, depreciationMonths: 36 },
    { id: "badge", name: "Access Badge", category: "facilities", standardCost: 25, depreciationMonths: 12 },
    { id: "iphone", name: "iPhone 15", category: "phone", standardCost: 999, depreciationMonths: 24 },
    { id: "headset", name: "Noise-cancelling Headset", category: "peripheral", standardCost: 320, depreciationMonths: 24 },
  ],

  // A small on-hand inventory so assetsOnHand() is non-trivial in the demo.
  assets: [
    { id: "asset_mbp_1", catalogId: "mbp16", serialTag: "MBP-0001", status: "in_stock", assignedToHireId: null, acquiredAt: "2026-01-05", returnedAt: null },
    { id: "asset_mbp_2", catalogId: "mbp16", serialTag: "MBP-0002", status: "in_stock", assignedToHireId: null, acquiredAt: "2026-01-05", returnedAt: null },
    { id: "asset_mon_1", catalogId: "mon27", serialTag: "MON-0001", status: "in_stock", assignedToHireId: null, acquiredAt: "2026-01-05", returnedAt: null },
    { id: "asset_badge_1", catalogId: "badge", serialTag: "BDG-0001", status: "in_stock", assignedToHireId: null, acquiredAt: "2026-01-05", returnedAt: null },
    // Assigned to the offboarding hire — flagged pending_return by reclaim.
    { id: "asset_mbp_3", catalogId: "mbp16", serialTag: "MBP-0003", status: "assigned", assignedToHireId: "hire_off", acquiredAt: "2025-06-01", returnedAt: null },
  ],

  templates: [
    { id: "tpl_swe", roleName: "Software Engineer" },
    { id: "tpl_designer", roleName: "Designer" },
    { id: "tpl_ops", roleName: "Operations" },
  ],

  templateTasks: [
    // Software Engineer
    { id: "tt_swe_1", templateId: "tpl_swe", title: "Create email + SSO", ownerTeam: "it", cost: 0, costType: "none" },
    { id: "tt_swe_2", templateId: "tpl_swe", title: "Order laptop", ownerTeam: "vendor", cost: 2800, costType: "one_time" },
    { id: "tt_swe_3", templateId: "tpl_swe", title: "Grant GitHub seat", ownerTeam: "it", cost: 21, costType: "recurring" },
    { id: "tt_swe_4", templateId: "tpl_swe", title: "Grant Slack seat", ownerTeam: "it", cost: 8, costType: "recurring" },
    { id: "tt_swe_5", templateId: "tpl_swe", title: "Issue access badge", ownerTeam: "facilities", cost: 25, costType: "one_time" },
    // Designer
    { id: "tt_des_1", templateId: "tpl_designer", title: "Create email + SSO", ownerTeam: "it", cost: 0, costType: "none" },
    { id: "tt_des_2", templateId: "tpl_designer", title: "Order laptop", ownerTeam: "vendor", cost: 2800, costType: "one_time" },
    { id: "tt_des_3", templateId: "tpl_designer", title: "Grant Figma seat", ownerTeam: "it", cost: 15, costType: "recurring" },
    { id: "tt_des_4", templateId: "tpl_designer", title: "Grant Slack seat", ownerTeam: "it", cost: 8, costType: "recurring" },
    // Operations
    { id: "tt_ops_1", templateId: "tpl_ops", title: "Create email + SSO", ownerTeam: "it", cost: 0, costType: "none" },
    { id: "tt_ops_2", templateId: "tpl_ops", title: "Grant Notion seat", ownerTeam: "it", cost: 10, costType: "recurring" },
    { id: "tt_ops_3", templateId: "tpl_ops", title: "Issue access badge", ownerTeam: "facilities", cost: 25, costType: "one_time" },
  ],

  hires: [
    { id: "hire_1", name: "Riley Chen", email: "riley@acme.test", roleName: "Software Engineer", managerId: "u_mgr", startDate: "2026-02-02", cohort: "2026-Feb" },
    { id: "hire_2", name: "Jordan Patel", email: "jordan@acme.test", roleName: "Software Engineer", managerId: "u_mgr", startDate: "2026-02-02", cohort: "2026-Feb" },
    { id: "hire_3", name: "Taylor Kim", email: "taylor@acme.test", roleName: "Designer", managerId: "u_mgr", startDate: "2026-02-09", cohort: "2026-Feb" },
    { id: "hire_4", name: "Casey Nguyen", email: "casey@acme.test", roleName: "Operations", managerId: "u_mgr", startDate: "2026-02-09", cohort: "2026-Feb" },
    { id: "hire_5", name: "Drew Alvarez", email: "drew@acme.test", roleName: "Software Engineer", managerId: "u_mgr", startDate: "2026-02-16", cohort: "2026-Feb" },
    // Offboarding hire — their assigned asset is pending return (reclaim beat).
    { id: "hire_off", name: "Quinn Baker", email: "quinn@acme.test", roleName: "Software Engineer", managerId: "u_mgr", startDate: "2025-06-01", cohort: OFFBOARDING_COHORT },
  ],

  // Pre-granted licenses so the reclaim banner starts red:
  //   - hire_1 has an idle GitHub seat (unused since early 2025)
  //   - hire_2 holds GitHub + GitLab, a duplicate "dev"-category pair
  //   - hire_off's seats sit under an offboarding hire
  licenses: [
    { id: "lic_idle_1", hireId: "hire_1", appId: "github", status: "active", grantedAt: "2025-01-10T00:00:00.000Z", lastUsedAt: "2025-02-01T00:00:00.000Z" },
    { id: "lic_dup_1a", hireId: "hire_2", appId: "github", status: "active", grantedAt: "2026-02-02T00:00:00.000Z", lastUsedAt: RECENTLY_USED },
    { id: "lic_dup_1b", hireId: "hire_2", appId: "gitlab", status: "active", grantedAt: "2026-02-02T00:00:00.000Z", lastUsedAt: RECENTLY_USED },
  ],

  budgets: [
    { id: "bud_it", team: "it", period: "2026-Q1", limit: 5000, spent: 0 },
    { id: "bud_vendor", team: "vendor", period: "2026-Q1", limit: 40000, spent: 0 },
    { id: "bud_facilities", team: "facilities", period: "2026-Q1", limit: 2000, spent: 0 },
    { id: "bud_hr", team: "hr", period: "2026-Q1", limit: 3000, spent: 0 },
    { id: "bud_finance", team: "finance", period: "2026-Q1", limit: 3000, spent: 0 },
  ],
};

/** Insert the seed dataset into a repository. Idempotent on a fresh repo. */
export async function loadSeed(repo: Repository, data: SeedData = seedData): Promise<void> {
  for (const c of data.companies) await repo.companies.insert(c);
  for (const u of data.users) await repo.users.insert(u);
  for (const a of data.appCatalog) await repo.appCatalog.insert(a);
  for (const a of data.assetCatalog) await repo.assetCatalog.insert(a);
  for (const a of data.assets) await repo.assets.insert(a);
  for (const t of data.templates) await repo.templates.insert(t);
  for (const t of data.templateTasks) await repo.templateTasks.insert(t);
  for (const h of data.hires) await repo.hires.insert(h);
  for (const l of data.licenses) await repo.licenses.insert(l);
  for (const b of data.budgets) await repo.budgets.insert(b);
}
