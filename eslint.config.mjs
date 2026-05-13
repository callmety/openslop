// OpenSlop — ESLint flat config (ESLint v9+, no npm dependencies)

export default [
  {
    files: ['shared/**/*.js', 'content/**/*.js', 'popup/**/*.js', 'background*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        // Browser globals.
        // `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`
        // are intentionally NOT listed — the privacy contract forbids network calls,
        // so any accidental use must fail `no-undef` lint.
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        navigator: 'readonly',
        URL: 'readonly',
        Node: 'readonly',
        MutationObserver: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Promise: 'readonly',
        // Chrome extension globals
        chrome: 'readonly',
        // Shared globals loaded via manifest content_scripts / popup script tags.
        // `HU` is declared in constants.js and consumed by all other scripts in the same context.
        HU:                          'writable',
        normalizeText:               'readonly',
        escapeRegex:                 'readonly',
        canonicalizeBlacklistTerm:   'readonly',
        normalizeSettings:           'readonly',
        getSettings:                 'readonly',
        saveSettings:                'readonly',
        getFeedCounter:              'readonly',
        setFeedCounter:              'readonly',
        setSessionTally:             'readonly',
        getSessionTally:             'readonly',
        compileBlacklist:            'readonly',
        createObserver:              'readonly',
        HU_PRESETS:                  'readonly',
        HU_SLOP_LEVELS:              'readonly',
        getPresetEnabledIds:         'readonly',
        getEnabledPresetTerms:       'readonly',
        getEffectiveBlacklist:       'readonly',
        getSlopSensitivityTerms:     'readonly',
        getSlopSensitivityDescriptor:'readonly',
      },
    },
    rules: {
      'no-console':     'error',
      'no-eval':        'error',
      'no-unused-vars': ['warn', { vars: 'all', args: 'after-used' }],
      'eqeqeq':         ['error', 'always'],
      'semi':           ['error', 'always'],
      'no-undef':       'error',
    },
  },
];
