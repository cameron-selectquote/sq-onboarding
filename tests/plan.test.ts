import {
  addSeat,
  defaultSeatsForRole,
  includeTask,
  isSkipped,
  newPlan,
  removeSeat,
  resolveAppId,
  setRole,
  setStartDate,
  skipTask,
} from "@/lib/plan";
import type { AppCatalogItem } from "@/lib/types";

const apps: AppCatalogItem[] = [
  { id: "github", name: "GitHub", category: "dev", costPerSeat: 21, billing: "monthly" },
  { id: "slack", name: "Slack", category: "comms", costPerSeat: 8, billing: "monthly" },
  { id: "gsuite", name: "Google Workspace", category: "docs", costPerSeat: 12, billing: "monthly" },
  { id: "figma", name: "Figma", category: "design", costPerSeat: 15, billing: "monthly" },
];

const base = newPlan({
  candidateId: "cand_1",
  candidateName: "Nora Alvarez",
  roleName: "Software Engineer",
  startDate: "2026-03-02",
});

describe("defaultSeatsForRole", () => {
  it("picks sensible seats per role", () => {
    expect(defaultSeatsForRole("Software Engineer")).toEqual(["github", "slack"]);
    expect(defaultSeatsForRole("Product Designer")).toEqual(["figma", "slack"]);
    expect(defaultSeatsForRole("Operations")).toEqual(["notion"]);
    expect(defaultSeatsForRole(null)).toEqual(["notion"]);
  });
});

describe("seat adjustments", () => {
  it("removes a seat (the Slack case)", () => {
    const next = removeSeat(base, "slack");
    expect(next.seatAppIds).toEqual(["github"]);
    expect(base.seatAppIds).toEqual(["github", "slack"]); // immutable
  });

  it("adds a seat and ignores duplicates", () => {
    const next = addSeat(base, "figma");
    expect(next.seatAppIds).toContain("figma");
    expect(addSeat(next, "figma").seatAppIds.filter((x) => x === "figma")).toHaveLength(1);
  });
});

describe("task skipping", () => {
  it("marks and matches skipped tasks by keyword", () => {
    const next = skipTask(base, "badge");
    expect(isSkipped(next, "Issue access badge")).toBe(true);
    expect(isSkipped(next, "Order laptop")).toBe(false);
  });

  it("undoes a skip", () => {
    const skipped = skipTask(base, "laptop");
    const restored = includeTask(skipped, "laptop");
    expect(isSkipped(restored, "Order laptop")).toBe(false);
  });
});

describe("role + start date", () => {
  it("sets role and start date immutably", () => {
    expect(setRole(base, "Designer").roleName).toBe("Designer");
    expect(setStartDate(base, "2026-04-01").startDate).toBe("2026-04-01");
    expect(base.roleName).toBe("Software Engineer");
  });
});

describe("resolveAppId", () => {
  it("resolves by id, exact name, spaced name, and contains", () => {
    expect(resolveAppId("github", apps)).toBe("github");
    expect(resolveAppId("Slack", apps)).toBe("slack");
    expect(resolveAppId("google workspace", apps)).toBe("gsuite");
    expect(resolveAppId("git hub", apps)).toBe("github");
    expect(resolveAppId("nonsense", apps)).toBeNull();
  });
});
