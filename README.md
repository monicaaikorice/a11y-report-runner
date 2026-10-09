# Ally Report Runner

A standalone accessibility scanning CLI built with Playwright and axe-core. It scans a configured list of routes on any locally running or deployed website and writes consolidated JSON results and a human-readable HTML report.

## Requirements

- Node.js 24.x
- npm (use the included lockfile with `npm ci`)
- Playwright's Chromium browser and its system dependencies

## Install

From a clean checkout:

```sh
npm ci
npm run a11y:install:chromium
```

On Linux hosts that need Playwright's operating-system browser dependencies, install those separately with the appropriate system package manager or use Playwright's documented `--with-deps` option in an environment where system package installation is permitted.

## Run

Start the website you want to audit, then run:

```sh
A11Y_BASE="http://localhost:3000" \
A11Y_ROUTES="/" \
A11Y_OUT="a11y-report" \
npm run a11y:scan
```

`A11Y_BASE` can point to any reachable local or deployed website. Routes are comma-separated paths resolved against that base URL.

| Variable | Default | Description |
| --- | --- | --- |
| `A11Y_BASE` | `http://localhost:3000` | Base URL used to resolve routes |
| `A11Y_ROUTES` | `/, /blog, /projects, /services, /astra, /about` | Comma-separated route list; replace these example defaults with routes for the target site |
| `A11Y_OUT` | `a11y-report` | Output directory; existing report files with the same names are overwritten |

The runner produces:

- `axe-results.json` — consolidated axe results, including passes, violations, incomplete checks, and inapplicable rules.
- `axe-report.html` — a human-readable report with rule IDs, impact, tags, affected selectors, and failure summaries.

## Commands

- `npm run a11y:scan` — scan configured routes.
- `npm run a11y:install:chromium` — install the Chromium build matching the locked Playwright version.
- `npm run check` — check the CLI's JavaScript syntax.

## Limitations

The runner uses Chromium, one default viewport, and a light color-scheme context. It does not discover routes, start the target application, authenticate, interact with page controls, or test alternate viewport sizes and page states. Configure the target routes with `A11Y_ROUTES`; for interactive content, perform additional manual checks or separately automate the relevant states.

Axe violations are automated findings, not a conformance determination. Review `incomplete` results manually, and perform keyboard, screen-reader, zoom/reflow, and other context-dependent checks separately. The current CLI exits unsuccessfully when execution throws, but a scan with accessibility violations still exits successfully.

## License

MIT. See [LICENSE](LICENSE).
