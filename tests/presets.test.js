/* global HU_PRESETS, getPresetEnabledIds, getEnabledPresetTerms,
          getEffectiveBlacklist, getSlopHeuristicThreshold,
          getSliderManagedTermIdsAtLevel */

// ── HU_PRESETS catalog smoke tests ────────────────────────────────────────────

describe('HU_PRESETS catalog', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(HU_PRESETS)).toBe(true);
    expect(HU_PRESETS.length).toBeGreaterThan(0);
  });

  test('contains expected category IDs', () => {
    const ids = HU_PRESETS.map(c => c.id);
    expect(ids).toContain('ai-hype');
    expect(ids).toContain('hustle-culture');
    expect(ids).toContain('engagement-bait');
  });

  test('every category has unique term IDs across the whole catalog', () => {
    const seen = {};
    for (const cat of HU_PRESETS) {
      for (const term of cat.terms) {
        expect(seen[term.id]).toBeUndefined();
        seen[term.id] = true;
      }
    }
  });

  test('numbers-theater category is present', () => {
    const ids = HU_PRESETS.map(c => c.id);
    expect(ids).toContain('numbers-theater');
  });
});

// ── getPresetEnabledIds() ─────────────────────────────────────────────────────

describe('getPresetEnabledIds()', () => {
  test('returns empty array for undefined settings', () => {
    expect(getPresetEnabledIds(undefined, 'ai-hype')).toEqual([]);
  });

  test('returns empty array when presetState is null', () => {
    expect(getPresetEnabledIds({ presetState: null }, 'ai-hype')).toEqual([]);
  });

  test('returns empty array when presetState is a string', () => {
    expect(getPresetEnabledIds({ presetState: 'bad' }, 'ai-hype')).toEqual([]);
  });

  test('returns empty array when category entry is a boolean', () => {
    expect(getPresetEnabledIds({ presetState: { 'ai-hype': true } }, 'ai-hype')).toEqual([]);
  });

  test('returns the enabled IDs array for a valid category', () => {
    const settings = {
      presetState: { 'ai-hype': ['one-person-unicorn', 'replace-your-team-with-ai'] },
    };
    expect(getPresetEnabledIds(settings, 'ai-hype')).toEqual([
      'one-person-unicorn',
      'replace-your-team-with-ai',
    ]);
  });

  test('deduplicates repeated IDs and drops non-string entries', () => {
    const settings = {
      presetState: {
        'ai-hype': ['one-person-unicorn', 123, 'one-person-unicorn', 'replace-your-team-with-ai'],
      },
    };
    expect(getPresetEnabledIds(settings, 'ai-hype')).toEqual([
      'one-person-unicorn',
      'replace-your-team-with-ai',
    ]);
  });

  test('returns empty array for a category not present in presetState', () => {
    expect(getPresetEnabledIds({ presetState: {} }, 'ai-hype')).toEqual([]);
  });
});

// ── getEnabledPresetTerms() ───────────────────────────────────────────────────

describe('getEnabledPresetTerms()', () => {
  test('returns empty array when nothing is enabled', () => {
    expect(getEnabledPresetTerms({})).toEqual([]);
  });

  test('returns empty array when all enabled IDs are unknown', () => {
    const settings = { presetState: { 'ai-hype': ['not-a-real-id'] } };
    expect(getEnabledPresetTerms(settings)).toEqual([]);
  });

  test('returns the raw term text for a single enabled ID', () => {
    const settings = { presetState: { 'ai-hype': ['one-person-unicorn'] } };
    const terms = getEnabledPresetTerms(settings);
    expect(terms).toContain('one-person unicorn');
  });

  test('returns terms in catalog order (not enabled-ID array order)', () => {
    // In the catalog, 'repost-if-you-agree' comes before 'comment-below-and-ill-send'
    const settings = {
      presetState: {
        'engagement-bait': ["comment-below-and-ill-send", "repost-if-you-agree"],
      },
    };
    const terms = getEnabledPresetTerms(settings);
    expect(terms.indexOf('repost if you agree')).toBeLessThan(
      terms.indexOf("comment below and i'll send")
    );
  });

  test('combines enabled terms from multiple categories', () => {
    const settings = {
      presetState: {
        'ai-hype':       ['one-person-unicorn'],
        'hustle-culture': ['grindset'],
      },
    };
    const terms = getEnabledPresetTerms(settings);
    expect(terms).toContain('one-person unicorn');
    expect(terms).toContain('#grindset');
  });

});

// ── getEffectiveBlacklist() ───────────────────────────────────────────────────

