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
