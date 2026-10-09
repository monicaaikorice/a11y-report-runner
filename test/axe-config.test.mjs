import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { AXE_RUN_TAGS, getAxeRunOptions, isBestPracticeOnly } from '../scripts/axe-config.mjs'
import { buildConfigurations, parseColorSchemes, parseViewports } from '../scripts/run-config.mjs'

const repoRoot = new URL('../', import.meta.url).pathname
const wcagTags = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

test('keeps the cumulative WCAG 2.2 A/AA and best-practice axe configuration', () => {
  assert.deepEqual(AXE_RUN_TAGS, [
    'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'
  ])
  assert.deepEqual(getAxeRunOptions(), {
    runOnly: { type: 'tag', values: [...AXE_RUN_TAGS] },
    rules: { 'target-size': { enabled: true } }
  })
})

test('parses defaults, validates environment lists, and creates deterministic matrix IDs', () => {
  assert.deepEqual(parseViewports(undefined), [{ name: 'default', width: 1280, height: 720 }])
  assert.deepEqual(parseViewports('mobile=390x844, desktop=1440x900'), [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 900 }
  ])
  assert.deepEqual(parseColorSchemes(undefined), ['light'])
  assert.deepEqual(parseColorSchemes('light,dark'), ['light', 'dark'])
  assert.throws(() => parseViewports('mobile=390x844,mobile=320x700'), /Duplicate A11Y_VIEWPORTS name/)
  assert.throws(() => parseViewports('mobile=0x700'), /positive/)
  assert.throws(() => parseViewports('mobile=390x844,broken'), /Invalid A11Y_VIEWPORTS entry/)
  assert.throws(() => parseColorSchemes('light,dark,light'), /Duplicate A11Y_COLOR_SCHEMES/)
  assert.throws(() => parseColorSchemes('auto'), /Invalid A11Y_COLOR_SCHEMES/)

  const routes = ['/', '/other']
  const viewports = parseViewports('mobile=390x844,desktop=1440x900')
  const schemes = parseColorSchemes('light,dark')
  const matrix = buildConfigurations(routes, 'http://127.0.0.1:4321', viewports, schemes)
  assert.equal(matrix.length, routes.length * viewports.length * schemes.length)
  assert.equal(new Set(matrix.map(configuration => configuration.id)).size, matrix.length)
  assert.equal(matrix[0].url, 'http://127.0.0.1:4321/')
  assert.equal(matrix[0].viewport.name, 'mobile')
  assert.equal(matrix[0].colorScheme, 'light')
  assert.deepEqual(buildConfigurations(routes, 'http://127.0.0.1:4321', viewports, schemes), matrix)
  const repeatedRouteConfigurations = buildConfigurations(['/', '/'], 'http://127.0.0.1:4321', [viewports[0]], ['light'])
  assert.equal(new Set(repeatedRouteConfigurations.map(configuration => configuration.id)).size, 2)
})

