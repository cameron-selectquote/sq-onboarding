import {
  DEFAULT_PERSONA,
  PERSONAS,
  canAccess,
  homePathFor,
  parsePersona,
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
