import { createMemoryRepository } from "@/lib/memory-repository";
import { NotificationService } from "@/lib/notifications";
import { sequentialIdGenerator } from "@/lib/ids";
import type { Repository } from "@/lib/repository";

function service(repo: Repository): NotificationService {
  return new NotificationService(repo, {
    idGenerator: sequentialIdGenerator("ntf"),
  });
}

describe("NotificationService", () => {
  it("posts a notification as unread and lists it for the team", async () => {
    const repo = createMemoryRepository();
    const svc = service(repo);

    const n = await svc.notify({ targetTeam: "it", message: "Grant GitHub seat" });
    expect(n.read).toBe(false);
    expect(n.targetTeam).toBe("it");

    const inbox = await svc.forTeam("it");
    expect(inbox).toHaveLength(1);
    expect(await svc.unreadCount("it")).toBe(1);
    // A different team sees nothing.
    expect(await svc.forTeam("vendor")).toHaveLength(0);
  });

  it("batches notifyMany under one batch id", async () => {
    const repo = createMemoryRepository();
    const svc = service(repo);

    const created = await svc.notifyMany(
      [
        { targetTeam: "it", message: "a" },
        { targetTeam: "vendor", message: "b" },
      ],
      "batch_1",
    );
    expect(created.map((n) => n.batchId)).toEqual(["batch_1", "batch_1"]);
  });

  it("sorts unread before read", async () => {
    const repo = createMemoryRepository();
    const svc = service(repo);

    const first = await svc.notify({ targetTeam: "hr", message: "first" });
    await svc.notify({ targetTeam: "hr", message: "second" });
    await svc.markRead(first.id);

    const inbox = await svc.forTeam("hr");
    expect(inbox[0]?.message).toBe("second"); // unread first
    expect(inbox[1]?.message).toBe("first"); // read last
  });

  it("markTeamRead clears every unread for a team and returns the count", async () => {
    const repo = createMemoryRepository();
    const svc = service(repo);

    await svc.notify({ targetTeam: "finance", message: "x" });
    await svc.notify({ targetTeam: "finance", message: "y" });
    await svc.notify({ targetTeam: "it", message: "z" });

    const changed = await svc.markTeamRead("finance");
    expect(changed).toBe(2);
    expect(await svc.unreadCount("finance")).toBe(0);
    expect(await svc.unreadCount("it")).toBe(1); // untouched
  });

  it("throws when marking an unknown notification read", async () => {
    const repo = createMemoryRepository();
    await expect(service(repo).markRead("nope")).rejects.toThrow(/not found/i);
  });
});
