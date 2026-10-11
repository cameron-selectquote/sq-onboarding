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
  const m2 = text.match(/^(.+?)\s+(?:is leaving|leaving the company|last day)/i);
  if (m2) return m2[1]!.trim();
  return null;
}
