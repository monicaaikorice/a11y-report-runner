#!/usr/bin/env node
/**
 * CLI entry point: resolve the configured route/environment matrix, scan it with
 * Chromium and axe, then write one JSON and one static HTML report per run.
 * Scans are sequential and findings remain grouped by category, with each result
 * annotated so an aggregate report still identifies the environment that found it.
 * Findings do not change the exit status; invalid configuration or execution
 * and output errors do.
 */
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

/**
 * Find a package's own manifest rather than relying on its resolved entry point
 * being adjacent to package.json (which is not guaranteed by package exports).
 * @param {string} packageName Installed package name resolvable from this CLI.
 * @returns {string} Installed package version.
 * @throws {Error} If the package entry point or its manifest cannot be resolved.
 */
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

/** Run all configured scans, closing browser resources even when navigation or axe fails. */
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

  // Keep environment combinations isolated while aggregating routes into one reproducible run.
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
            // Preserve provenance after aggregation so findings remain attributable to their tested environment.
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
    // Exclusive file creation is a second safeguard against replacing any report unexpectedly.
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

/**
 * Render the aggregated result as a self-contained document; inline CSS and
 * native disclosure elements keep the report useful without JavaScript.
 * Dynamic content is escaped before insertion because report data comes from
 * the audited page as well as the runner's configuration.
 * @param {object} data Consolidated scan metadata and axe result categories.
 * @returns {string} Complete HTML document for the run.
 */
