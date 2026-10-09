# Example fixtures and sample report

These independent HTML pages demonstrate generic runner inputs. They do not use a framework or depend on files outside this repository.

- `index.html` is an accessible baseline page.
- `violations.html` deliberately contains an unnamed button (`button-name`) and an unnamed link (`link-name`). These are intentional WCAG defects for demonstrating findings; do not fix them in the fixture.
- `best-practice.html` deliberately puts content outside a landmark to demonstrate axe's best-practice-only `region` finding. It is not a WCAG violation.
- `responsive.html` changes its content flow at a CSS viewport breakpoint.
- `scheme.html` changes foreground and background colors with `prefers-color-scheme`.

To reproduce the sample scan from the repository root, use Node.js 24, install dependencies and Chromium as described in the main README, then run a static server in one terminal:

```sh
python3 -m http.server 8765 --directory examples
```

In another terminal, scan all five fixtures across two viewport sizes and both color schemes:

```sh
A11Y_BASE="http://127.0.0.1:8765" \
A11Y_ROUTES="/, /violations.html, /best-practice.html, /responsive.html, /scheme.html" \
A11Y_VIEWPORTS="mobile=320x800,desktop=1280x900" \
A11Y_COLOR_SCHEMES="light,dark" \
A11Y_OUT="examples/reports" \
npm run a11y:scan
```

Each run creates a unique timestamped directory containing `axe-results.json` and `axe-report.html`; existing runs are never overwritten. The committed report snapshot uses this same loopback origin and the same commands. Its timestamp and configuration identifiers describe the committed sample run; rerunning creates a separate report directory.

The sample report demonstrates automated findings only. Passing or failing scans do not establish WCAG conformance. Review the main README for the runner's test scope and manual-verification limitations.
