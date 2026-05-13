/* global normalizeText, escapeRegex, canonicalizeBlacklistTerm */

describe('normalizeText()', () => {
  // ── Type guards ─────────────────────────────────────────────────────────────
  test('returns empty string for null', () => {
    expect(normalizeText(null)).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  test('returns empty string for non-string (number)', () => {
    expect(normalizeText(123)).toBe('');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(normalizeText('   \n\t ')).toBe('');
  });

  // ── Basic normalization ──────────────────────────────────────────────────────
  test('trims and lowercases', () => {
    expect(normalizeText('  HeLLo WoRLD  ')).toBe('hello world');
  });

  test('collapses repeated whitespace', () => {
    expect(normalizeText('a   b\t\tc\n\nd')).toBe('a b c d');
  });

  // ── Smart apostrophes and quotes ──────────────────────────────────────────
  test('folds curly right single quote to ASCII apostrophe', () => {
    expect(normalizeText('’ve')).toBe("'ve");
  });

  test('folds curly left single quote to ASCII apostrophe', () => {
    expect(normalizeText('‘Hello’')).toBe("'hello'");
  });

  test('folds smart double quotes to ASCII double quote', () => {
    expect(normalizeText('“Hello”')).toBe('"hello"');
  });

  // ── Dash variants ─────────────────────────────────────────────────────────
  test('folds em dash to hyphen', () => {
    expect(normalizeText('foo—bar')).toBe('foo-bar');
  });

  test('folds en dash to hyphen', () => {
    expect(normalizeText('foo–bar')).toBe('foo-bar');
  });

  // ── Invisible characters ──────────────────────────────────────────────────
  test('removes zero-width space', () => {
    expect(normalizeText('a​b')).toBe('ab');
  });

  test('removes byte-order mark', () => {
    expect(normalizeText('﻿hello')).toBe('hello');
  });

  test('removes soft hyphen', () => {
    expect(normalizeText('sof­t')).toBe('soft');
  });

  // ── NFKC compatibility normalization ──────────────────────────────────────
  test('NFKC: fullwidth letters to ASCII', () => {
    expect(normalizeText('ＡＩ')).toBe('ai'); // Ａ Ｉ
  });

  test('NFKC: fi ligature expands', () => {
    expect(normalizeText('ﬁle')).toBe('file'); // ﬁ
  });

  // ── Combined transformations ──────────────────────────────────────────────
  test('handles real-world LinkedIn injection scenario', () => {
    const input = '﻿ “I’ve”​   ARRIVED—NOW ';
    expect(normalizeText(input)).toBe('"i\'ve" arrived-now');
  });
});

describe('canonicalizeBlacklistTerm()', () => {
  test('plain phrase → normalized lowercase text', () => {
    expect(canonicalizeBlacklistTerm(' AI Slop ')).toBe('ai slop');
  });

  test('hashtag → normalized lowercase text', () => {
    expect(canonicalizeBlacklistTerm('#AISLOP')).toBe('#aislop');
  });

  test('two raws that normalize to the same key share a canonical form', () => {
    expect(canonicalizeBlacklistTerm('  Hustle  Harder  '))
      .toBe(canonicalizeBlacklistTerm('HUSTLE HARDER'));
  });
});

describe('escapeRegex()', () => {
  test('leaves ordinary text unchanged', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });

  test('escapes all regex metacharacters', () => {
    const raw = '.*+?^${}()|[]\\';
    const re  = new RegExp(escapeRegex(raw));
    expect(re.test(raw)).toBe(true);
  });

  test('escaped pattern does not match unescaped form', () => {
    const raw = 'a+b(c)';
    const re  = new RegExp(escapeRegex(raw));
    expect(re.test('a+b(c)')).toBe(true);
    expect(re.test('ab(c)')).toBe(false);
  });

  test('escapes dot so it only matches a literal dot', () => {
    const re = new RegExp(escapeRegex('a.b'));
    expect(re.test('a.b')).toBe(true);
    expect(re.test('axb')).toBe(false);
  });
});
