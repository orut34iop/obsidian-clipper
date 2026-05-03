# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Obsidian Web Clipper is a cross-browser extension (Chrome, Firefox, Safari) that clips web pages to Markdown for Obsidian. It also ships as a Node.js CLI and a programmatic API (`src/cli.ts`, `src/api.ts`).

## Build commands

```bash
# Extension development (watch mode)
npm run dev:chrome     # default; outputs to dev/
npm run dev:firefox    # outputs to dev_firefox/
npm run dev:safari     # outputs to dev_safari/

# Extension production builds
npm run build          # builds all three browsers
npm run build:chrome   # outputs to dist/
npm run build:firefox  # outputs to dist_firefox/
npm run build:safari   # outputs to dist_safari/

# CLI / API (esbuild)
npm run build:cli      # outputs dist/cli.cjs
npm run build:api      # outputs dist/api.mjs

# Tests
npm test               # vitest run
npm run test:watch     # vitest watch mode
npx vitest run src/utils/filters/date.test.ts   # single test file

# i18n / locale scripts
npm run update-locales
npm run check-strings
npm run add-locale -- <locale-code>
```

## Architecture

### Extension runtime model

The extension has four runtime contexts that communicate via `browser.runtime.sendMessage` (using `webextension-polyfill`):

- **Background script** (`src/background.ts`): service worker that routes messages, manages highlighter/reader mode state per tab, handles context menus, keyboard commands, and declarativeNetRequest rules for YouTube embeds.
- **Content script** (`src/content.ts`): injected into every normal web page. Runs in an IIFE with a generation counter (`window.obsidianClipperGeneration`) so that stale content scripts yield to freshly-injected instances after extension updates. Extracts page content via Defuddle, manages the embedded iframe (`toggle-iframe`), and exposes `window.__obsidianHighlighter` so that the separately-bundled reader script can share highlighter state.
- **Popup / side-panel** (`src/core/popup.ts`): the main clipper UI. Works both as a browser-action popup and as an iframe embedded in the page (`side-panel.html?context=iframe`).
- **Reader script** (`src/reader-script.ts`): injected into pages when reader mode activates. It delegates highlighter operations to the content script via `window.__obsidianHighlighter` to avoid duplicate mutable state.

### Template engine

The extension uses a custom template language compiled in three stages:

1. **Tokenizer** (`src/utils/tokenizer.ts`) — converts template strings into a token stream.
2. **Parser** (`src/utils/parser.ts`) — converts tokens into an AST supporting text, variable interpolation, `if`/`elseif`/`else`/`endif`, `for`/`endfor`, and `set`.
3. **Renderer** (`src/utils/renderer.ts`) — evaluates the AST against a variable dictionary, applying filters and resolving async variables (e.g. CSS selectors).

Filters live in `src/utils/filters/*.ts` and are registered in `src/utils/filters.ts`. Each filter has a co-located `*.test.ts` file.

### Content extraction pipeline

- `src/content.ts` → `parseForClip(document)` (`src/utils/clip-utils.ts`) → Defuddle parses the DOM.
- `src/utils/content-extractor.ts` builds the variable dictionary from page metadata, selection, highlights, and extracted content.
- `src/utils/shared.ts` contains pure helper functions (`buildVariables`, `generateFrontmatter`, `extractContentBySelector`) used by both the browser extension and the CLI. **This file must not import any browser-specific APIs** (no `webextension-polyfill`, `storage-utils`, or browser globals).

### CLI / API builds

- `scripts/build-cli.mjs` bundles `src/cli.ts` with esbuild for Node.js. It injects a banner that polyfills `DOMParser` and `document` via `linkedom` before any module code runs, because `defuddle/full` checks `window.DOMParser` at module init time.
- `scripts/build-api.mjs` bundles `src/api.ts` as an ESM module for programmatic use. It externalizes `defuddle`, `defuddle/full`, and `dayjs`.
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

## Code conventions

- Use **tabs** for indentation (enforced by ESLint `indent: ["error", "tab"]`).
- Tests are co-located with source files (`*.test.ts` alongside the module under test).
- `src/utils/shared.ts` must remain browser-agnostic so it can be bundled for both the extension and the CLI.
- The `DEBUG_MODE` global is set to `true` in development builds and `false` in production; use it for conditional debug logging.
