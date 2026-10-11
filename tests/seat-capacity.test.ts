/**
 * Route-level capacity tests (inventory-management spec, task 5).
 *
 * Exercises the three route handlers that gate seat capacity, against the
 * seeded in-memory store, asserting the 409 + non-mutation behavior:
 *   - PATCH /api/tasks/:id → in_progress on a full pool: task `blocked`, 409.
 *   - POST  /api/licenses on a full pool: 409, no license created.
 *   - POST  /api/licenses/:id/grant on a full pool: 409, license stays requested.
 *
 * GitHub is seeded fully allocated (250/250), so it's the "full pool" target.
 */

// Must be set before importing anything that pulls in the store singleton.
process.env.PROVISION_DB_PATH = ":memory:";

import { getServices } from "@/server/store";
import { PATCH as patchTask } from "@/app/api/tasks/[id]/route";
import { POST as postLicense } from "@/app/api/licenses/route";
import { POST as grantLicense } from "@/app/api/licenses/[id]/grant/route";

function jsonRequest(body: unknown): Request {
  return new Request("http://test/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Confirm GitHub is actually at capacity before the capacity assertions. */
async function assertGithubFull() {
  const { repo } = await getServices();
  const app = (await repo.appCatalog.get("github"))!;
  const licenses = await repo.licenses.list();
  const consuming = licenses.filter(
    (l) => l.appId === "github" && ["active", "idle", "reclaim"].includes(l.status),
  ).length;
  expect((app.seatsInUseBaseline ?? 0) + consuming).toBeGreaterThanOrEqual(app.seatsOwned);
}

describe("seat capacity — route level", () => {
  it("blocks starting a seat task when the pool is full (PATCH /api/tasks/:id)", async () => {
    await assertGithubFull();
    const { repo } = await getServices();

    // hire_5 has a todo "Grant GitHub seat" task (appId=github).
    const tasks = await repo.tasks.where(
      (t) => t.hireId === "hire_5" && t.appId === "github" && t.status === "todo",
    );
    const task = tasks[0]!;
    expect(task).toBeDefined();

    const ledgerBefore = (await repo.ledgerEntries.list()).length;

    const res = await patchTask(jsonRequest({ status: "in_progress" }), {
      params: Promise.resolve({ id: task.id }),
    });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.blocked).toBe(true);
    // Task is blocked, not in_progress.
    expect((await repo.tasks.get(task.id))!.status).toBe("blocked");
    // No ledger movement.
    expect((await repo.ledgerEntries.list()).length).toBe(ledgerBefore);
  });

  it("refuses POST /api/licenses when the pool is full", async () => {
    await assertGithubFull();
    const { repo } = await getServices();
    const licensesBefore = (await repo.licenses.list()).length;

    const res = await postLicense(jsonRequest({ hireId: "hire_1", appId: "github" }));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/No GitHub seats available/);
    // No license created.
    expect((await repo.licenses.list()).length).toBe(licensesBefore);
  });

  it("refuses POST /api/licenses/:id/grant when the pool is full, leaving the seat requested", async () => {
    await assertGithubFull();
    const { repo } = await getServices();

    // lic_10 is a seeded requested GitHub seat (hire_5).
    const waiting = (await repo.licenses.get("lic_10"))!;
    expect(waiting.status).toBe("requested");
    const ledgerBefore = (await repo.ledgerEntries.list()).length;

    const res = await grantLicense(jsonRequest({}), {
      params: Promise.resolve({ id: "lic_10" }),
    });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/No GitHub seats available/);
    // Stays requested, no ledger movement.
    expect((await repo.licenses.get("lic_10"))!.status).toBe("requested");
    expect((await repo.ledgerEntries.list()).length).toBe(ledgerBefore);
  });
});
