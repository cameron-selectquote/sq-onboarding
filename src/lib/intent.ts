/**
 * Pure intent parsing for the Genie's deterministic path.
 *
 * Kept here (not in server/genie.ts) so it's unit-testable without pulling in
 * the Strands SDK or the server store. No DB, no clock, no network — just
 * string classification over the user's message.
 */

export type Confirmation = 'affirmative' | 'negative' | 'unclear';

/**
 * Classify a reply to a destructive-offboard confirmation prompt as a clear
 * yes, a clear no, or unclear. Deliberately conservative, because a wrong
 * "affirmative" revokes seats and returns hardware:
 *   - a negation anywhere wins (so "no, don't" and "yes but no" both cancel),
 *   - an affirmative must stand on its own (just "yes"/"go ahead"/"confirm" or
 *     an explicit "offboard them"), not be buried in a longer instruction like
 *     "yes but first add Jira" — those come back as `unclear` and we re-ask.
 */
export function classifyConfirmation(text: string): Confirmation {
  const lower = text.trim().toLowerCase();

  const negative =
    /\b(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|abort|hold on|wait)\b/.test(
      lower,
    );
  if (negative) return 'negative';

  // Standalone affirmation: the whole message is essentially a yes.
  const standaloneAffirmative =
    /^(y|yes|yep|yeah|yup|sure|ok|okay|confirm(?:ed)?|do it|go ahead|proceed|offboard (?:them|her|him)|yes[,. ]+(?:offboard|do it|please|go ahead))\b[.! ]*$/.test(
      lower,
    );
  if (standaloneAffirmative) return 'affirmative';

  // An explicit offboard/confirm verb in a short message with nothing
  // contradicting it also counts (e.g. "go ahead and offboard them"), but a
  // long message with extra asks stays unclear so we don't act on a half-answer.
  if (
    lower.split(/\s+/).length <= 6 &&
    /\b(confirm|proceed|offboard (?:them|her|him))\b/.test(lower)
  ) {
    return 'affirmative';
  }

  return 'unclear';
}

/**
 * Detect a read-only "pull up / view status" request and extract the name.
 * Returns null when the message isn't a lookup (so onboarding handling runs).
 *
 * This is for "pull up Nora", "show me Sam's status", "what does Quinn have" —
 * the user wants to SEE a person, not start onboarding them. Deliberately does
 * NOT match "onboard"/"offboard" verbs, so those keep their own flows.
 */
export function parseViewIntent(text: string): string | null {
  const lower = text.toLowerCase();

  // Never treat an onboard/offboard request as a lookup.
  if (/\b(onboard|offboard|off-board|deprovision|de-provision)\b/.test(lower)) {
    return null;
  }

  // "pull up [the user] Nora", "show me Sam", "look up Quinn Baker",
  // "view Jordan", "open Dana's profile", "find Alex".
  const verbMatch = text.match(
    /\b(?:pull up|bring up|look ?up|show(?: me)?|view|open|find|get)\s+(?:the\s+)?(?:user\s+|hire\s+|candidate\s+|profile\s+(?:of|for)\s+|record\s+(?:of|for)\s+)?(.+)/i,
  );
  if (verbMatch) {
    return stripNameTail(verbMatch[1]!);
  }

  // "what does Nora have", "what's on Sam's plan", "status of Quinn",
  // "where is Jordan at", "how is Dana doing".
  const statusMatch = text.match(
    /\b(?:status of|where is|how is|how'?s|what(?:'?s| does| is)(?: on)?)\s+(.+)/i,
  );
  if (statusMatch) {
    return stripNameTail(statusMatch[1]!);
  }

  return null;
}

/**
 * Trim trailing possessives and status words off an extracted name so
 * "Sam's status", "Quinn's plan", "Nora doing" all reduce to the bare name.
 */
