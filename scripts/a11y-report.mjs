// scripts/a11y-report.mjs
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { createRequire } from 'node:module'
import { getAxeRunOptions, isBestPracticeOnly } from './axe-config.mjs'
import { buildConfigurations, createUniqueRunDirectory, parseColorSchemes, parseRoutes, parseViewports } from './run-config.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const BASE_URL = process.env.A11Y_BASE || 'http://localhost:3000'
const OUT_PARENT = path.resolve(process.env.A11Y_OUT || 'a11y-report')
const JSON_FILENAME = 'axe-results.json'
const HTML_FILENAME = 'axe-report.html'
const RUNNER_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')).version

function getPackageVersion(packageName) {
  let directory = path.dirname(require.resolve(packageName))
  while (directory !== path.dirname(directory)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf-8'))
      if (manifest.name === packageName) return manifest.version
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    directory = path.dirname(directory)
  }
  throw new Error(`Unable to determine installed version for ${packageName}.`)
}

async function run() {
  const routes = parseRoutes(process.env.A11Y_ROUTES)
  const viewports = parseViewports(process.env.A11Y_VIEWPORTS)
  const colorSchemes = parseColorSchemes(process.env.A11Y_COLOR_SCHEMES)
  const configurations = buildConfigurations(routes, BASE_URL, viewports, colorSchemes)
  const runDirectory = await createUniqueRunDirectory(OUT_PARENT)
  const jsonPath = path.join(runDirectory, JSON_FILENAME)
  const htmlPath = path.join(runDirectory, HTML_FILENAME)

  const browser = await chromium.launch()
  const merged = {
    url: BASE_URL,
    timestamp: new Date().toISOString(),
    versions: {
      runner: RUNNER_VERSION,
      axeCore: getPackageVersion('axe-core'),
      axePlaywright: getPackageVersion('@axe-core/playwright'),
      playwright: getPackageVersion('playwright')
    },
    configurations,
    passes: [], violations: [], bestPractices: [], incomplete: [], inapplicable: []
  }

  try {
    for (const viewport of viewports) {
      for (const colorScheme of colorSchemes) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme
        })
        try {
          const page = await context.newPage()
          for (const [routeIndex, route] of routes.entries()) {
            const configuration = configurations.find(item =>
              item.routeIndex === routeIndex && item.viewport.name === viewport.name &&
              item.colorScheme === colorScheme
            )
            console.log(`🔎 Scanning ${configuration.url} [${configuration.id}: ${viewport.name} ${viewport.width}x${viewport.height}, ${colorScheme}]`)
            await page.goto(configuration.url, { waitUntil: 'networkidle' })
            await page.addStyleTag({ content: '* { scroll-behavior: auto !important }' })

            const results = await new AxeBuilder({ page }).options(getAxeRunOptions()).analyze()
            const annotate = item => ({
              ...item,
              url: configuration.url,
              route: configuration.route,
              routeIndex: configuration.routeIndex,
              configurationId: configuration.id,
              viewport: configuration.viewport,
              colorScheme: configuration.colorScheme
            })

            for (const key of ['passes', 'violations', 'incomplete', 'inapplicable']) {
              const items = results[key].map(annotate)
              if (key === 'violations') {
                merged.violations.push(...items.filter(item => !isBestPracticeOnly(item)))
                merged.bestPractices.push(...items.filter(isBestPracticeOnly))
              } else {
                merged[key].push(...items)
              }
            }
          }
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }

  const json = JSON.stringify(merged, null, 2)
  const html = buildHtml(merged)
  try {
    await fs.promises.writeFile(jsonPath, json, { encoding: 'utf-8', flag: 'wx' })
    await fs.promises.writeFile(htmlPath, html, { encoding: 'utf-8', flag: 'wx' })
  } catch (error) {
    throw new Error(`Unable to write report output in "${runDirectory}": ${error.message}`, { cause: error })
  }

  console.log(`✅ JSON report: ${jsonPath}`)
  console.log(`✅ HTML report: ${htmlPath}`)
}

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function badge(txt, cls) {
  return `<span class="badge ${cls}">${esc(txt)}</span>`
}
function buildHtml(data) {
  const counts = {
    violations: data.violations.length,
    bestPractices: data.bestPractices.length,
    incomplete: data.incomplete.length,
    inapplicable: data.inapplicable.length,
    passes: data.passes.length
  }
  const configurationList = data.configurations.map(configuration => `
    <li><code>${esc(configuration.id)}</code> — route ${configuration.routeIndex + 1}: ${esc(configuration.route)} · ${esc(configuration.url)} · ${esc(configuration.viewport.name)} (${configuration.viewport.width}×${configuration.viewport.height}) · ${esc(configuration.colorScheme)}</li>
  `).join('')
  const configurationLabel = item => {
    const viewport = item.viewport || {}
    return `${item.configurationId || 'unknown'} · route ${(item.routeIndex ?? 0) + 1}: ${item.route || item.url || data.url} · ${viewport.name || 'viewport'} (${viewport.width || '?'}×${viewport.height || '?'}) · ${item.colorScheme || 'scheme'}`
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
        <p class="configuration">Configuration: ${esc(configurationLabel(v))}</p>
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
  .card h2 { margin:0 0 4px; font-size:13px; color:var(--muted); }
  .card .num { font-size:20px; font-weight:700; }
  section { margin: 24px 0; }
  h2 { font-size:16px; margin: 0 0 12px; }
  .configurations { overflow-wrap:anywhere; }
  .configurations ul { padding-left:24px; }
  .issues { list-style:none; padding:0; margin:0; display:grid; gap:12px; }
  .issue { background:var(--panel); border:1px solid #241f33; border-radius:12px; padding:12px; }
  .issue .head { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  .issue .id { font-weight:700; }
  .issue .configuration { color:var(--muted); font-size:12px; overflow-wrap:anywhere; margin:6px 0; }
  .issue .help { color:var(--muted); margin:6px 0 8px; }
  .issue .url { color:var(--cyan); font-size:12px; overflow-wrap:anywhere; }
  .badge { display:inline-block; padding:2px 6px; border-radius:999px; font-size:11px; margin-right:6px; border:1px solid #2a243b; background:#1a1626; }
  .impact { color:#ffd9e9; }
  .wcag { color:#d8eafe; }
  .issue.violations { border-color: #3a2030; }
  .issue.incomplete { border-color: #3a2b1f; }
  .issue.inapplicable { border-color: #1f2f2f; }
  details { background:#100d18; border:1px solid #241f33; border-radius:10px; padding:8px 10px; }
  summary { cursor:pointer; color:var(--violet); }
  .nodes { margin:8px 0 0 18px; }
  code { background:#100d18; color:#eae4ff; padding:1px 4px; border-radius:6px; overflow-wrap:anywhere; }
  .none { color:var(--muted); }
  footer { color:var(--muted); font-size:12px; padding:24px; border-top:1px solid #241f33; margin-top:32px; }
</style>
</head>
<body>
<header>
  <h1>Accessibility Report</h1>
  <div class="meta">Base: ${esc(data.url)} • Generated: ${esc(data.timestamp)} • Runner ${esc(data.versions.runner)} • axe-core ${esc(data.versions.axeCore)} • @axe-core/playwright ${esc(data.versions.axePlaywright)} • Playwright ${esc(data.versions.playwright)}</div>
  <div class="summary">
    <div class="card"><h2>WCAG Violations</h2><div class="num" style="color:var(--bad)">${counts.violations}</div></div>
    <div class="card"><h2>Best-practice findings</h2><div class="num">${counts.bestPractices}</div></div>
    <div class="card"><h2>Incomplete</h2><div class="num" style="color:var(--warn)">${counts.incomplete}</div></div>
    <div class="card"><h2>Inapplicable</h2><div class="num">${counts.inapplicable}</div></div>
    <div class="card"><h2>Passes</h2><div class="num" style="color:var(--ok)">${counts.passes}</div></div>
  </div>
</header>
<main>
  <section class="configurations" aria-labelledby="configurations-heading">
    <h2 id="configurations-heading">Tested configurations (${data.configurations.length})</h2>
    <ul>${configurationList}</ul>
  </section>
  ${section('WCAG Violations', data.violations, 'violations')}
  ${section('Best-practice Findings', data.bestPractices, 'best-practices')}
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
