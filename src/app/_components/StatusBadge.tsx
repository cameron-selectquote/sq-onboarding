import type { AssetStatus, LicenseStatus, TaskStatus } from "@/lib/types";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "review",
  "blocked",
  "done",
];

const LABELS: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
  active: "Active",
  idle: "Idle",
  reclaim: "Reclaim",
  revoked: "Revoked",
  in_stock: "In stock",
  assigned: "Assigned",
  in_repair: "In repair",
  returned: "Returned",
  retired: "Retired",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function StatusBadge({
  status,
}: {
  status: TaskStatus | LicenseStatus | AssetStatus;
}) {
  return <span className={`badge badge-${status}`}>{statusLabel(status)}</span>;
}
