import { classifyConfirmation, parseOffboardIntent } from "@/lib/intent";

describe("classifyConfirmation", () => {
  it("treats a standalone yes as affirmative", () => {
    for (const t of ["yes", "Yes", "yep", "yeah", "sure", "ok", "do it", "go ahead", "proceed", "confirm", "yes, offboard"]) {
      expect(classifyConfirmation(t)).toBe("affirmative");
    }
  });

  it("treats a clear no as negative", () => {
    for (const t of ["no", "nope", "cancel", "stop", "don't", "never mind", "abort", "hold on"]) {
      expect(classifyConfirmation(t)).toBe("negative");
    }
  });

  it("lets a negation win even when a yes is present", () => {
    expect(classifyConfirmation("yes but no wait")).toBe("negative");
    expect(classifyConfirmation("yeah, actually don't")).toBe("negative");
  });

  it("does NOT fire on a yes buried in a longer instruction (stays unclear)", () => {
    // This must not execute a destructive offboard.
    expect(classifyConfirmation("yes but first add Jira and bump the start date")).toBe("unclear");
    expect(classifyConfirmation("sure, once you also grant Figma to the whole team")).toBe("unclear");
  });

  it("accepts a short explicit confirm/offboard phrase", () => {
    expect(classifyConfirmation("go ahead and offboard them")).toBe("affirmative");
  });

  it("is unclear for unrelated chatter", () => {
    expect(classifyConfirmation("what will this cost?")).toBe("unclear");
    expect(classifyConfirmation("who is their manager")).toBe("unclear");
  });
});

describe("parseOffboardIntent", () => {
  it("extracts the name after an offboard verb", () => {
    expect(parseOffboardIntent("offboard Quinn Baker")).toBe("Quinn Baker");
    expect(parseOffboardIntent("deprovision Quinn")).toBe("Quinn");
    expect(parseOffboardIntent("please terminate Sam Rivera.")).toBe("Sam Rivera");
  });

  it("extracts the name before a leaving phrase", () => {
    expect(parseOffboardIntent("Quinn Baker is leaving")).toBe("Quinn Baker");
    expect(parseOffboardIntent("Nora Alvarez last day is Friday")).toBe("Nora Alvarez");
  });

  it("returns null when there's no offboard intent", () => {
    expect(parseOffboardIntent("onboard Nora Alvarez")).toBeNull();
    expect(parseOffboardIntent("what can you do?")).toBeNull();
    expect(parseOffboardIntent("grant Slack to Sam")).toBeNull();
  });
});
