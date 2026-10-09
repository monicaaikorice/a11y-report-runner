# Ally Report Runner

A standalone accessibility scanning CLI built with Playwright and axe-core. It scans a configured list of routes on any locally running or deployed website and writes consolidated JSON results and a human-readable HTML report.

## Using the report runner does not guarantee accessibility compliance. Human tests (keyboard navigation, screen reader, zoom, etc) are needed for verification of automated testing results. This is meant to be a tool, not a fix.

<img width="1840" height="908" alt="Screenshot of the generated accessibility report" src="https://github.com/user-attachments/assets/335d9e61-d53c-46d6-b983-1b54bda21b15" />

## Requirements

- Node.js 24.x
- npm (use the included lockfile with `npm ci`)
- Playwright's Chromium browser and its system dependencies

## Install from npm

Install the runner as a development dependency in the application you want to audit:

```sh
npm install --save-dev ally-report-runner
npx playwright install chromium
```

These registry installation commands apply after publication is approved. The release candidate currently retains `private: true`, so it cannot yet be installed from npm.

On Linux hosts that need Playwright's operating-system browser dependencies, use `npx playwright install --with-deps chromium` in an environment where system package installation is permitted, or install the required system packages separately.

## Install from source

From a clean repository checkout:

```sh
npm ci
npm run a11y:install:chromium
```

## Run

Start the website you want to audit, then run the installed CLI:

```sh
A11Y_BASE="http://localhost:3000" \
A11Y_OUT="a11y-report" \
npx ally-report-runner
```

The CLI takes its configuration from the environment variables below; it has no command-line option parser. From a source checkout, `npm run a11y:scan` runs the same CLI.

`A11Y_BASE` can point to any reachable local or deployed website. By default, the runner scans only `/`. Set `A11Y_ROUTES` to any comma-separated route list; whitespace around entries is ignored. Relative paths are resolved against the base URL, and absolute URLs can also be supplied. For example:

```sh
A11Y_BASE="http://localhost:3000" \
A11Y_ROUTES="/, /about, /projects/example" \
npx ally-report-runner
```

| Variable | Default | Description |
| --- | --- | --- |
| `A11Y_BASE` | `http://localhost:3000` | Base URL used to resolve routes |
| `A11Y_ROUTES` | `/` | Comma-separated paths or absolute URLs to scan; whitespace around routes is ignored |
| `A11Y_VIEWPORTS` | `default=1280x720` | Comma-separated named CSS viewport sizes such as `mobile=390x844,desktop=1440x900` |
| `A11Y_COLOR_SCHEMES` | `light` | Comma-separated `light`, `dark`, or both; every selected viewport/scheme combination is scanned |
| `A11Y_OUT` | `a11y-report` | Parent directory for unique per-run report directories; existing reports are never overwritten |

## Automated axe coverage

The runner uses the locked `@axe-core/playwright` 4.13.0 package and its `axe-core` 4.13.0 dependency. The automated baseline selects axe tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, and `wcag22aa`, plus `best-practice`. The 2.0 and 2.1 tags remain in the selection because WCAG 2.2 is cumulative. axe 4.13.0 has no separate `wcag22a` tag; its only `wcag22aa`-tagged rule is `target-size` for WCAG 2.2 SC 2.5.8. See the versioned [axe rule descriptions](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md) and [run options](https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/API.md).

The explicit tag selection retains all 89 rules enabled by axe 4.13.0’s previous default run. It deliberately enables `target-size`, which axe marks disabled by default, so the configured run adds this WCAG 2.2 AA check. The rule tests whether targets are at least 24 CSS pixels or have sufficient spacing. Its result can still require review for WCAG exceptions and context axe cannot determine.

Experimental rules remain excluded, including WCAG-tagged `css-orientation-lock`, `label-content-name-mismatch`, `p-as-heading`, `table-fake-caption`, and `td-has-header`. Experimental best-practice rules `focus-order-semantics` and `hidden-content` also remain excluded. Deprecated `aria-roledescription` and `audio-caption`, obsolete duplicate-ID rules, and AAA-only rules such as `color-contrast-enhanced` are not enabled by this A/AA baseline. The test suite asserts the current 90-rule set (89 previous defaults plus `target-size`) against the locked axe version.

