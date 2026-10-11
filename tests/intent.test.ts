import {
  classifyConfirmation,
  parseCreateTemplateIntent,
  parseListCandidatesIntent,
  parseOffboardIntent,
  parseRemoveSeatIntent,
  parseViewIntent,
} from '@/lib/intent';

describe('classifyConfirmation', () => {
  it('treats a standalone yes as affirmative', () => {
    for (const t of [
      'yes',
      'Yes',
      'yep',
      'yeah',
      'sure',
      'ok',
      'do it',
      'go ahead',
      'proceed',
      'confirm',
      'yes, offboard',
    ]) {
      expect(classifyConfirmation(t)).toBe('affirmative');
    }
  });

  it('treats a clear no as negative', () => {
    for (const t of [
      'no',
      'nope',
      'cancel',
      'stop',
      "don't",
      'never mind',
      'abort',
      'hold on',
    ]) {
      expect(classifyConfirmation(t)).toBe('negative');
    }
  });

  it('lets a negation win even when a yes is present', () => {
    expect(classifyConfirmation('yes but no wait')).toBe('negative');
    expect(classifyConfirmation("yeah, actually don't")).toBe('negative');
  });

  it('does NOT fire on a yes buried in a longer instruction (stays unclear)', () => {
    // This must not execute a destructive offboard.
    expect(
      classifyConfirmation('yes but first add Jira and bump the start date'),
    ).toBe('unclear');
    expect(
      classifyConfirmation('sure, once you also grant Figma to the whole team'),
    ).toBe('unclear');
  });

  it('accepts a short explicit confirm/offboard phrase', () => {
    expect(classifyConfirmation('go ahead and offboard them')).toBe(
      'affirmative',
    );
  });

  it('is unclear for unrelated chatter', () => {
    expect(classifyConfirmation('what will this cost?')).toBe('unclear');
    expect(classifyConfirmation('who is their manager')).toBe('unclear');
  });
});

describe('parseOffboardIntent', () => {
  it('extracts the name after an offboard verb', () => {
    expect(parseOffboardIntent('offboard Quinn Baker')).toBe('Quinn Baker');
    expect(parseOffboardIntent('deprovision Quinn')).toBe('Quinn');
    expect(parseOffboardIntent('please terminate Sam Rivera.')).toBe(
      'Sam Rivera',
    );
  });

  it('extracts the name before a leaving phrase', () => {
    expect(parseOffboardIntent('Quinn Baker is leaving')).toBe('Quinn Baker');
    expect(parseOffboardIntent('Nora Alvarez last day is Friday')).toBe(
      'Nora Alvarez',
    );
  });

  it("returns null when there's no offboard intent", () => {
    expect(parseOffboardIntent('onboard Nora Alvarez')).toBeNull();
    expect(parseOffboardIntent('what can you do?')).toBeNull();
    expect(parseOffboardIntent('grant Slack to Sam')).toBeNull();
  });
});

describe('parseViewIntent', () => {
  it('extracts the name from a pull-up/show/look-up request', () => {
    // The exact case from the bug report.
    expect(parseViewIntent('pull up the user Nora')).toBe('Nora');
    expect(parseViewIntent('pull up Nora Alvarez')).toBe('Nora Alvarez');
    expect(parseViewIntent('show me Sam')).toBe('Sam');
    expect(parseViewIntent('look up Quinn Baker')).toBe('Quinn Baker');
    expect(parseViewIntent('view Jordan')).toBe('Jordan');
    expect(parseViewIntent("open Dana's profile")).toBe('Dana');
    expect(parseViewIntent('find Alex')).toBe('Alex');
  });

  it('extracts the name from status/possessive phrasings', () => {
    expect(parseViewIntent('what does Nora have')).toBe('Nora');
    expect(parseViewIntent('status of Quinn')).toBe('Quinn');
    expect(parseViewIntent('how is Jordan doing')).toBe('Jordan');
    expect(parseViewIntent("show me Sam's status")).toBe('Sam');
    expect(parseViewIntent("what's on Dana's plan")).toBe('Dana');
  });

  it('does NOT treat onboard/offboard requests as a lookup', () => {
    expect(parseViewIntent('onboard Nora Alvarez')).toBeNull();
    expect(parseViewIntent('offboard Quinn Baker')).toBeNull();
    expect(parseViewIntent('deprovision Sam')).toBeNull();
  });

  it('returns null for a bare pronoun or non-lookup chatter', () => {
    expect(parseViewIntent('show me')).toBeNull();
    expect(parseViewIntent('what does it cost')).toBeNull();
    expect(parseViewIntent('publish')).toBeNull();
  });
});

describe('parseListCandidatesIntent', () => {
  it('matches explicit list-the-candidates requests', () => {
    for (const t of [
      'show me the candidates',
      'list candidates',
      'show candidates',
      'what candidates are available',
      'who can I onboard',
      "who's in the pipeline",
      'current candidates',
    ]) {
      expect(parseListCandidatesIntent(t)).toBe(true);
    }
  });

  it('does not treat a single-name onboard/lookup as a list request', () => {
    expect(parseListCandidatesIntent('onboard Nora Alvarez')).toBe(false);
    expect(parseListCandidatesIntent('pull up Sam')).toBe(false);
    expect(parseListCandidatesIntent('offboard Quinn')).toBe(false);
    expect(parseListCandidatesIntent('Nora Alvarez')).toBe(false);
  });
});

describe('parseRemoveSeatIntent', () => {
  it('parses a possessive seat removal', () => {
    expect(parseRemoveSeatIntent("revoke Nora's Figma seat")).toEqual({
      hint: 'Nora',
      appRef: 'Figma',
    });
    expect(
      parseRemoveSeatIntent("reclaim Taylor Kim's idle GitHub license"),
    ).toEqual({hint: 'Taylor Kim', appRef: 'GitHub'});
  });

  it('parses a "from <person>" seat removal', () => {
    expect(parseRemoveSeatIntent('remove Slack from Sam')).toEqual({
      hint: 'Sam',
      appRef: 'Slack',
    });
  });

  it('ignores offboarding and non-removal messages', () => {
    expect(parseRemoveSeatIntent('offboard Quinn Baker')).toBeNull();
    expect(parseRemoveSeatIntent('pull up Nora')).toBeNull();
    expect(parseRemoveSeatIntent('onboard Sam')).toBeNull();
  });
});

describe('parseCreateTemplateIntent', () => {
  it('matches create-template requests', () => {
    for (const t of [
      'create a template',
      'build a new template',
      'make a new onboarding template',
      'add a role template',
      'set up a template',
    ]) {
      expect(parseCreateTemplateIntent(t)).toBe(true);
    }
  });

  it('does not match unrelated messages', () => {
    expect(parseCreateTemplateIntent('use the Designer template')).toBe(false);
    expect(parseCreateTemplateIntent('onboard Nora')).toBe(false);
    expect(parseCreateTemplateIntent('create a plan')).toBe(false);
  });
});
