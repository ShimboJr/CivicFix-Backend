// eslint.config.js — flat config (ESLint v9+), CommonJS syntax
//
// Uses @eslint/js recommended rules only.  This is intentionally minimal — the
// goal is to catch real bugs (undeclared variables, syntax errors) without
// failing on the existing code style.  Stricter rules (stylistic preferences,
// import ordering, etc.) can be layered on incrementally.
'use strict';

const js = require('@eslint/js');

module.exports = [
  // Apply recommended rules to all JS files
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
  },

  // Ignore generated / third-party directories
  {
    ignores: [
      'node_modules/**',
      'tests/**',       // test files use Jest globals (describe, it, expect)
                        // that the base recommended config doesn't declare;
                        // they're linted implicitly via the test runner anyway
    ],
  },

  // Declare Node.js globals so ESLint doesn't flag process, require, module,
  // __dirname, etc. as undeclared variables in CommonJS files.
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        // Node.js built-ins
        process:       'readonly',
        require:       'readonly',
        module:        'writable',
        exports:       'writable',
        __dirname:     'readonly',
        __filename:    'readonly',
        console:       'readonly',
        Buffer:        'readonly',
        setTimeout:    'readonly',
        clearTimeout:  'readonly',
        setInterval:   'readonly',
        clearInterval: 'readonly',
        URL:           'readonly',
      },
    },
    rules: {
      // no-unused-vars: error on genuinely unused locals, but allow
      // underscore-prefixed params — this matches the Express middleware
      // convention used throughout the codebase (_req, _res, _next).
      'no-unused-vars': ['error', {
        vars:                      'all',
        args:                      'after-used',
        argsIgnorePattern:         '^_',
        caughtErrors:              'all',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
];
