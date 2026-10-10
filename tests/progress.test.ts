import { hireProgress, teamCell, toHireChecklist } from "@/lib/progress";
import type { Hire, Task, TaskStatus, Team } from "@/lib/types";

const hire: Hire = {
  id: "h1",
  name: "Riley Chen",
  email: "riley@acme.test",
  roleName: "Software Engineer",
  managerId: "u_mgr",
  startDate: "2026-02-02",
  cohort: null,
};

let n = 0;
function task(status: TaskStatus, ownerTeam: Team = "it", cost = 0): Task {
  n += 1;
  return { id: `t${n}`, hireId: "h1", title: `Task ${n}`, ownerTeam, status, cost, costType: cost ? "one_time" : "none" };
}

describe("hireProgress", () => {
  it("counts done / total and rounds the percent", () => {
    const p = hireProgress([task("done"), task("done"), task("todo")]);
    expect(p).toMatchObject({ done: 2, total: 3, pct: 67, blocked: false });
    expect(p.next?.status).toBe("todo");
  });

  it("surfaces a blocked task as next", () => {
    const blocked = task("blocked");
    const p = hireProgress([task("todo"), blocked]);
    expect(p.blocked).toBe(true);
    expect(p.next).toBe(blocked);
  });

  it("is 0% with no next task when there are no tasks", () => {
    expect(hireProgress([])).toMatchObject({ pct: 0, next: null, total: 0 });
  });
});

describe("teamCell", () => {
  it("rolls a team's tasks into one status", () => {
    expect(teamCell([task("done", "hr")], "it")).toEqual({ kind: "none" });
    expect(teamCell([task("done"), task("done")], "it")).toEqual({ kind: "done" });
    expect(teamCell([task("done"), task("blocked")], "it")).toEqual({ kind: "blocked" });
    expect(teamCell([task("todo"), task("todo")], "it")).toEqual({ kind: "not_started" });
    expect(teamCell([task("done"), task("todo")], "it")).toEqual({ kind: "progress", done: 1, total: 2 });
  });
});

describe("toHireChecklist (AC #4: no costs for new hires)", () => {
  it("carries no cost fields or dollar amounts", () => {
    const list = toHireChecklist(hire, [task("done", "vendor", 2800), task("todo", "it", 21)]);
    const json = JSON.stringify(list);
    expect(json).not.toMatch(/cost/i);
    expect(json).not.toContain("2800");
    expect(json).not.toContain("email");
    expect(list).toMatchObject({ done: 1, total: 2 });
  });

  it("only includes the hire's own tasks", () => {
    const other = { ...task("todo"), hireId: "someone_else" };
    expect(toHireChecklist(hire, [task("todo"), other]).items).toHaveLength(1);
  });
});