function stripNameTail(raw: string): string | null {
  const name = raw
    .replace(/[.?!,]+$/, '')
    .replace(
      /['’]s?\s+(status|progress|onboarding|plan|profile|record|setup|stuff|tools|seats|hardware|software).*$/i,
      '',
    )
    .replace(
      /\s+(status|progress|onboarding|plan|profile|record|setup|doing|at|have|has|got|up).*$/i,
      '',
    )
    .replace(/['’]s$/i, '')
    .trim();
  // A bare pronoun, a pronoun-led phrase ("it cost", "them stuff"), or an
  // empty string isn't a usable name.
  if (!name || /^(me|them|him|her|it|us|they|that|this)\b/i.test(name)) {
    return null;
  }
  return name;
}

/**
 * Detect a "show me the candidates" request — a read-only ask to list who's
 * available to onboard. Matches "show candidates", "list the candidates",
 * "who can I onboard", "who's in the pipeline", "candidate list". Returns true
 * when the message is such a request.
 *
 * Deliberately requires the word "candidate(s)" OR a clear list-the-pipeline
 * phrasing, so a specific "onboard Nora" or "pull up Sam" isn't swallowed.
 */
export function parseListCandidatesIntent(text: string): boolean {
  const lower = text.trim().toLowerCase();

  // "who can I onboard", "who's available to onboard", "who's in the pipeline".
  // Checked first because it legitimately contains "onboard".
  if (
    /\bwho(?:'?s| is| can| could| do i)\b.*\b(onboard|pipeline|available|hire|hiring|candidate)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  // A single-name lookup/onboard ("onboard Nora", "pull up Sam") is not a list
  // request. Guarded after the "who can I onboard" case above.
  if (/\b(onboard|offboard|off-board|pull up|bring up)\b/.test(lower)) {
    return false;
  }

  if (
    /\bcandidates?\b/.test(lower) &&
    /\b(show|list|see|view|display|who|what|all|current|available|pipeline|surface|give|pull)\b/.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Detect a request to REMOVE / revoke / reclaim a specific software seat from a
 * named person. Returns the hire name + the app/seat reference, or null when
 * the message isn't a seat-removal request.
 *
 * Examples: "revoke Nora's Figma seat", "remove Slack from Sam",
 * "reclaim Taylor's idle GitHub license", "take away Jordan's Jira seat".
 */
export interface RemoveSeatIntent {
  hint: string;
  appRef: string;
}

export function parseRemoveSeatIntent(text: string): RemoveSeatIntent | null {
  const lower = text.toLowerCase();

  // Must be a removal verb aimed at a seat/license, not offboarding a person.
  if (/\b(offboard|off-board|deprovision)\b/.test(lower)) return null;
  const removal =
    /\b(revoke|reclaim|remove|take away|take back|cancel|drop|pull)\b/.test(
      lower,
    );
  const seatish = /\b(seat|licen[cs]e|access|subscription|app)\b/.test(lower);
  if (!removal) return null;

  // "remove Slack from Sam" / "revoke Figma from Nora Alvarez"
  const fromMatch = text.match(
    /\b(?:revoke|reclaim|remove|take away|take back|cancel|drop|pull)\s+(?:the\s+)?(.+?)\s+(?:seat|licen[cs]e|access|subscription)?\s*from\s+(.+)/i,
  );
  if (fromMatch) {
    return {
      appRef: cleanRef(fromMatch[1]!),
      hint: cleanRef(fromMatch[2]!),
    };
  }

  // "revoke Nora's Figma seat" / "reclaim Taylor's idle GitHub license"
  const possessiveMatch = text.match(
    /\b(?:revoke|reclaim|remove|take away|take back|cancel|drop|pull)\s+(.+?)['’]s\s+(.+)/i,
  );
  if (possessiveMatch) {
    const appRef = possessiveMatch[2]!
      .replace(/\b(idle|duplicate|unused|stale|the)\b/gi, '')
      .replace(/\b(seat|licen[cs]e|access|subscription)\b/gi, '')
      .trim();
    return {
      hint: cleanRef(possessiveMatch[1]!),
      appRef: cleanRef(appRef),
    };
  }

  // Needs the seat word to avoid false positives if we got this far.
  if (!seatish) return null;
  return null;
}

/** Strip trailing punctuation + filler words off an extracted fragment. */
function cleanRef(raw: string): string {
  return raw
    .replace(/[.?!,]+$/, '')
    .replace(/^\s*(the|a|an)\s+/i, '')
    .trim();
}

/**
 * Detect a request to VIEW/LIST the onboarding templates. Returns true for
 * "show me the templates", "list templates", "what templates do we have",
 * "see the role templates". Returns false otherwise.
 *
 * Checked before the create-template intent, and deliberately does NOT match a
 * create verb, so "create a template" still starts the builder.
 */
export function parseListTemplatesIntent(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!/\btemplates?\b/.test(lower)) return false;
  // A create/build request is not a list request.
  if (
    /\b(create|build|make|add|new|set ?up|start|design|define)\b/.test(lower)
  ) {
    return false;
  }
  return /\b(show|list|see|view|display|what|which|all|current|available|browse|templates)\b/.test(
    lower,
  );
}

/**
 * Detect a request to CREATE a new onboarding template. Returns true for
 * "create a template", "build a new template", "add a role template",
 * "make a new onboarding template", "set up a template". Returns false
 * otherwise so normal handling runs.
 */
export function parseCreateTemplateIntent(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (!/\btemplate\b/.test(lower)) return false;
  return /\b(create|build|make|add|new|set ?up|start|design|define)\b/.test(
    lower,
  );
}

/**
 * Detect an offboarding request and extract the hire name. Returns null when
 * the message isn't an offboard intent at all.
 */
export function parseOffboardIntent(text: string): string | null {
  const lower = text.toLowerCase();
  if (
    !/\b(offboard|off-board|deprovision|de-provision|terminate|is leaving|leaving the company|last day)\b/.test(
      lower,
    )
  ) {
    return null;
  }
  // "offboard Quinn Baker" / "deprovision Quinn" — take the name after the verb.
  const m = text.match(
    /\b(?:offboard|off-board|deprovision|de-provision|terminate)\s+(.+)/i,
  );
  if (m) return m[1]!.replace(/[.?!]+$/, '').trim();
  // "Quinn Baker is leaving" — take the name before the phrase.
  const m2 = text.match(
    /^(.+?)\s+(?:is leaving|leaving the company|last day)/i,
  );
  if (m2) return m2[1]!.trim();
  return null;
}
