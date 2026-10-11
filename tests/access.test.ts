import {
  DEFAULT_PERSONA,
  PERSONAS,
  canAccess,
  canCallApi,
  canOpenPath,
  homePathFor,
  parsePersona,
  viewForPath,
  viewsFor,
} from "@/lib/access";

describe("role-view access", () => {
  it("only finance sees the finance view", () => {
    for (const persona of PERSONAS) {
      expect(canAccess(persona, "finance")).toBe(persona === "finance");
    }
  });

  it("a new hire sees only their checklist", () => {
    expect(viewsFor("hire")).toEqual(["myonboarding"]);
  });

  it("team members see only their own queue", () => {
    expect(canAccess("it", "team:it")).toBe(true);
    expect(canAccess("it", "team:vendor")).toBe(false);
    expect(canAccess("vendor", "specialist")).toBe(false);
  });

  it("specialist runs the board and every team queue", () => {
    expect(canAccess("specialist", "specialist")).toBe(true);
    expect(canAccess("specialist", "team:it")).toBe(true);
    expect(canAccess("specialist", "team:vendor")).toBe(true);
    expect(canAccess("specialist", "team:facilities")).toBe(true);
  });

  it("falls back to the default persona for unknown cookie values", () => {
    expect(parsePersona(undefined)).toBe(DEFAULT_PERSONA);
    expect(parsePersona("root")).toBe(DEFAULT_PERSONA);
    expect(parsePersona("finance")).toBe("finance");
  });

  it("every persona has a home view it can access", () => {
    expect(homePathFor("finance")).toBe("/finance");
    expect(homePathFor("hire")).toBe("/myonboarding");
    expect(homePathFor("vendor")).toBe("/team/vendor");
  });
});

describe("path access", () => {
  it("maps page paths to role views", () => {
    expect(viewForPath("/finance/reclaim")).toBe("finance");
    expect(viewForPath("/team/it")).toBe("team:it");
    expect(viewForPath("/specialist/genie")).toBe("specialist");
    expect(viewForPath("/financeX")).toBeNull();
    expect(viewForPath("/api-docs")).toBeNull();
  });

  it("a new hire can open only their checklist", () => {
    expect(canOpenPath("hire", "/myonboarding")).toBe(true);
    for (const p of ["/finance", "/specialist", "/manager/hire_1", "/team/it", "/api-docs"]) {
      expect(canOpenPath("hire", p)).toBe(false);
    }
  });

  it("staff follow their role views and can open shared pages", () => {
    expect(canOpenPath("finance", "/finance/reclaim")).toBe(true);
    expect(canOpenPath("it", "/finance")).toBe(false);
    expect(canOpenPath("specialist", "/myonboarding")).toBe(true);
    expect(canOpenPath("vendor", "/api-docs")).toBe(true);
  });

  it("a new hire can call no API; staff can call all", () => {
    expect(canCallApi("hire")).toBe(false);
    for (const p of PERSONAS.filter((p) => p !== "hire")) expect(canCallApi(p)).toBe(true);
  });
});
