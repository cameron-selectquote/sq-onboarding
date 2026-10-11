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

/**
 * Everything the brief drafter can draw on. Only `hireName` + `appNames` are
 * required (older callers pass just those); the rest let the brief say what's
 * already been set up and what to expect. All optional so the real endpoint
 * and existing tests stay compatible.
 */
export interface DraftBriefInput {
  hireName: string;
  /** Granted software seats, by display name. */
  appNames: string[];
  /** Role/title, used to frame the intro. */
  roleName?: string;
  /** ISO start date, if known, for the timeline. */
  startDate?: string;
  /** Hardware already provisioned, by display name (e.g. "MacBook Pro 16\""). */
  hardwareNames?: string[];
  /** Account/admin items already done (e.g. "Email + SSO account"). */
  completedSetup?: string[];
  /** Items still pending a person (e.g. "Order laptop (out of stock)"). */
  pending?: string[];
}

export interface AiClient {
  matchTemplate(input: {
    title: string;
    offerText?: string;
  }): Promise<TemplateMatch>;
  draftBrief(input: DraftBriefInput): Promise<BriefBlurb[]>;
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
    if (title.includes('engineer') || title.includes('developer')) {
      return {
        roleName: 'Software Engineer',
        suggestedAppIds: ['github', 'slack', 'jira', 'figma'],
        estimatedMonthlyCost: 95,
        confidence: 0.9,
      };
    }
    if (title.includes('design')) {
      return {
        roleName: 'Designer',
        suggestedAppIds: ['figma', 'slack', 'notion'],
        estimatedMonthlyCost: 70,
        confidence: 0.85,
      };
    }
    return {
      roleName: 'Team Member',
      suggestedAppIds: ['slack', 'notion'],
      estimatedMonthlyCost: 40,
      confidence: 0.5,
    };
  }

  async draftBrief(input: DraftBriefInput): Promise<BriefBlurb[]> {
    const first = input.hireName.split(/\s+/)[0] ?? input.hireName;
    const roleBit = input.roleName ? ` as a ${input.roleName}` : '';
    const blurbs: BriefBlurb[] = [];

    // One welcome — not one per tool.
    blurbs.push({
      appId: 'intro',
      heading: `Welcome, ${first}`,
      body:
        `We're glad to have you joining the team${roleBit}. ` +
        `Here's a quick rundown of what's set up for you and what to expect in your first few weeks. ` +
        `If anything below isn't working, reach out to your onboarding specialist and we'll sort it out.`,
    });

    // What's already set up — accounts, tools, hardware — in one place.
    const setupLines: string[] = [];
    if (input.completedSetup && input.completedSetup.length > 0) {
      setupLines.push(`Accounts: ${input.completedSetup.join(', ')}.`);
    }
    if (input.appNames.length > 0) {
      setupLines.push(
        `Software access: ${input.appNames.join(', ')}. Watch your inbox for each invite.`,
      );
    }
    if (input.hardwareNames && input.hardwareNames.length > 0) {
      setupLines.push(
        `Hardware on the way: ${input.hardwareNames.join(', ')}.`,
      );
    }
    if (setupLines.length > 0) {
      blurbs.push({
        appId: 'ready',
        heading: "What's ready for you",
        body: setupLines.join(' '),
      });
    }

    // Anything still outstanding, called out honestly.
    if (input.pending && input.pending.length > 0) {
      blurbs.push({
        appId: 'pending',
        heading: 'Still in progress',
        body:
          `A couple of items are still being arranged: ${input.pending.join(', ')}. ` +
          `Your specialist is on it and will follow up — no action needed from you yet.`,
      });
    }

    // Timeline + expectations.
    const start = input.startDate ? formatDay(input.startDate) : null;
    blurbs.push({
      appId: 'timeline',
      heading: 'Your first 30 days',
      body:
        (start ? `You start on ${start}. ` : '') +
        `Day 1: meet your manager and get oriented. ` +
        `Week 1: meet the team and finish any role-specific training. ` +
        `Weeks 2-4: set your 30/60/90 goals with your manager, with a check-in at the end of month one. ` +
        `Expect a welcome 1-on-1 to be scheduled by your manager.`,
    });

    return blurbs;
  }
}

/** "Monday, March 2" from an ISO date, for the brief timeline. */
function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
