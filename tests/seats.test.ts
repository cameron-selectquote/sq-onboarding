import { assignedSeats, seatPools } from "@/lib/seats";
import type { AppCatalogItem, License } from "@/lib/types";

function app(
  id: string,
  name: string,
  seatsOwned: number,
  seatsInUseBaseline = 0,
  costPerSeat = 10,
): AppCatalogItem {
  return { id, name, category: "c", costPerSeat, billing: "monthly", seatsOwned, seatsInUseBaseline };
}

const apps: AppCatalogItem[] = [
  app("aws", "Amazon WorkSpaces", 1000, 0, 35),
  app("slack", "Slack", 50, 0, 8),
];

function license(id: string, appId: string, status: License["status"]): License {
  return { id, hireId: `h_${id}`, appId, status, grantedAt: null, lastUsedAt: null };
}

describe("assignedSeats", () => {
  it("counts active, idle, and reclaim licenses as consuming a seat", () => {
    const licenses: License[] = [
      license("1", "aws", "active"),
      license("2", "aws", "idle"),
      license("3", "aws", "reclaim"),
    ];
    expect(assignedSeats(app("aws", "AWS", 1000), licenses)).toBe(3);
  });

  it("does not count revoked licenses", () => {
    const licenses: License[] = [
      license("1", "aws", "active"),
      license("2", "aws", "revoked"),
    ];
    expect(assignedSeats(app("aws", "AWS", 1000), licenses)).toBe(1);
  });

  it("only counts licenses for the given app", () => {
    const licenses: License[] = [
      license("1", "aws", "active"),
      license("2", "slack", "active"),
    ];
    expect(assignedSeats(app("aws", "AWS", 1000), licenses)).toBe(1);
  });

  it("adds the pre-existing company baseline to the live license count", () => {
    const licenses: License[] = [license("1", "figma", "active")];
    // baseline 79 + 1 active license = 80
    expect(assignedSeats(app("figma", "Figma", 80, 79), licenses)).toBe(80);
  });
});

describe("seatPools", () => {
  it("reports owned, assigned, and available per app", () => {
    const licenses: License[] = [
      license("1", "aws", "active"),
      license("2", "aws", "idle"),
      license("3", "slack", "active"),
    ];
    const pools = seatPools(apps, licenses);

    const aws = pools.find((p) => p.appId === "aws");
    expect(aws).toEqual({ appId: "aws", name: "Amazon WorkSpaces", owned: 1000, assigned: 2, available: 998, monthlyCost: 35 });

    const slack = pools.find((p) => p.appId === "slack");
    expect(slack).toEqual({ appId: "slack", name: "Slack", owned: 50, assigned: 1, available: 49, monthlyCost: 8 });
  });

  it("shows a fully-allocated pool when baseline + licenses equals owned", () => {
    const figma = [app("figma", "Figma", 80, 79, 15)];
    const licenses: License[] = [license("1", "figma", "active")];
    const [pool] = seatPools(figma, licenses);
    expect(pool).toEqual({ appId: "figma", name: "Figma", owned: 80, assigned: 80, available: 0, monthlyCost: 15 });
  });

  it("clamps available at zero when assigned exceeds owned (oversubscribed)", () => {
    const over = [app("x", "X", 1, 0, 1)];
    const licenses: License[] = [
      license("1", "x", "active"),
      license("2", "x", "active"),
      license("3", "x", "active"),
    ];
    const [pool] = seatPools(over, licenses);
    expect(pool).toEqual({ appId: "x", name: "X", owned: 1, assigned: 3, available: 0, monthlyCost: 1 });
  });
});
