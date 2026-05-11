# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Obsidian Web Clipper is a cross-browser extension (Chrome, Firefox, Safari) that clips web pages to Markdown for Obsidian. It also ships as a Node.js CLI and a programmatic API (`src/cli.ts`, `src/api.ts`).

## Build commands

```bash
# Extension development (watch mode with source maps)
npm run dev          # alias for dev:chrome; outputs to dev/
npm run dev:chrome   # outputs to dev/
npm run dev:firefox  # outputs to dev_firefox/
npm run dev:safari   # outputs to dev_safari/

# Extension production builds (minified, zipped to builds/)
npm run build        # builds all three browsers
npm run build:chrome   # outputs to dist/
npm run build:firefox  # outputs to dist_firefox/
npm run build:safari   # outputs to dist_safari/

# CLI / API (esbuild)
npm run build:cli    # outputs dist/cli.cjs (CJS for Node)
npm run build:api    # outputs dist/api.mjs (ESM for programmatic use)

# Tests
npm test             # vitest run (all src/**/*.test.ts)
npm run test:watch   # vitest watch mode
npx vitest run src/utils/filters/date.test.ts   # single test file

# Linting
npx eslint src/      # ESLint with .eslintrc.json (tabs required)

# i18n / locale scripts (ts-node with scripts/tsconfig.json)
npm run update-locales
npm run check-strings
npm run add-locale -- <locale-code>
```

## Architecture

### Extension runtime model

The extension has four runtime contexts that communicate via `browser.runtime.sendMessage` / `browser.tabs.sendMessage` (using `webextension-polyfill`):

- **Background script** (`src/background.ts`): service worker that serves as the central message hub. It listens on `browser.runtime.onMessage` and dispatches based on the `action` property of each message. It manages per-tab state (highlighter active, reader mode), context menus, keyboard commands, and declarativeNetRequest rules for YouTube embeds.
- **Content script** (`src/content.ts`): injected into every normal web page. Runs in an IIFE with a generation counter (`window.obsidianClipperGeneration`) so stale instances yield to freshly-injected ones after extension updates. Extracts page content via Defuddle, manages the embedded iframe (`toggle-iframe`), and exposes `window.__obsidianHighlighter` for the reader script.
- **Popup / side-panel** (`src/core/popup.ts`): the main clipper UI. Works both as a browser-action popup and as an iframe embedded in the page (`side-panel.html?context=iframe`).
- **Reader script** (`src/reader-script.ts`): injected into pages when reader mode activates. Delegates highlighter operations to the content script via `window.__obsidianHighlighter`.

### Messaging pattern

