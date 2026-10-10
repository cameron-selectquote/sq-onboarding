/**
 * AI wrapper (BuildPlan §1, §4).
 *
 * A single seam over the event's hosted inference endpoint. Everything that
 * calls AI goes through an `AiClient`, so:
 *   - DevOps wires the real endpoint by implementing `AiClient` once, and
 *   - tests use `MockAiClient` with zero network.
 *
 * The two product calls are template matching (offer letter/title -> template +
 * stack + cost) and brief drafting (granted tools -> welcome blurbs).
 */

export interface TemplateMatch {
  /** Suggested template roleName, e.g. "Software Engineer". */
  roleName: string;
  /** Suggested app ids for the stack. */
  suggestedAppIds: string[];
  /** Rough monthly cost estimate for the suggested stack. */
  estimatedMonthlyCost: number;
  /** 0..1 confidence. */
  confidence: number;
}

export interface BriefBlurb {
  appId: string;
  heading: string;
  body: string;
}

export interface AiClient {
  matchTemplate(input: { title: string; offerText?: string }): Promise<TemplateMatch>;
  draftBrief(input: {
    hireName: string;
    appNames: string[];
  }): Promise<BriefBlurb[]>;
}

/**
 * Deterministic mock used in the first-pass build and all tests. Produces
 * plausible output without a network call so the frontend and demo work before
 * the real endpoint is wired.
 */
export class MockAiClient implements AiClient {
  async matchTemplate(input: {
    title: string;
    offerText?: string;
  }): Promise<TemplateMatch> {
    const title = input.title.toLowerCase();
    if (title.includes("engineer") || title.includes("developer")) {
      return {
        roleName: "Software Engineer",
        suggestedAppIds: ["github", "slack", "jira", "figma"],
        estimatedMonthlyCost: 95,
        confidence: 0.9,
      };
    }
    if (title.includes("design")) {
      return {
        roleName: "Designer",
        suggestedAppIds: ["figma", "slack", "notion"],
        estimatedMonthlyCost: 70,
        confidence: 0.85,
      };
    }
    return {
      roleName: "Team Member",
      suggestedAppIds: ["slack", "notion"],
      estimatedMonthlyCost: 40,
      confidence: 0.5,
    };
  }

  async draftBrief(input: {
    hireName: string;
    appNames: string[];
  }): Promise<BriefBlurb[]> {
    return input.appNames.map((name) => ({
      appId: name.toLowerCase().replace(/\s+/g, "-"),
      heading: `Welcome to ${name}`,
      body: `Hi ${input.hireName}, you now have access to ${name}. Check your inbox for the invite and reach out to your team if you need help getting set up.`,
    }));
  }
}