function runCli(env) {
  const childEnv = { ...process.env }
  delete childEnv.A11Y_VIEWPORTS
  delete childEnv.A11Y_COLOR_SCHEMES
  Object.assign(childEnv, env)
  const child = spawn(process.execPath, ['scripts/a11y-report.mjs'], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  return once(child, 'close').then(([status]) => ({ status, stdout, stderr }))
}

test('CLI scans defaults and the viewport/scheme product without overwriting reports', async t => {
  const fixture = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Generic axe configuration fixture</title>
  <style>
    .tiny-target { display: block; width: 10px; height: 10px; padding: 0; border: 0; }
    .uncertain-contrast { color: #777; background: linear-gradient(90deg, #fff, #000); }
  </style>
</head>
<body>
  <main>
    <h1>Fixture</h1>
    <button class="tiny-target"></button><button class="tiny-target"></button>
    <p class="uncertain-contrast">Contrast needs review.</p>
  </main>
  <p>Content outside a landmark.</p>
</body>
</html>`
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(fixture)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const outputParent = await mkdtemp(join(tmpdir(), 'a11y-report-runner-output-'))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(outputParent, { recursive: true, force: true })
  })
  const address = server.address()
  const baseEnv = {
    A11Y_BASE: `http://127.0.0.1:${address.port}`,
    A11Y_OUT: outputParent
  }

  const defaultRun = await runCli({ ...baseEnv, A11Y_ROUTES: '/' })
  assert.equal(defaultRun.status, 0, `${defaultRun.stdout}\n${defaultRun.stderr}`)
  const firstDirectory = (await readdir(outputParent))[0]
  const firstPath = join(outputParent, firstDirectory)
  const firstJsonPath = join(firstPath, 'axe-results.json')
  const firstHtmlPath = join(firstPath, 'axe-report.html')
  const defaultJsonBytes = await readFile(firstJsonPath)
  const defaultHtmlBytes = await readFile(firstHtmlPath)
  const defaultJson = JSON.parse(defaultJsonBytes)
  assert.equal(defaultJson.configurations.length, 1)
  assert.deepEqual(defaultJson.configurations[0].viewport, { name: 'default', width: 1280, height: 720 })
  assert.equal(defaultJson.configurations[0].colorScheme, 'light')
  assert.match(defaultRun.stdout, /JSON report:/)
  assert.match(defaultRun.stdout, /HTML report:/)
  assert.equal(defaultJson.versions.axeCore, '4.13.0')
  assert.equal(defaultJson.versions.axePlaywright, '4.13.0')
  assert.equal(defaultJson.versions.playwright, '1.63.0')

  const matrixRun = await runCli({
    ...baseEnv,
    A11Y_ROUTES: '/,/other',
    A11Y_VIEWPORTS: 'mobile=390x844,desktop=1440x900',
    A11Y_COLOR_SCHEMES: 'light,dark'
  })
  assert.equal(matrixRun.status, 0, `${matrixRun.stdout}\n${matrixRun.stderr}`)
  const directories = await readdir(outputParent)
  assert.equal(directories.length, 2)
  assert.deepEqual(await readFile(firstJsonPath), defaultJsonBytes)
  assert.deepEqual(await readFile(firstHtmlPath), defaultHtmlBytes)
  const matrixDirectory = directories.find(directory => directory !== firstDirectory)
  const matrixPath = join(outputParent, matrixDirectory)
  const json = JSON.parse(await readFile(join(matrixPath, 'axe-results.json'), 'utf8'))
  const html = await readFile(join(matrixPath, 'axe-report.html'), 'utf8')
  assert.equal(json.configurations.length, 8)
  assert.equal(new Set(json.configurations.map(configuration => configuration.id)).size, 8)
  assert.equal(new Set(json.configurations.map(configuration => configuration.colorScheme)).size, 2)
  assert.equal(new Set(json.configurations.map(configuration => configuration.viewport.name)).size, 2)
  assert.ok(json.configurations.every(configuration => configuration.url && configuration.route))
  assert.ok(json.violations.some(rule => rule.id === 'button-name'))
  assert.ok(json.violations.some(rule => rule.id === 'target-size'))
  assert.ok(json.bestPractices.some(rule => rule.id === 'region'))
  assert.ok(json.passes.some(rule => rule.id === 'html-has-lang'))
  assert.ok(json.incomplete.length > 0)
  assert.ok(json.inapplicable.length > 0)

  const allResults = ['violations', 'bestPractices', 'passes', 'incomplete', 'inapplicable']
    .flatMap(key => json[key])
  assert.ok(allResults.every(result => result.configurationId && result.route && result.url))
  assert.ok(json.violations.every(rule => rule.tags.some(tag => wcagTags.has(tag))))
  assert.ok(json.bestPractices.every(rule => isBestPracticeOnly(rule)))
  assert.equal(new Set(allResults.map(rule => `${rule.configurationId}:${rule.id}`)).size, 8 * 90)
  assert.ok(allResults.every(rule => !rule.tags.includes('experimental')))
  assert.ok(!allResults.some(rule => rule.id === 'color-contrast-enhanced'))
  assert.match(html, /Tested configurations \(8\)/)
  assert.match(html, /Configuration: cfg-/)
  assert.match(html, /Best-practice Findings \(/)
  assert.doesNotMatch(html, /<script\b/i)

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    try {
      const page = await context.newPage()
      await page.goto(pathToFileURL(join(matrixPath, 'axe-report.html')).href)
      const reportResults = await new AxeBuilder({ page }).options(getAxeRunOptions()).analyze()
      assert.deepEqual(reportResults.violations.map(rule => rule.id), [])
      assert.deepEqual(reportResults.violations.filter(isBestPracticeOnly).map(rule => rule.id), [])
      const disclosure = page.locator('summary').first()
      await page.keyboard.press('Tab')
      assert.equal(await disclosure.evaluate(element => element === document.activeElement), true)
      assert.equal(await disclosure.evaluate(element => element.matches(':focus-visible')), true)
      assert.notEqual(await disclosure.evaluate(element => getComputedStyle(element).outlineStyle), 'none')
      await page.keyboard.press('Space')
      assert.equal(await disclosure.locator('xpath=..').evaluate(element => element.open), true)

      await page.setViewportSize({ width: 320, height: 800 })
      const widths = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(widths.content <= widths.viewport, `Generated report overflows at 320px: ${JSON.stringify(widths)}`)
    } finally {
      await context.close()
    }
  } finally {
    await browser.close()
  }
})

test('invalid CLI configuration exits before creating report output', async t => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'a11y-report-runner-invalid-'))
  const outputParent = join(tempRoot, 'reports')
  t.after(async () => rm(tempRoot, { recursive: true, force: true }))
  const duplicateViewport = await runCli({ A11Y_OUT: outputParent, A11Y_VIEWPORTS: 'mobile=390x844,mobile=320x700' })
  assert.equal(duplicateViewport.status, 1)
  assert.match(duplicateViewport.stderr, /Duplicate A11Y_VIEWPORTS name/)
  await assert.rejects(stat(outputParent), { code: 'ENOENT' })

  const badScheme = await runCli({ A11Y_OUT: outputParent, A11Y_COLOR_SCHEMES: 'auto' })
  assert.equal(badScheme.status, 1)
  assert.match(badScheme.stderr, /Invalid A11Y_COLOR_SCHEMES/)
  await assert.rejects(stat(outputParent), { code: 'ENOENT' })
})
