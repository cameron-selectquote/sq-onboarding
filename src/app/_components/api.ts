/**
 * Thin client-side fetch helpers + response shapes for the /api routes.
 * No business logic here — views call these and render.
 */
import type { FinanceSummary } from "@/lib/finance";
import type { Checklist } from "@/lib/checklist";
import type {
  AppCatalogItem,
  Asset,
  AssetCatalogItem,
  Budget,
  Hire,
  License,
  Task,
  TaskStatus,
  Template,
} from "@/lib/types";

export interface HireDetail {
  hire: Hire;
  tasks: Task[];
  licenses: License[];
  totalSpend: number;
}

export interface FinanceResponse {
  summary: FinanceSummary;
  budgets: Budget[];
}

export interface CatalogResponse {
  apps: AppCatalogItem[];
  assetCatalog: AssetCatalogItem[];
  templates: Template[];
}

export interface AssetsResponse {
  assets: Asset[];
  onHand: number;
}

export interface ImportRow {
  name: string;
  email: string;
  roleName: string;
  startDate: string;
  managerId?: string | null;
  appIds?: string[];
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

export async function apiSend<T>(
  path: string,
  method: "POST" | "PATCH",
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return (await res.json()) as T;
}

// ---- loaders (module-level so they're stable for usePoll) -----------------

/** Every hire with tasks, licenses, and spend. Small N for the demo. */
export async function loadHireDetails(): Promise<HireDetail[]> {
  const { hires } = await apiGet<{ hires: Hire[] }>("/api/hires");
  return Promise.all(
    hires.map((h) => apiGet<HireDetail>(`/api/hires/${encodeURIComponent(h.id)}`)),
  );
}

export const loadFinance = () => apiGet<FinanceResponse>("/api/finance/summary");
export const loadCatalog = () => apiGet<CatalogResponse>("/api/catalog");
export const loadAssets = () => apiGet<AssetsResponse>("/api/assets");
export const loadChecklist = (hireId: string) =>
  apiGet<Checklist>(`/api/hires/${encodeURIComponent(hireId)}/checklist`);

// ---- actions --------------------------------------------------------------

export const updateTaskStatus = (taskId: string, status: TaskStatus) =>
  apiSend<{ task: Task }>(`/api/tasks/${encodeURIComponent(taskId)}`, "PATCH", { status });

export const grantLicense = (licenseId: string) =>
  apiSend<{ license: License }>(`/api/licenses/${encodeURIComponent(licenseId)}/grant`, "POST");

export const revokeLicense = (licenseId: string) =>
  apiSend<{ license: License }>(`/api/licenses/${encodeURIComponent(licenseId)}/revoke`, "POST");

export const raisePurchaseOrder = (input: {
  assetCatalogId: string;
  hireId: string;
  serialTag: string;
}) => apiSend<{ asset: Asset }>("/api/pos", "POST", input);

export const returnAsset = (assetId: string) =>
  apiSend<{ asset: Asset }>(`/api/assets/${encodeURIComponent(assetId)}/return`, "POST");

export const importHires = (rows: ImportRow[]) =>
  apiSend<{ created: { hire: Hire; taskCount: number; licenseCount: number }[] }>(
    "/api/hires/import",
    "POST",
    { rows },
  );

export const matchTemplate = (title: string) =>
  apiSend<{ match: { roleName: string; suggestedAppIds: string[]; confidence: number } }>(
    "/api/ai/match-template",
    "POST",
    { title },
  );
