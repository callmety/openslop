/* global compileBlacklist */

describe('compileBlacklist() — empty / invalid inputs', () => {
  test('empty array returns isEmpty=true and never matches', () => {
    const m = compileBlacklist([]);
    expect(m.isEmpty).toBe(true);
    expect(m.matches('anything')).toBe(false);
  });

  test('null input returns isEmpty=true', () => {
    expect(compileBlacklist(null).isEmpty).toBe(true);
  });

  test('undefined input returns isEmpty=true', () => {
    expect(compileBlacklist(undefined).isEmpty).toBe(true);
  });

  test('array of blank / invalid terms is treated as empty', () => {
    expect(compileBlacklist(['', '   ', null]).isEmpty).toBe(true);
  });

  test('falsy rawText never matches', () => {
    const m = compileBlacklist(['ai slop']);
    expect(m.matches('')).toBe(false);
    expect(m.matches(null)).toBe(false);
    expect(m.matches(undefined)).toBe(false);
  });
});

describe('compileBlacklist() — plain phrase matching', () => {
  test('matches a phrase case-insensitively', () => {
    const m = compileBlacklist(['ai slop']);
    expect(m.matches('This is AI Slop!')).toBe(true);
  });

  test('matches with flexible internal whitespace', () => {
    const m = compileBlacklist(['ai slop']);
    expect(m.matches('this is ai\n   slop now')).toBe(true);
  });

  test('matches at start of string', () => {
    const m = compileBlacklist(['hustle harder']);
    expect(m.matches('hustle harder every day')).toBe(true);
  });

  test('matches at end of string', () => {
    const m = compileBlacklist(['hustle harder']);
    expect(m.matches('you should hustle harder')).toBe(true);
  });

  test('does NOT match inside a longer word (Scunthorpe guard)', () => {
    const m = compileBlacklist(['slop']);
    expect(m.matches('sloppy design')).toBe(false);
  });

  test('does NOT match a plain phrase inside a hashtag', () => {
    const m = compileBlacklist(['grindset']);
    expect(m.matches('love #grindset posts')).toBe(false);
  });

  test('normalizes and deduplicates blacklist entries', () => {
    // All three collapse to the same normalized form — only one regex compiled.
    const m = compileBlacklist([' AI Slop ', 'ai slop', 'AI​SLOP']);
    expect(m.isEmpty).toBe(false);
    expect(m.matches('this is ai slop')).toBe(true);
  });
});

describe('compileBlacklist() — hashtag matching', () => {
  test('matches hashtag case-insensitively', () => {
    const m = compileBlacklist(['#grindset']);
    expect(m.matches('Big #GRINDSET energy')).toBe(true);
  });

  test('does NOT match a longer hashtag', () => {
    const m = compileBlacklist(['#aislop']);
    expect(m.matches('#aisloppy is different')).toBe(false);
  });

  test('matches hashtag surrounded by punctuation', () => {
    const m = compileBlacklist(['#grindset']);
    expect(m.matches('(#grindset)')).toBe(true);
  });

  test('matches hashtag at start of string', () => {
    const m = compileBlacklist(['#grindset']);
    expect(m.matches('#grindset culture')).toBe(true);
  });

  test('matches hashtag at end of string', () => {
    const m = compileBlacklist(['#grindset']);
    expect(m.matches('the real #grindset')).toBe(true);
  });
});

describe('compileBlacklist() — firstMatch()', () => {
  test('returns the matching raw term', () => {
    const m = compileBlacklist(['ai slop', 'grindset']);
    expect(m.firstMatch('this is ai slop')).toBe('ai slop');
  });

  test('returns null when no term matches', () => {
    const m = compileBlacklist(['ai slop']);
    expect(m.firstMatch('totally unrelated')).toBe(null);
  });

  test('returns null for falsy input', () => {
    const m = compileBlacklist(['ai slop']);
    expect(m.firstMatch('')).toBe(null);
    expect(m.firstMatch(null)).toBe(null);
  });
});
