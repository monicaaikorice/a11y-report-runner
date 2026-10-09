import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { AXE_RUN_TAGS, getAxeRunOptions } from '../scripts/axe-config.mjs'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const wcagTags = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])

test('selects the cumulative WCAG 2.2 A/AA tags, best practices, and target-size', () => {
  assert.deepEqual(AXE_RUN_TAGS, [
    'wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'
  ])
  assert.deepEqual(getAxeRunOptions(), {
    runOnly: { type: 'tag', values: [...AXE_RUN_TAGS] },
    rules: { 'target-size': { enabled: true } }
  })
})

test('CLI separates WCAG and best-practice findings and preserves report categories', async t => {
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

  const outputDir = await mkdtemp(join(tmpdir(), 'a11y-report-runner-test-'))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(outputDir, { recursive: true, force: true })
  })

  const address = server.address()
  const scan = spawn(process.execPath, ['scripts/a11y-report.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      A11Y_BASE: `http://127.0.0.1:${address.port}`,
      A11Y_ROUTES: '/',
      A11Y_OUT: outputDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  scan.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  scan.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const [status] = await once(scan, 'close')

  assert.equal(status, 0, `${stdout}\n${stderr}`)

  const json = JSON.parse(await readFile(join(outputDir, 'axe-results.json'), 'utf8'))
  const html = await readFile(join(outputDir, 'axe-report.html'), 'utf8')
  for (const key of ['violations', 'bestPractices', 'passes', 'incomplete', 'inapplicable']) {
    assert.ok(Array.isArray(json[key]), `${key} should be an array`)
  }

  const allResults = ['violations', 'bestPractices', 'passes', 'incomplete', 'inapplicable']
    .flatMap(key => json[key])
  assert.ok(json.violations.some(rule => rule.id === 'button-name'))
  assert.ok(json.violations.some(rule => rule.id === 'target-size'))
  assert.ok(json.bestPractices.some(rule => rule.id === 'region'))
  assert.ok(json.passes.some(rule => rule.id === 'html-has-lang'))
  assert.ok(json.incomplete.length > 0)
  assert.ok(json.inapplicable.length > 0)

  assert.ok(json.violations.every(rule => rule.tags.some(tag => wcagTags.has(tag))))
  assert.ok(json.bestPractices.every(rule =>
    rule.tags.includes('best-practice') && !rule.tags.some(tag => wcagTags.has(tag))
  ))

  assert.equal(new Set(allResults.map(rule => rule.id)).size, 90)
  assert.ok(allResults.every(rule => !rule.tags.includes('experimental')))
  assert.ok(!allResults.some(rule => rule.id === 'color-contrast-enhanced'))
  assert.match(html, /WCAG Violations \(/)
  assert.match(html, /Best-practice Findings \(/)
  assert.match(html, /Incomplete \(/)
})
