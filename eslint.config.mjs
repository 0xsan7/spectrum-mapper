import js from '@eslint/js';
import globals from 'globals';

/**
 * Spectrum Mapper lint config (ESLint 9 flat config).
 *
 * Two source trees with different environments:
 *   - Node side:  CommonJS modules run by the server, plus test/.
 *   - Browser side: public/*.js are classic <script> tags that share one global
 *     scope, so a class defined in colors.js is simply in scope in heatmap.js.
 *     ESLint cannot see that, so each *consumer* file is granted the names it
 *     borrows. The file that *defines* a name is deliberately excluded:
 *     declaring it global there trips no-redeclare on the definition site.
 */
const BROWSER_CONSUMERS = {
  // name: [files that reference it without defining it]
  WebSocketClient: ['public/dashboard.js'], // websocket.js
  HeatmapRenderer: ['public/dashboard.js'], // heatmap.js
  LegendBar: ['public/dashboard.js'], // legend.js
  SidebarTabs: ['public/dashboard.js'], // tabs.js
  ShortcutSheet: ['public/dashboard.js', 'public/shortcuts.js'], // shortcut-sheet.js
  ColorMapper: ['public/heatmap.js', 'public/legend.js', 'public/dashboard.js'], // colors.js
  CONTOUR_LEVELS: ['public/dashboard.js'], // heatmap.js
  Interaction: ['public/dashboard.js'], // interaction.js
  Controls: ['public/dashboard.js'], // controls.js
  RssiChart: ['public/dashboard.js'], // chart.js
  ExportManager: ['public/dashboard.js'], // export.js
  Logger: ['public/websocket.js', 'public/dashboard.js'], // logger.js
  Throttle: ['public/controls.js'], // performance.js
  spectrumAnalyzer: ['public/dashboard.js'], // spectrum-analysis.js
  Dashboard: ['public/responsive.js', 'public/shortcuts.js'], // dashboard.js
};

/**
 * Top-level names that exist only to be consumed elsewhere in a later change.
 * They are part of a classic script's public surface, so no-unused-vars must
 * not fire on the definition site.
 */
const PUBLIC_SURFACE = Object.keys(BROWSER_CONSUMERS);

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', '.next/**', 'dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          // In a classic script a top-level class/const *is* the public surface,
          // even when nothing inside its own file calls it.
          varsIgnorePattern: `^(${PUBLIC_SURFACE.join('|')})$`,
        },
      ],
      'no-console': 'off',
    },
  },
  {
    // Node runtime
    files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Browser runtime
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
  },
  ...Object.entries(BROWSER_CONSUMERS).map(([name, files]) => ({
    files,
    languageOptions: { globals: { [name]: 'readonly' } },
  })),
  {
    // Config files are ESM by nature
    files: ['eslint.config.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