describe('getEffectiveBlacklist()', () => {
  test('returns custom blacklist when no presets enabled', () => {
    const settings = { blacklist: ['custom phrase', '#customtag'] };
    expect(getEffectiveBlacklist(settings)).toEqual(['custom phrase', '#customtag']);
  });

  test('returns empty array when nothing is configured', () => {
    expect(getEffectiveBlacklist({})).toEqual([]);
  });

  test('merges custom blacklist with enabled preset terms', () => {
    const settings = {
      blacklist: ['custom phrase'],
      presetState: { 'ai-hype': ['one-person-unicorn'] },
    };
    const result = getEffectiveBlacklist(settings);
    expect(result).toContain('custom phrase');
    expect(result).toContain('one-person unicorn');
  });

  test('deduplicates custom entries by normalized value, preserving first raw form', () => {
    // ' AI Slop ' and 'ai slop' both normalize to 'ai slop' — second is dropped.
    // 'AI\u200BSLOP' strips the zero-width space and becomes 'aislop' (no space) — a distinct
    // normalized form, so it is kept as a separate entry.
    const settings = { blacklist: [' AI Slop ', 'ai slop', ' AI Slop '] };
    const result = getEffectiveBlacklist(settings);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(' AI Slop ');
  });

  test('custom term wins deduplication over a matching preset term', () => {
    // 'Rise   and GRIND' normalizes to 'rise and grind', same as the preset term
    const settings = {
      blacklist: ['Rise   and GRIND'],
      presetState: { 'hustle-culture': ['rise-and-grind'] },
    };
    const result = getEffectiveBlacklist(settings);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('Rise   and GRIND');
  });

  test('drops blank and null custom entries', () => {
    const settings = { blacklist: ['', '   ', null, 'valid term'] };
    const result = getEffectiveBlacklist(settings);
    expect(result).toEqual(['valid term']);
  });

  test('handles undefined blacklist gracefully', () => {
    const settings = { presetState: { 'ai-hype': ['one-person-unicorn'] } };
    const result = getEffectiveBlacklist(settings);
    expect(result).toContain('one-person unicorn');
  });
});

// ── getPresetEnabledIds() — stale ID hardening ────────────────────────────────

describe('getPresetEnabledIds() stale-ID hardening', () => {
  test('silently drops IDs that no longer exist in the catalog', () => {
    const settings = {
      presetState: { 'ai-hype': ['one-person-unicorn', 'removed-old-id-that-no-longer-exists'] },
    };
    const result = getPresetEnabledIds(settings, 'ai-hype');
    expect(result).toContain('one-person-unicorn');
    expect(result).not.toContain('removed-old-id-that-no-longer-exists');
  });

  test('returns empty array when all stored IDs are stale', () => {
    const settings = {
      presetState: { 'hustle-culture': ['hustle-harder'] }, // hustle-harder was removed
    };
    const result = getPresetEnabledIds(settings, 'hustle-culture');
    expect(result).toEqual([]);
  });
});

describe('slop slider helpers', () => {
  test('getSlopHeuristicThreshold maps levels to expected thresholds', () => {
    // L1 + L2 are term/structural only (scorer off). L3 fires the scorer at
    // a HIGH threshold so it only catches posts with multiple strong signals.
    // L4 tightens but never drops below 65 (2 strong signals = 50–55, so
    // 65 still requires a meaningful pattern stack).
    expect(getSlopHeuristicThreshold(0)).toBe(0);
    expect(getSlopHeuristicThreshold(1)).toBe(0);
    expect(getSlopHeuristicThreshold(2)).toBe(80);
    expect(getSlopHeuristicThreshold(3)).toBe(65);
    expect(getSlopHeuristicThreshold(4)).toBe(50);
  });

  test('level 1 includes ai-prompt-artifacts terms', () => {
    const level1 = getSliderManagedTermIdsAtLevel(1);
    expect(level1).toContain('apa-as-an-ai-language-model');
  });

  test('low-signal-comments and inbox-cold-pitches fold into level 3', () => {
    const level3 = new Set(getSliderManagedTermIdsAtLevel(3));
    expect(level3.has('lsc-cfbr')).toBe(true);
    expect(level3.has('icp-calendly-link')).toBe(true);
  });

  test('level 4 is a superset of level 3', () => {
    const level3 = getSliderManagedTermIdsAtLevel(3);
    const level4 = new Set(getSliderManagedTermIdsAtLevel(4));
    level3.forEach(id => expect(level4.has(id)).toBe(true));
  });
});

// ── inbox-cold-pitches preset ───────────────────────────────────────────────

describe('inbox-cold-pitches preset category', () => {
  test('is present in the catalog', () => {
    expect(HU_PRESETS.map(c => c.id)).toContain('inbox-cold-pitches');
  });

  test('has a non-empty terms array', () => {
    const cat = HU_PRESETS.find(c => c.id === 'inbox-cold-pitches');
    expect(Array.isArray(cat.terms)).toBe(true);
    expect(cat.terms.length).toBeGreaterThan(0);
  });

  test('all term IDs are unique across the whole catalog', () => {
    const allIds = {};
    HU_PRESETS.forEach(cat => {
      cat.terms.forEach(t => {
        expect(allIds[t.id]).toBeUndefined();
        allIds[t.id] = true;
      });
    });
  });

  test('enabled terms are returned by getEnabledPresetTerms()', () => {
    const terms = getEnabledPresetTerms({
      presetState: { 'inbox-cold-pitches': ['icp-calendly-link'] },
    });
    expect(terms).toContain('calendly.com/');
  });
});
