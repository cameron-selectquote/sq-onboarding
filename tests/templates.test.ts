import { createMemoryRepository } from "@/lib/memory-repository";
import { TemplateService } from "@/lib/templates";
import { sequentialIdGenerator, fixedClock } from "@/lib/ids";
import type { Hire, Template, TemplateTask } from "@/lib/types";

async function setup() {
  const repo = createMemoryRepository();
  const templates = new TemplateService(repo, {
    idGenerator: sequentialIdGenerator("x"),
    clock: fixedClock("2026-02-01T00:00:00.000Z"),
  });

  const template: Template = { id: "tpl_swe", roleName: "Software Engineer" };
  await repo.templates.insert(template);

  const tasks: TemplateTask[] = [
    { id: "tt1", templateId: "tpl_swe", title: "Create email", ownerTeam: "it", cost: 0, costType: "none", appId: null },
    { id: "tt2", templateId: "tpl_swe", title: "Order laptop", ownerTeam: "vendor", cost: 2800, costType: "one_time", appId: null },
  ];
  for (const t of tasks) await repo.templateTasks.insert(t);

  const hire: Hire = { id: "h1", name: "Riley", email: "r@x.test", roleName: "Software Engineer", managerId: null, startDate: "2026-02-02", cohort: null };
  await repo.hires.insert(hire);

  await repo.appCatalog.insert({
    id: "github",
    name: "GitHub",
    category: "dev",
    costPerSeat: 21,
    billing: "monthly",
    seatsOwned: 50,
    seatsInUseBaseline: 10,
  });

  return { repo, templates };
}

describe("TemplateService.instantiateForHire", () => {
  it("creates a task per template task, all status todo", async () => {
    const { repo, templates } = await setup();
    const result = await templates.instantiateForHire("h1", "tpl_swe");

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.every((t) => t.status === "todo")).toBe(true);
    expect(result.tasks.every((t) => t.hireId === "h1")).toBe(true);

    const stored = await repo.tasks.where((t) => t.hireId === "h1");
    expect(stored).toHaveLength(2);
  });

  it("grants an active license per supplied appId", async () => {
    const { templates } = await setup();
    const result = await templates.instantiateForHire("h1", "tpl_swe", ["github", "slack"]);
    expect(result.licenses).toHaveLength(2);
    expect(result.licenses.every((l) => l.status === "active")).toBe(true);
    expect(result.licenses[0]!.grantedAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("throws for an unknown hire or template", async () => {
    const { templates } = await setup();
    await expect(templates.instantiateForHire("nope", "tpl_swe")).rejects.toThrow(/Hire/);
    await expect(templates.instantiateForHire("h1", "nope")).rejects.toThrow(/Template/);
  });
});

describe("TemplateService read models + CRUD", () => {
  it("lists templates with their tasks attached, sorted by role", async () => {
    const { templates } = await setup();
    await templates.createTemplate("Designer");

    const all = await templates.listWithTasks();
    expect(all.map((t) => t.roleName)).toEqual(["Designer", "Software Engineer"]);
    const swe = all.find((t) => t.roleName === "Software Engineer")!;
    expect(swe.tasks).toHaveLength(2);
  });

  it("creates a template and rejects duplicate role names", async () => {
    const { templates } = await setup();
    const created = await templates.createTemplate("Data Analyst");
    expect(created.roleName).toBe("Data Analyst");

    await expect(templates.createTemplate("  data analyst ")).rejects.toThrow(/already exists/);
    await expect(templates.createTemplate("   ")).rejects.toThrow(/required/);
  });

  it("adds a task and forces cost to 0 for a 'none' cost type", async () => {
    const { templates } = await setup();
    const task = await templates.addTask("tpl_swe", {
      title: "Issue badge",
      ownerTeam: "facilities",
      cost: 25,
      costType: "none",
    });
    expect(task.cost).toBe(0);
    expect(task.appId).toBeNull();
  });

  it("validates the app id when a task grants a seat", async () => {
    const { templates } = await setup();
    const task = await templates.addTask("tpl_swe", {
      title: "Grant GitHub seat",
      ownerTeam: "it",
      cost: 21,
      costType: "recurring",
      appId: "github",
    });
    expect(task.appId).toBe("github");

    await expect(
      templates.addTask("tpl_swe", { title: "Bad", ownerTeam: "it", appId: "nope" }),
    ).rejects.toThrow(/Unknown app/);
  });

  it("updates and removes a template task", async () => {
    const { repo, templates } = await setup();
    const updated = await templates.updateTask("tt2", { title: "Order MacBook", cost: 3000 });
    expect(updated.title).toBe("Order MacBook");
    expect(updated.cost).toBe(3000);

    await templates.removeTask("tt1");
    const left = await repo.templateTasks.where((t) => t.templateId === "tpl_swe");
    expect(left.map((t) => t.id)).toEqual(["tt2"]);
  });

  it("throws adding a task to an unknown template", async () => {
    const { templates } = await setup();
    await expect(
      templates.addTask("nope", { title: "x", ownerTeam: "it" }),
    ).rejects.toThrow(/Template/);
  });
});
