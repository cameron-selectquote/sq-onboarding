/**
 * getHireStatus read model — the data behind the Genie's "pull up a person"
 * status card. Runs against the seeded in-memory store.
 */

// Ephemeral store so the seed loads fresh; must be set before the store
// resolves its DB path (lazily, on first getServices()).
process.env.PROVISION_DB_PATH = ":memory:";

import { getHireStatus } from "@/server/queries";
import { getServices } from "@/server/store";

describe("getHireStatus", () => {
  it("returns null for an unknown hire id", async () => {
    expect(await getHireStatus("nope")).toBeNull();
  });

  it("summarizes a published hire's progress, software, and hardware", async () => {
    // hire_1 (Riley Chen) has github/slack/zoom active seats in the seed.
    const s = await getHireStatus("hire_1");
    expect(s).not.toBeNull();
    expect(s!.name).toBe("Riley Chen");
    expect(s!.roleName).toBe("Software Engineer");
    expect(s!.offboarding).toBe(false);

    const apps = s!.seats.map((seat) => seat.app).sort();
    expect(apps).toContain("GitHub");
    expect(apps).toContain("Slack");
    // Active seats contribute to recurring spend.
    expect(s!.monthlyRecurring).toBeGreaterThan(0);

    // Progress is derived from tasks: done never exceeds total.
    expect(s!.done).toBeLessThanOrEqual(s!.total);
  });

  it("excludes revoked seats and flags the offboarding cohort", async () => {
    const { repo } = await getServices();
    // Revoke one of hire_1's seats; it should drop off the status card.
    const before = await getHireStatus("hire_1");
    const beforeCount = before!.seats.length;
    const seats = await repo.licenses.where((l) => l.hireId === "hire_1");
    await repo.licenses.update(seats[0]!.id, { status: "revoked" });

    const after = await getHireStatus("hire_1");
    expect(after!.seats.length).toBe(beforeCount - 1);

    // hire_off (Quinn Baker) is seeded into the offboarding cohort.
    const off = await getHireStatus("hire_off");
    expect(off!.offboarding).toBe(true);
  });
});
