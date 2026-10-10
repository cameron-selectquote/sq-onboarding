import { taskProgress, toChecklist } from "@/lib/checklist";
import type { Hire, Task } from "@/lib/types";

const hire: Hire = {
  id: "hire_1",
  name: "Riley Chen",
  email: "riley@acme.test",
  roleName: "Software Engineer",
  managerId: "u_mgr",
  startDate: "2026-02-02",
  cohort: "2026-Feb",
};

const tasks: Task[] = [
  { id: "t1", hireId: "hire_1", title: "Order laptop", ownerTeam: "vendor", status: "done", cost: 2800, costType: "one_time" },
  { id: "t2", hireId: "hire_1", title: "Grant GitHub seat", ownerTeam: "it", status: "todo", cost: 21, costType: "recurring" },
  { id: "t3", hireId: "hire_2", title: "Someone else's task", ownerTeam: "it", status: "todo", cost: 8, costType: "recurring" },
];

describe("toChecklist", () => {
  const checklist = toChecklist(hire, tasks);

  it("includes only the hire's own tasks", () => {
    expect(checklist.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("never carries cost, budget, or dollar data (AC #4)", () => {
    const json = JSON.stringify(checklist);
    expect(json).not.toMatch(/cost|budget|spend|amount|ledger/i);
    expect(json).not.toContain("$");
    expect(json).not.toContain("2800");
    for (const task of checklist.tasks) {
      expect(Object.keys(task).sort()).toEqual(["id", "ownerTeam", "status", "title"]);
    }
  });

  it("drops contact details from the hire", () => {
    expect(Object.keys(checklist.hire).sort()).toEqual(["id", "name", "roleName", "startDate"]);
  });

  it("reports progress", () => {
    expect(checklist.progress).toEqual({ done: 1, total: 2, percent: 50 });
  });
});

describe("taskProgress", () => {
  it("is zero for no tasks", () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("rounds the percentage", () => {
    expect(taskProgress([{ status: "done" }, { status: "todo" }, { status: "review" }]).percent).toBe(33);
  });
});