All cross-context communication uses message objects with an `action` string property. The background script is the hub: content scripts and popup pages send messages to the background, which forwards them to the correct target (a specific tab's content script, or a specific extension page). Messages to content scripts use `browser.tabs.sendMessage(tabId, message)`. Messages to extension pages (popup, reader page) use `browser.runtime.sendMessage(message)`.

### Storage

`src/utils/storage-utils.ts` wraps `browser.storage.local` and `browser.storage.sync` for persisting templates, settings, highlighter state, and note indices. LZ-String compresses template content to reduce storage space.

### Template engine

The extension uses a custom template language compiled in three stages:

1. **Tokenizer** (`src/utils/tokenizer.ts`) — converts template strings into a token stream.
2. **Parser** (`src/utils/parser.ts`) — converts tokens into an AST supporting text, variable interpolation, `if`/`elseif`/`else`/`endif`, `for`/`endfor`, and `set`.
3. **Renderer** (`src/utils/renderer.ts`) — evaluates the AST against a variable dictionary, applying filters and resolving async variables (e.g. CSS selectors).

Filters live in `src/utils/filters/*.ts` and are registered in `src/utils/filters.ts`. Each filter has a co-located `*.test.ts` file. Variables are resolved in `src/utils/variables/` (simple, selector, schema, prompt types).

### Content extraction pipeline

- `src/content.ts` → `parseForClip(document)` (`src/utils/clip-utils.ts`) → Defuddle parses the DOM.
- `src/utils/content-extractor.ts` builds the variable dictionary from page metadata, selection, highlights, and extracted content.
- `src/utils/shared.ts` contains pure helper functions (`buildVariables`, `generateFrontmatter`, `extractContentBySelector`) used by both the browser extension and the CLI. **This file must not import any browser-specific APIs** (no `webextension-polyfill`, `storage-utils`, or browser globals).

### CLI / API builds

- `scripts/build-cli.mjs` bundles `src/cli.ts` with esbuild for Node.js. It injects a banner that polyfills `DOMParser` and `document` via `linkedom` before any module code runs, because `defuddle/full` checks `window.DOMParser` at module init time.
- `scripts/build-api.mjs` bundles `src/api.ts` as an ESM module. It externalizes `defuddle`, `defuddle/full`, and `dayjs` so consumers provide their own.
- Both builds alias `webextension-polyfill` to `src/utils/cli-stubs.ts`, which provides no-op stubs for browser APIs.

### Key directories

| Directory | Purpose |
|-----------|---------|
| `src/core/` | UI entry points (popup, settings, highlights, reader-view) |
| `src/managers/` | UI managers (templates, settings sections, menus) |
| `src/utils/` | Core logic: extraction, compilation, rendering, filters, DOM helpers |
| `src/utils/filters/` | Individual template filters, each with a `*.test.ts` |
| `src/utils/variables/` | Variable resolvers: simple, selector, schema, prompt |
| `src/styles/` | SCSS stylesheets |
| `src/_locales/` | i18n message files |
| `src/types/types.ts` | Shared TypeScript interfaces |

### Browser-specific manifests

Three manifests are copied depending on the target: `src/manifest.chrome.json`, `src/manifest.firefox.json`, `src/manifest.safari.json`. The webpack config selects the correct one via `env.BROWSER`.

## Webpack build system

The extension uses webpack 5 with a single config (`webpack.config.js`). Key details:

- **Entry points** (9 bundles): `popup`, `settings`, `highlights`, `reader-page`, `content`, `background`, `style`, `highlighter`, `reader`, `reader-script`.
- **TypeScript**: compiled via `ts-loader` targeting ES2020 module output.
- **SCSS**: compiled via `sass-loader` → `css-loader` → `MiniCssExtractPlugin` into separate CSS files.
- **HTML files** (`popup.html`, `side-panel.html`, `settings.html`, `highlights.html`, `reader.html`), **icons**, **locales**, and `webextension-polyfill` are copied verbatim via `CopyPlugin`.
- **Minification**: TerserPlugin with `mangle: false` (identifiers preserved for extension review compliance) and `DEBUG_MODE` dead-code elimination in production.
- **Globals**: `__BUILD_DATE__` (timestamp), `__BUILD_VERSION__` (from package.json), and `DEBUG_MODE` (false in production) are injected via `webpack.DefinePlugin`.
- **Production**: `ZipPlugin` creates `builds/obsidian-web-clipper-{version}-{browser}.zip`.
- Source maps are generated only in development.

## Test infrastructure

- **Runner**: Vitest with `globals: true` (no explicit `import` needed for `describe`/`it`/`expect`).
- **File pattern**: `src/**/*.test.ts` — tests are co-located with source files.
- **Browser API mock**: `src/utils/__mocks__/webextension-polyfill.ts` provides no-op stubs for `browser.runtime`, `browser.storage`, `browser.tabs`, and `browser.i18n`. Vitest aliases `webextension-polyfill` to this mock.
- **DEBUG_MODE**: set to `false` in the test environment via vitest config `define`.

## Code conventions

- Use **tabs** for indentation (enforced by ESLint `indent: ["error", "tab"]` — there is no `npm run lint` script, run `npx eslint` directly).
- Tests are co-located with source files (`*.test.ts` alongside the module under test).
- `src/utils/shared.ts` must remain browser-agnostic so it can be bundled for both the extension and the CLI.
- The `DEBUG_MODE` global is set to `true` in development builds and `false` in production; use it for conditional debug logging.
- tsconfig has `baseUrl: "src"` with path aliases: imports can use `managers/*`, `utils/*`, and `icons` as shorthand (e.g. `import { ... } from "utils/shared"`).

## Key third-party libraries

- **defuddle**: content extraction and HTML-to-Markdown conversion
- **webextension-polyfill**: cross-browser extension API normalization
- **dayjs**: date parsing and formatting
- **lz-string**: template compression for storage
- **dompurify**: HTML sanitization
- **linkedom**: DOM polyfill for the Node.js CLI build
