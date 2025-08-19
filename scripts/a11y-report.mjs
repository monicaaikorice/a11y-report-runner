// scripts/a11y-report.mjs
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const BASE_URL = process.env.A11Y_BASE || 'http://localhost:3000'
const ROUTES = (process.env.A11Y_ROUTES || '/, /blog, /projects, /services, /astra, /about')
  .split(',').map(s => s.trim())
const OUT_DIR   = path.resolve(process.env.A11Y_OUT || 'a11y-report')
const JSON_PATH = path.join(OUT_DIR, 'axe-results.json')
const HTML_PATH = path.join(OUT_DIR, 'axe-report.html')

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({ colorScheme: 'light' }) // change to 'dark' if you want
  const page = await context.newPage()

  const merged = {
    url: BASE_URL,
    timestamp: new Date().toISOString(),
    passes: [], violations: [], incomplete: [], inapplicable: []
  }

  for (const route of ROUTES) {
    const url = new URL(route, BASE_URL).toString()
    console.log(`🔎 Scanning ${url}`)
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '* { scroll-behavior: auto !important }' })

    const results = await new AxeBuilder({ page }).analyze()

    for (const key of ['passes','violations','incomplete','inapplicable']) {
      merged[key].push(...results[key].map(item => ({ ...item, url })))
    }
  }

  // Save JSON
  fs.writeFileSync(JSON_PATH, JSON.stringify(merged, null, 2), 'utf-8')

  // Build HTML (no deps)
  const html = buildHtml(merged)
  fs.writeFileSync(HTML_PATH, html, 'utf-8')

  await browser.close()
  console.log(`✅ Report ready: ${HTML_PATH}`)
}

function esc(s='') {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
}
function badge(txt, cls) {
  return `<span class="badge ${cls}">${esc(txt)}</span>`
}
function buildHtml(data) {
  const counts = {
    violations: data.violations.length,
    incomplete: data.incomplete.length,
    inapplicable: data.inapplicable.length,
    passes: data.passes.length
  }
  const section = (title, items, kind) => {
    if (!items.length) return `<section><h2>${esc(title)} (0)</h2><p class="none">None</p></section>`
    return `
<section>
  <h2>${esc(title)} (${items.length})</h2>
  <ul class="issues">
    ${items.map(v => `
      <li class="issue ${kind}">
        <div class="head">
          <div class="id">${esc(v.id)}</div>
          <div class="meta">
            ${badge(v.impact || 'n/a', 'impact')}
            ${badge((v.tags||[]).filter(t=>t.startsWith('wcag')).join(', ') || 'wcag-n/a','wcag')}
            <span class="url">${esc(v.url || data.url)}</span>
          </div>
        </div>
        <div class="help">${esc(v.help || '')}</div>
        ${Array.isArray(v.nodes) && v.nodes.length ? `
          <details>
            <summary>Nodes (${v.nodes.length})</summary>
            <ol class="nodes">
              ${v.nodes.slice(0,50).map(n => `
                <li>
                  <div class="target"><code>${esc((n.target||[]).join(' '))}</code></div>
                  ${n.failureSummary ? `<div class="fail">${esc(n.failureSummary)}</div>` : ''}
                </li>
              `).join('')}
            </ol>
          </details>
        `:''}
      </li>
    `).join('')}
  </ul>
</section>`
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A11y Report – ${esc(new URL(data.url).host)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { --bg:#0e0b14; --panel:#14111c; --text:#e6e1f4; --muted:#a7a0bd; --pink:#ff59b9; --cyan:#60e2ff; --violet:#b79cff; --bad:#ff6b6b; --warn:#ffb020; --ok:#34d399; }
  body { margin:0; background:var(--bg); color:var(--text); font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial; }
  header { padding:24px; border-bottom:1px solid #241f33; background:linear-gradient(180deg, rgba(255,89,185,.08), transparent 60%); }
  header h1 { margin:0 0 6px; font-size:20px; }
  header .meta { color:var(--muted); font-size:12px; }
  main { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .summary { display:flex; gap:12px; flex-wrap:wrap; margin: 16px 0 28px; }
  .card { background:var(--panel); border:1px solid #241f33; border-radius:12px; padding:12px 14px; min-width:160px; }
  .card h3 { margin:0 0 4px; font-size:13px; color:var(--muted); }
  .card .num { font-size:20px; font-weight:700; }
  section { margin: 24px 0; }
  h2 { font-size:16px; margin: 0 0 12px; }
  .issues { list-style:none; padding:0; margin:0; display:grid; gap:12px; }
  .issue { background:var(--panel); border:1px solid #241f33; border-radius:12px; padding:12px; }
  .issue .head { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  .issue .id { font-weight:700; }
  .issue .help { color:var(--muted); margin:6px 0 8px; }
  .issue .url { color:var(--cyan); font-size:12px; }
  .badge { display:inline-block; padding:2px 6px; border-radius:999px; font-size:11px; margin-right:6px; border:1px solid #2a243b; background:#1a1626; }
  .impact { color:#ffd9e9; }
  .wcag { color:#d8eafe; }
  .issue.violations { border-color: #3a2030; }
  .issue.incomplete { border-color: #3a2b1f; }
  .issue.inapplicable { border-color: #1f2f2f; }
  details { background:#100d18; border:1px solid #241f33; border-radius:10px; padding:8px 10px; }
  summary { cursor:pointer; color:var(--violet); }
  .nodes { margin:8px 0 0 18px; }
  code { background:#100d18; color:#eae4ff; padding:1px 4px; border-radius:6px; }
  .none { color:var(--muted); }
  footer { color:var(--muted); font-size:12px; padding:24px; border-top:1px solid #241f33; margin-top:32px; }
</style>
</head>
<body>
<header>
  <h1>Accessibility Report</h1>
  <div class="meta">Base: ${esc(data.url)} • Generated: ${esc(data.timestamp)}</div>
  <div class="summary">
    <div class="card"><h3>Violations</h3><div class="num" style="color:var(--bad)">${counts.violations}</div></div>
    <div class="card"><h3>Incomplete</h3><div class="num" style="color:var(--warn)">${counts.incomplete}</div></div>
    <div class="card"><h3>Inapplicable</h3><div class="num">${counts.inapplicable}</div></div>
    <div class="card"><h3>Passes</h3><div class="num" style="color:var(--ok)">${counts.passes}</div></div>
  </div>
</header>
<main>
  ${section('Violations', data.violations, 'violations')}
  ${section('Incomplete', data.incomplete, 'incomplete')}
  ${section('Inapplicable', data.inapplicable, 'inapplicable')}
  ${section('Passes', data.passes, 'passes')}
</main>
<footer>
  Generated with Playwright + axe-core. This HTML was handcrafted so you always get a human-friendly report.
</footer>
</body>
</html>`
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
