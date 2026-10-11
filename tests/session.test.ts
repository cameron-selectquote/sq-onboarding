import { SESSION_TTL_SECONDS, passwordMatches, signSession, verifySession, type Session } from "@/lib/session";

const SECRET = "test-secret";
const NOW = 1_800_000_000;
const staff: Session = { username: "admin", name: "Avery Admin", role: "admin", viewAs: "admin", hireId: null, exp: NOW + SESSION_TTL_SECONDS };
const hire: Session = { username: "employee", name: "Riley Chen", role: "employee", viewAs: "employee", hireId: "hire_1", exp: NOW + 60 };
const adminAsEmployee: Session = { ...staff, viewAs: "employee", hireId: "hire_2" };

describe("session tokens", () => {
  it("round-trips admin, employee, and admin-viewing-as-employee sessions", async () => {
    for (const s of [staff, hire, adminAsEmployee]) {
      expect(await verifySession(await signSession(s, SECRET), SECRET, NOW)).toEqual(s);
    }
  });

  it("rejects a token signed with another secret", async () => {
    expect(await verifySession(await signSession(staff, "other"), SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload (e.g. employee promoting itself to admin)", async () => {
    const token = await signSession(hire, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...staff })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const token = await signSession(hire, SECRET);
    expect(await verifySession(token, SECRET, hire.exp)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    for (const bad of [undefined, null, "", "abc", "a.b.c", "!!.??", "e30.e30"]) {
      expect(await verifySession(bad, SECRET, NOW)).toBeNull();
    }
  });

  it("rejects signed payloads with an invalid shape", async () => {
    const bad = [
      { ...staff, role: "root", viewAs: "root" },
      { ...staff, viewAs: "finance" },
      { ...hire, hireId: null },
      { ...hire, hireId: "" },
      { ...staff, hireId: "hire_1" },
      // Only an admin may view as another role.
      { ...hire, viewAs: "admin", hireId: null },
      { username: "manager", name: "Morgan", role: "manager", viewAs: "employee", hireId: "hire_1", exp: NOW + 60 },
      { ...staff, username: 7 },
    ];
    for (const s of bad) {
      expect(await verifySession(await signSession(s as unknown as Session, SECRET), SECRET, NOW)).toBeNull();
    }
  });
});

describe("passwordMatches", () => {
  it("matches only the exact password", async () => {
    expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(await passwordMatches("hunter3", "hunter2")).toBe(false);
    expect(await passwordMatches("", "hunter2")).toBe(false);
  });
});
