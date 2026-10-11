import { SESSION_TTL_SECONDS, passwordMatches, signSession, verifySession, type Session } from "@/lib/session";

const SECRET = "test-secret";
const NOW = 1_800_000_000;
const staff: Session = { persona: "finance", hireId: null, exp: NOW + SESSION_TTL_SECONDS };
const hire: Session = { persona: "hire", hireId: "hire_1", exp: NOW + 60 };

describe("session tokens", () => {
  it("round-trips a staff and a hire session", async () => {
    expect(await verifySession(await signSession(staff, SECRET), SECRET, NOW)).toEqual(staff);
    expect(await verifySession(await signSession(hire, SECRET), SECRET, NOW)).toEqual(hire);
  });

  it("rejects a token signed with another secret", async () => {
    expect(await verifySession(await signSession(staff, "other"), SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered payload (e.g. hire promoting itself to finance)", async () => {
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
      { persona: "root", hireId: null, exp: NOW + 60 },
      { persona: "hire", hireId: null, exp: NOW + 60 },
      { persona: "finance", hireId: "hire_1", exp: NOW + 60 },
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