In JSON, `violations` contains failures from WCAG-tagged rules. `bestPractices` contains failures from best-practice-only rules, so these are not presented as WCAG violations. The `passes`, `incomplete`, and `inapplicable` arrays retain axe’s results for the selected WCAG and best-practice rules. Incomplete results need manual review.

This is an automated testing baseline, not a claim of WCAG 2.2 AA conformance. Axe evaluates rendered page content and cannot determine every success criterion. Manual review is still needed for keyboard operation and focus order, screen-reader behavior, zoom and reflow, content meaning and context, interaction states, and other criteria that require human judgment.

## Reports

Each execution creates a unique UTC timestamp directory beneath `A11Y_OUT`, for example `a11y-report/2026-10-08T21-30-00Z/`. If that name already exists, the runner atomically creates a suffixed directory (`-01`, `-02`, and so on); it never reuses or overwrites an existing directory. The reports retain their established names inside each run directory:

- `axe-results.json` — consolidated axe results, including WCAG violations, best-practice-only failures, passes, incomplete checks, and inapplicable rules.
- `axe-report.html` — a human-readable report with separate WCAG and best-practice sections, rule IDs, impact, tags, affected selectors, and failure summaries.

The JSON adds a `versions` object and a `configurations` manifest. Each result carries its `configurationId`, route, resolved URL, viewport, and color scheme. Configuration IDs are deterministic for the same route and environment. Existing result arrays remain aggregated across every selected configuration, so consumers of repeated audits should use `configurationId` to distinguish findings. The generated static HTML report lists every tested configuration and labels findings accordingly.

## Example fixtures

The [repository examples](https://github.com/monicaaikorice/a11y-report-runner/tree/main/examples) directory contains five independent HTML pages for an accessible baseline, intentional WCAG violations, a best-practice-only finding, responsive content, and light/dark color-scheme behavior. The intentional defects are documented in the fixture comments and [fixture guide](https://github.com/monicaaikorice/a11y-report-runner/blob/main/examples/README.md); they are demonstrations and should not be corrected. Fixtures and sample reports remain in the repository and are excluded from the npm package.

To reproduce the sample scan, start the static fixture server:

```sh
python3 -m http.server 8765 --directory examples
```

Then run the documented route, viewport, and color-scheme matrix in the [fixture guide](https://github.com/monicaaikorice/a11y-report-runner/blob/main/examples/README.md). Re-running the command creates a new timestamped output directory and preserves the repository sample.

## Source maintenance commands

These npm scripts are for working in a source checkout:

- `npm run a11y:scan` — scan configured routes.
- `npm run a11y:install:chromium` — install the Chromium build matching the locked Playwright version.
- `npm run check` — check the CLI, configuration modules, and test JavaScript syntax.
- `npm test` — run configuration, browser-backed scanning, report-generation, accessibility-tree, and responsive reflow tests.

## Limitations

The runner uses Chromium and scans the Cartesian product of configured routes, viewports, and color schemes. The defaults remain one 1280×720 CSS viewport and light color scheme. CSS viewport and `prefers-color-scheme` emulation do not simulate browser zoom, text-only resizing, operating-system display scaling, forced colors, or assistive technology. The runner does not discover routes, start the target application, authenticate, or interact with page controls; prepared interactive states remain future work. Configure target routes with `A11Y_ROUTES`.

The release candidate remains marked `private: true` during qualification. The packed tarball can be installed locally for consumer testing, but npm publication remains disabled until it is separately approved.

A scan with findings still exits successfully; invalid configuration and execution or output errors exit unsuccessfully. The test suite verifies rule selection, matrix scans, collision handling, and the generated report using controlled HTML. This automated report check does not replace keyboard, screen-reader, zoom/reflow, or other manual accessibility testing.

## License

MIT. See [LICENSE](LICENSE).
