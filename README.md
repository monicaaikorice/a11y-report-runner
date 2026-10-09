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

## Automated axe coverage

The runner uses the locked `@axe-core/playwright` 4.13.0 package and its `axe-core` 4.13.0 dependency. The automated baseline selects axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`, plus `best-practice`. The 2.0 and 2.1 tags remain in the selection because WCAG 2.2 is cumulative. axe 4.13.0 has no separate `wcag22a` tag; its only `wcag22aa`-tagged rule is `target-size` for WCAG 2.2 SC 2.5.8. See the versioned [axe rule descriptions](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md) and [run options](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/API.md).

The explicit tag selection retains all 89 rules enabled by axe 4.13.0’s previous default run. It deliberately enables `target-size`, which axe marks disabled by default, so the configured run adds this WCAG 2.2 AA check. The rule tests whether targets are at least 24 CSS pixels or have sufficient spacing. Its result can still require review for WCAG exceptions and context axe cannot determine.

Experimental rules remain excluded, including WCAG-tagged `css-orientation-lock`, `label-content-name-mismatch`, `p-as-heading`, `table-fake-caption`, and `td-has-header`. Experimental best-practice rules `focus-order-semantics` and `hidden-content` also remain excluded. Deprecated `aria-roledescription` and `audio-caption`, obsolete duplicate-ID rules, and AAA-only rules such as `color-contrast-enhanced` are not enabled by this A/AA baseline. The test suite asserts the current 90-rule set (89 previous defaults plus `target-size`) against the locked axe version.

In JSON, `violations` contains failures from WCAG-tagged rules. `bestPractices` contains failures from best-practice-only rules, so these are not presented as WCAG violations. The `passes`, `incomplete`, and `inapplicable` arrays retain axe’s results for the selected WCAG and best-practice rules. Incomplete results need manual review.

This is an automated testing baseline, not a claim of WCAG 2.2 AA conformance. Axe evaluates rendered page content and cannot determine every success criterion. Manual review is still needed for keyboard operation and focus order, screen-reader behavior, zoom and reflow, content meaning and context, interaction states, and other criteria that require human judgment.

## Reports

- `axe-results.json` — consolidated axe results, including WCAG violations, best-practice-only failures, passes, incomplete checks, and inapplicable rules.
- `axe-report.html` — a human-readable report with separate WCAG and best-practice sections, rule IDs, impact, tags, affected selectors, and failure summaries.

## Commands

- `npm run a11y:scan` — scan configured routes.
- `npm run a11y:install:chromium` — install the Chromium build matching the locked Playwright version.
- `npm run check` — check the CLI and axe configuration JavaScript syntax.
- `npm test` — run the generic browser-backed axe configuration test.

## Limitations

The runner uses Chromium, one default viewport, and a light color-scheme context. It does not discover routes, start the target application, authenticate, interact with page controls, or test alternate viewport sizes and page states. Configure the target routes with `A11Y_ROUTES`; for interactive content, perform additional manual checks or separately automate the relevant states.

A scan with findings still exits successfully; the CLI exits unsuccessfully when execution throws. The test suite verifies the configured rule selection and output using controlled HTML, but it does not replace site-specific manual accessibility testing.

## License

MIT. See [LICENSE](LICENSE).