function buildHtml(data) {
  const counts = {
    violations: data.violations.length,
    bestPractices: data.bestPractices.length,
    incomplete: data.incomplete.length,
    inapplicable: data.inapplicable.length,
    passes: data.passes.length
  }
  const configurationList = data.configurations.map(configuration =>
    `<li><code>${esc(configuration.id)}</code> — route ${configuration.routeIndex + 1}: ${esc(configuration.route)} · ${esc(configuration.url)} · ${esc(configuration.viewport.name)} (${configuration.viewport.width}×${configuration.viewport.height}) · ${esc(configuration.colorScheme)}</li>`
  ).join('\n    ')
  const configurationLabel = item => {
    const viewport = item.viewport || {}
    return `${item.configurationId || 'unknown'} · route ${(item.routeIndex ?? 0) + 1}: ${item.route || item.url || data.url} · ${viewport.name || 'viewport'} (${viewport.width || '?'}×${viewport.height || '?'}) · ${item.colorScheme || 'scheme'}`
  }
  const failureDetails = node => {
    if (!node.failureSummary) return ''
    const groups = [
      { introduction: 'Fix any of the following:', checks: node.any || [] },
      { introduction: 'Fix all of the following:', checks: [...(node.none || []), ...(node.all || [])] }
    ].filter(group => group.checks.length)
    const conditionCount = groups.reduce((count, group) => count + group.checks.length, 0)
    const hasCompleteMessages = groups.every(group => group.checks.every(check => typeof check.message === 'string' && check.message.length))

    // axe exposes these groups separately; use them instead of splitting localized prose on newlines.
    if (conditionCount < 2 || !hasCompleteMessages) {
      return `<div class="fail">${esc(node.failureSummary)}</div>`
    }

    // Keep template indentation out of this pre-wrapped container; otherwise whitespace becomes blank lines.
    return `<div class="fail">${groups.map(group => `<p class="failure-intro">${esc(group.introduction)}</p><ul class="failure-conditions">${group.checks.map(check => `<li>${esc(check.message)}</li>`).join('')}</ul>`).join('')}</div>`
  }
  const issueList = (items, kind) => {
    if (!items.length) return '<p class="none">None</p>'
    return `<ul class="issues">
    ${items.map(v => {
      const nodeDetails = Array.isArray(v.nodes) && v.nodes.length ? `
          <details>
            <summary>Nodes (${v.nodes.length})</summary>
            <ol class="nodes">
              ${v.nodes.map(n => `
                <li>
                  <div class="target"><code>${esc((n.target||[]).join(' '))}</code></div>
                  ${failureDetails(n)}
                </li>
              `.trim()).join('\n              ')}
            </ol>
          </details>` : ''
      return `
      <li class="issue ${kind}">
        <div class="head">
          <h3 class="id">${esc(v.id)}</h3>
          <div class="meta">
            ${badge(v.impact || 'n/a', 'impact')}
            ${badge((v.tags||[]).filter(t=>t.startsWith('wcag')).join(', ') || 'wcag-n/a','wcag')}
            <span class="url">${esc(v.url || data.url)}</span>
          </div>
        </div>
        <p class="configuration">Configuration: ${esc(configurationLabel(v))}</p>
        <div class="help">${esc(v.help || '')}</div>
        ${nodeDetails ? nodeDetails + '\n        ' : ''}</li>
    `.trim()
    }).join('\n    ')}
  </ul>`
  }
  const section = (title, items, kind) => `
<section>
  <h2>${esc(title)} (${items.length})</h2>
  ${issueList(items, kind)}
</section>`
  const collapsedSection = (title, items, kind) => `
<details class="secondary-results ${kind}">
  <summary>${esc(title)} (${items.length})</summary>
  ${issueList(items, kind)}
</details>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>A11y Report – ${esc(new URL(data.url).host)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { --bg:#0e0b14; --panel:#14111c; --text:#e6e1f4; --muted:#a7a0bd; --pink:#ff59b9; --cyan:#60e2ff; --violet:#b79cff; --bad:#ff6b6b; --warn:#ffb020; --ok:#34d399; }
  body { margin:0; background:var(--bg); color:var(--text); font: 1rem/1.6 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial; }
  /* One-pixel borders stay crisp; the three-pixel focus outline remains prominent. */
  header { padding:1.5rem; border-bottom:1px solid #241f33; background:linear-gradient(180deg, rgba(255,89,185,.08), transparent 60%); }
  header h1 { margin:0 0 .375rem; font-size:1.75rem; line-height:1.2; overflow-wrap:anywhere; }
  header .meta { color:var(--muted); font-size:.875rem; line-height:1.5; overflow-wrap:anywhere; }
  main { padding:1.5rem; max-width:68.75rem; margin:0 auto; }
  .summary { display:flex; gap:.75rem; flex-wrap:wrap; margin:1rem 0 1.75rem; }
  .card { background:var(--panel); border:1px solid #241f33; border-radius:.75rem; padding:.75rem .875rem; flex:1 1 10rem; min-width:0; }
  .card-label { margin:0 0 .25rem; font-size:.875rem; font-weight:600; line-height:1.5; color:var(--muted); overflow-wrap:anywhere; }
  .card .num { font-size:1.25rem; line-height:1.2; font-weight:700; }
  section { margin:1.5rem 0; }
  h2 { font-size:1.375rem; line-height:1.3; margin:0 0 .75rem; overflow-wrap:anywhere; }
  .configurations { overflow-wrap:anywhere; }
  .configurations ul { padding-left:1.5rem; }
  .issues { list-style:none; padding:0; margin:0; display:grid; gap:.75rem; }
  .issue { min-width:0; background:var(--panel); border:1px solid #241f33; border-radius:.75rem; padding:.75rem; }
  .issue .head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:.75rem; align-items:baseline; }
  .issue .id { margin:0; font-size:1.125rem; line-height:1.3; font-weight:700; overflow-wrap:anywhere; }
  .issue .meta { min-width:0; }
  .issue .configuration { color:var(--muted); font-size:1rem; line-height:1.5; overflow-wrap:anywhere; margin:.375rem 0; }
  .issue .help { color:var(--muted); margin:.375rem 0 .5rem; overflow-wrap:anywhere; }
  .issue .url { color:var(--cyan); font-size:1rem; line-height:1.5; overflow-wrap:anywhere; }
  .badge { display:inline-block; padding:.125rem .375rem; border-radius:999px; font-size:.875rem; line-height:1.5; margin-right:.375rem; border:1px solid #2a243b; background:#1a1626; overflow-wrap:anywhere; }
  .impact { color:#ffd9e9; }
  .wcag { color:#d8eafe; }
  .issue.violations { border-color: #3a2030; }
  .issue.incomplete { border-color: #3a2b1f; }
  .issue.inapplicable { border-color: #1f2f2f; }
  details { background:#100d18; border:1px solid #241f33; border-radius:.625rem; padding:.5rem .625rem; }
  summary { cursor:pointer; color:var(--violet); font-weight:600; line-height:1.5; min-height:2.75rem; box-sizing:border-box; padding:.5rem 0; overflow-wrap:anywhere; }
  summary:focus-visible { outline:3px solid var(--cyan); outline-offset:3px; border-radius:.1875rem; }
  .secondary-results { margin:1.5rem 0; }
  .secondary-results > summary { font-size:1.25rem; line-height:1.3; }
  .nodes { margin:.5rem 0 0; padding-inline-start:1rem; }
  code { background:#100d18; color:#eae4ff; padding:.0625rem .25rem; border-radius:.375rem; overflow-wrap:anywhere; }
  .fail { white-space:pre-wrap; overflow-wrap:anywhere; }
  .failure-intro { margin:.5rem 0 .25rem; }
  .failure-conditions { margin:.25rem 0 .5rem; padding-inline-start:1.5rem; }
  .failure-conditions li { overflow-wrap:anywhere; }
  .none { color:var(--muted); }
  footer { color:var(--muted); font-size:.875rem; line-height:1.5; padding:1.5rem; border-top:1px solid #241f33; margin-top:2rem; }
</style>
</head>
<body>
<header>
  <h1>Accessibility Report</h1>
  <div class="meta">Base: ${esc(data.url)} • Generated: ${esc(data.timestamp)} • Runner ${esc(data.versions.runner)} • axe-core ${esc(data.versions.axeCore)} • @axe-core/playwright ${esc(data.versions.axePlaywright)} • Playwright ${esc(data.versions.playwright)}</div>
  <div class="summary">
    <div class="card"><p class="card-label">WCAG Violations</p><div class="num" style="color:var(--bad)">${counts.violations}</div></div>
    <div class="card"><p class="card-label">Incomplete checks</p><div class="num" style="color:var(--warn)">${counts.incomplete}</div></div>
    <div class="card"><p class="card-label">Best-practice findings</p><div class="num">${counts.bestPractices}</div></div>
    <div class="card"><p class="card-label">Passed checks</p><div class="num" style="color:var(--ok)">${counts.passes}</div></div>
    <div class="card"><p class="card-label">Inapplicable rules</p><div class="num">${counts.inapplicable}</div></div>
  </div>
</header>
<main>
  <section class="configurations" aria-labelledby="configurations-heading">
    <h2 id="configurations-heading">Tested configurations (${data.configurations.length})</h2>
    <ul>${configurationList}</ul>
  </section>
  ${section('WCAG Violations', data.violations, 'violations')}
  ${section('Incomplete', data.incomplete, 'incomplete')}
  ${section('Best-practice Findings', data.bestPractices, 'best-practices')}
  ${collapsedSection('Passed axe checks', data.passes, 'passes')}
  ${collapsedSection('Inapplicable axe rules', data.inapplicable, 'inapplicable')}
</main>
<footer>
  Generated with Playwright + axe-core. This HTML was handcrafted so you always get a human-friendly report.
</footer>
</body>
</html>`
  // Template indentation creates whitespace-only lines; remove their spaces so checked-in reports stay diff-clean.
  return html.replace(/^[ \t]+$/gm, '')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
