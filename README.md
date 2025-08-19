# A11y Report Runner (Playwright + axe-core)

[![CI](https://img.shields.io/github/actions/workflow/status/monicaaikorice/a11y-report-runner/ci.yml?branch=main)](https://github.com/monicaaikorice/a11y-report-runner/actions)  
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#license)  
[![TypeScript Friendly](https://img.shields.io/badge/JS-ESM-blue)](#)  
[![Accessibility](https://img.shields.io/badge/axe--core-Enabled-5e5ce6.svg)](#)  

A zero-dependency (for the report HTML) accessibility scan script powered by **Playwright** and **axe-core**. It crawls a list of routes, runs axe, emits a consolidated **JSON** dataset and a human-readable **HTML** dashboard—perfect for CI and shareable audits.

> Script file: `scripts/a11y-report.mjs` (ESM)

---

## ✨ Features

- 🔎 Scans multiple routes (config via env)  
- 🌓 Forces light/dark color scheme (toggle in code)  
- 📦 Outputs:  
  - `a11y-report/axe-results.json` (raw data)  
  - `a11y-report/axe-report.html` (hand-rolled report UI)  
- 🧩 WCAG tags surfaced inline  
- 🧪 CI-friendly (exit code 0 unless the script throws; easy to extend to fail on violations)  

---

## 🚀 Quick Start

```
# 1) Install deps
npm i -D playwright @axe-core/playwright

# 2) Install Playwright browsers (CI: use --with-deps on Linux)
npx playwright install

# 3) Run your web app locally (or set A11Y_BASE to a deployed URL)

# 4) Execute the scan
node scripts/a11y-report.mjs
```

Open `a11y-report/axe-report.html` in your browser. 🎉

---

## ⚙️ Configuration

Environment variables (all optional):

| Variable      | Default                                    | Description                     |
|---------------|--------------------------------------------|---------------------------------|
| `A11Y_BASE`   | `http://localhost:3000`                    | Base URL used to resolve routes |
| `A11Y_ROUTES` | `"/, /blog, /projects, /services, /astra, /about"` | Comma-separated route list |
| `A11Y_OUT`    | `a11y-report`                              | Output folder                   |

Examples:

```
# Single page on prod
A11Y_BASE="https://example.com" \
A11Y_ROUTES="/" \
node scripts/a11y-report.mjs

# Custom routes & out dir
A11Y_ROUTES="/,/blog,/posts/intro" \
A11Y_OUT="reports/a11y-$(date +%Y%m%d)" \
node scripts/a11y-report.mjs
```

---

## 📜 NPM Scripts (suggested)

```
{
  "scripts": {
    "a11y:install": "playwright install",
    "a11y:scan": "node scripts/a11y-report.mjs",
    "a11y": "npm run a11y:install && npm run a11y:scan"
  }
}
```

---

## 🧭 Interpreting the Report

- **Violations**: Must-fix issues (color contrast, missing labels, etc.)  
- **Incomplete**: axe needs manual verification (often dynamic content)  
- **Inapplicable**: Rules that didn’t apply to your DOM  
- **Passes**: Rules you’re already meeting (nice!)  

---

## 🧪 CI Usage (GitHub Actions example)

Create `.github/workflows/ci.yml`:

```
name: a11y-ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Build & start app
        run: |
          npm run build
          npm run start & # start your server in background
          npx wait-on http://localhost:3000

      - name: Run a11y scan
        env:
          A11Y_BASE: http://localhost:3000
          A11Y_ROUTES: "/, /blog, /projects, /services, /astra, /about"
        run: node scripts/a11y-report.mjs

      - name: Upload report artifact
        uses: actions/upload-artifact@v4
        with:
          name: a11y-report
          path: a11y-report/*
```

---

## 🛠️ Customization Tips

- Change `newContext({ colorScheme: 'light' })` → `'dark'` to test dark mode.  
- Replace static `ROUTES` with a sitemap crawler.  
- Add guards to fail CI if violations > 0.  
- Parallelize routes in CI for faster runs.  

---

## 📚 Credits

- [Playwright](https://playwright.dev/) – browser automation  
- [axe-core](https://www.deque.com/axe/) – accessibility engine  

---

## 📄 License

MIT © You. See [LICENSE](LICENSE) for details.  
