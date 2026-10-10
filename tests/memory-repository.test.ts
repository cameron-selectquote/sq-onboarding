import { createMemoryRepository } from "@/lib/memory-repository";
import type { Company } from "@/lib/types";

describe("MemoryRepository collection", () => {
  const company: Company = { id: "c1", name: "Acme", size: 10, industry: "x" };

  it("inserts and reads back a record", async () => {
    const repo = createMemoryRepository();
    await repo.companies.insert(company);
    expect(await repo.companies.get("c1")).toEqual(company);
  });

  it("rejects duplicate ids", async () => {
    const repo = createMemoryRepository();
    await repo.companies.insert(company);
    await expect(repo.companies.insert(company)).rejects.toThrow(/already exists/);
  });

  it("returns null for a missing record", async () => {
    const repo = createMemoryRepository();
    expect(await repo.companies.get("nope")).toBeNull();
  });

  it("updates a record without changing its id", async () => {
    const repo = createMemoryRepository();
    await repo.companies.insert(company);
    const updated = await repo.companies.update("c1", {
      name: "Acme 2",
      id: "hacked", // id changes must be ignored by update()
    } as Partial<Company>);
    expect(updated.id).toBe("c1");
    expect(updated.name).toBe("Acme 2");
  });

  it("throws when updating a missing record", async () => {
    const repo = createMemoryRepository();
    await expect(repo.companies.update("nope", { name: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("filters with where()", async () => {
    const repo = createMemoryRepository();
    await repo.companies.insert(company);
    await repo.companies.insert({ ...company, id: "c2", size: 99 });
    const big = await repo.companies.where((c) => c.size > 50);
    expect(big.map((c) => c.id)).toEqual(["c2"]);
  });

  it("returns defensive copies (no mutation by reference)", async () => {
    const repo = createMemoryRepository();
    await repo.companies.insert(company);
    const got = await repo.companies.get("c1");
    got!.name = "mutated";
    const again = await repo.companies.get("c1");
    expect(again!.name).toBe("Acme");
  });
});
