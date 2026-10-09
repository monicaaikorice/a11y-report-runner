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
import { buildConfigurations, parseColorSchemes, parseRoutes, parseViewports } from '../scripts/run-config.mjs'

const repoRoot = new URL('../', import.meta.url).pathname
const wcagTags = new Set(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]))

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
  assert.deepEqual(parseRoutes(undefined), ['/'])
  assert.deepEqual(parseRoutes('/about, /work ,https://example.invalid/status'), ['/about', '/work', 'https://example.invalid/status'])
  assert.throws(() => parseRoutes(' /, , /about '), /empty route entries/)
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
  delete childEnv.A11Y_ROUTES
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
  const longRoute = `/${'long-route-segment-'.repeat(18)}`
  const longSelectorId = `long-target-${'x'.repeat(180)}`
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
    <button id="${longSelectorId}" class="tiny-target"></button><button class="tiny-target"></button>
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

  const defaultRun = await runCli(baseEnv)
  assert.equal(defaultRun.status, 0, `${defaultRun.stdout}\n${defaultRun.stderr}`)
  const firstDirectory = (await readdir(outputParent))[0]
  const firstPath = join(outputParent, firstDirectory)
  const firstJsonPath = join(firstPath, 'axe-results.json')
  const firstHtmlPath = join(firstPath, 'axe-report.html')
  const defaultJsonBytes = await readFile(firstJsonPath)
  const defaultHtmlBytes = await readFile(firstHtmlPath)
  const defaultJson = JSON.parse(defaultJsonBytes)
  assert.equal(defaultJson.configurations.length, 1)
  assert.equal(defaultJson.configurations[0].route, '/')
  assert.equal(defaultJson.configurations[0].url, `${baseEnv.A11Y_BASE}/`)
  assert.deepEqual(defaultJson.configurations[0].viewport, { name: 'default', width: 1280, height: 720 })
  assert.equal(defaultJson.configurations[0].colorScheme, 'light')
  assert.match(defaultRun.stdout, /JSON report:/)
  assert.match(defaultRun.stdout, /HTML report:/)
  assert.equal(defaultJson.versions.axeCore, '4.13.0')
  assert.equal(defaultJson.versions.axePlaywright, '4.13.0')
  assert.equal(defaultJson.versions.playwright, '1.63.0')

  const matrixRun = await runCli({
    ...baseEnv,
    A11Y_ROUTES: ` / , /other , ${longRoute} `,
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
  assert.equal(json.configurations.length, 12)
  assert.deepEqual(new Set(json.configurations.map(configuration => configuration.route)), new Set(['/', '/other', longRoute]))
  assert.equal(new Set(json.configurations.map(configuration => configuration.id)).size, 12)
  assert.equal(new Set(json.configurations.map(configuration => configuration.colorScheme)).size, 2)
  assert.equal(new Set(json.configurations.map(configuration => configuration.viewport.name)).size, 2)
  assert.ok(json.configurations.every(configuration => configuration.url && configuration.route))
  assert.ok(json.violations.some(rule => rule.id === 'button-name'))
  assert.ok(json.violations.some(rule => rule.id === 'target-size'))
  assert.ok(json.bestPractices.some(rule => rule.id === 'region'))
  assert.ok(json.passes.some(rule => rule.id === 'html-has-lang'))
  assert.ok(json.incomplete.length > 0)
  assert.ok(json.inapplicable.length > 0)
  assert.ok(json.inapplicable.length >= 200, `Expected hundreds of inapplicable results, got ${json.inapplicable.length}`)

  const allResults = ['violations', 'bestPractices', 'passes', 'incomplete', 'inapplicable']
    .flatMap(key => json[key])
  assert.ok(allResults.every(result => result.configurationId && result.route && result.url))
  assert.ok(json.violations.every(rule => rule.tags.some(tag => wcagTags.has(tag))))
  assert.ok(json.bestPractices.every(rule => isBestPracticeOnly(rule)))
  assert.equal(new Set(allResults.map(rule => `${rule.configurationId}:${rule.id}`)).size, 12 * 90)
  assert.ok(allResults.every(rule => !rule.tags.includes('experimental')))
  assert.ok(!allResults.some(rule => rule.id === 'color-contrast-enhanced'))
  assert.match(html, /Tested configurations \(12\)/)
  assert.match(html, /Configuration: cfg-/)
  assert.match(html, /Best-practice Findings \(/)
  assert.match(html, /<h3 class="id">button-name<\/h3>/)
  assert.doesNotMatch(html, /<div class="id">/)
  assert.match(html, /<details class="secondary-results passes">\s*<summary>Passed axe checks \(\d+\)<\/summary>/)
  assert.match(html, /<details class="secondary-results inapplicable">\s*<summary>Inapplicable axe rules \(\d+\)<\/summary>/)
  assert.doesNotMatch(html, /<details class="secondary-results [^"]+" open>/)
  assert.equal([...html.matchAll(/<li class="issue /g)].length, allResults.length)
  assert.equal([...html.matchAll(/<li class="issue inapplicable"/g)].length, json.inapplicable.length)
  assert.equal([...html.matchAll(/<li class="issue passes"/g)].length, json.passes.length)
  assert.match(html, /moderate/)
  assert.match(html, /wcag2a|wcag21aa/)
  assert.match(html, /mobile \(390×844\) · light/)
  assert.match(html, /desktop \(1440×900\) · dark/)
  assert.match(html, /All page content should be contained by landmarks/)
  assert.ok(html.includes(longRoute), 'Long route remains present in report metadata')
  assert.ok(html.includes(longSelectorId), 'Long code selector remains present in affected-node details')
  const buttonNameRule = json.violations.find(rule => rule.id === 'button-name')
  assert.ok(buttonNameRule.nodes.some(node => node.target.join(' ').includes(longSelectorId)))
  const categoryOrder = ['WCAG Violations', 'Incomplete', 'Best-practice Findings'].map(title =>
    html.indexOf(`<h2>${title} (`)
  )
  assert.ok(categoryOrder.every(index => index >= 0))
  assert.deepEqual(categoryOrder, [...categoryOrder].sort((left, right) => left - right))
  const allNodes = allResults.flatMap(result => result.nodes || [])
  assert.equal([...html.matchAll(/class="target"/g)].length, allNodes.length)
  const failureSummaries = allNodes.map(node => node.failureSummary).filter(Boolean)
  assert.ok(failureSummaries.length > 0)
  const nodesWithMultipleFailureConditions = allNodes.filter(node =>
    node.failureSummary && (node.any?.length || 0) + (node.all?.length || 0) + (node.none?.length || 0) > 1
  )
  assert.ok(nodesWithMultipleFailureConditions.length > 0)
  assert.match(html, /<p class="failure-intro">Fix any of the following:<\/p>/)
  assert.match(html, /<ul class="failure-conditions">\s*<li>/)
  assert.ok(nodesWithMultipleFailureConditions.every(node =>
    [...(node.any || []), ...(node.all || []), ...(node.none || [])]
      .every(check => html.includes(escapeHtml(check.message)))
  ), 'Structured axe failure conditions remain present in the report')
  const singleConditionNode = allNodes.find(node =>
    node.failureSummary && (node.any?.length || 0) + (node.all?.length || 0) + (node.none?.length || 0) === 1
  )
  if (singleConditionNode) assert.ok(html.includes(escapeHtml(singleConditionNode.failureSummary)))
  assert.match(html, /\.fail \{ white-space:pre-wrap; overflow-wrap:anywhere; \}/)
  assert.match(html, /\.failure-intro \{ margin:\.5rem 0 \.25rem; \}/)
  assert.doesNotMatch(html, /font-size:\s*\d+(?:\.\d+)?px/)
  assert.equal(/[ \t]+$/m.test(html), false, 'Generated HTML should not contain trailing whitespace')
  assert.doesNotMatch(html, /<script\b/i)

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true })
    try {
      const page = await context.newPage()
      await page.goto(pathToFileURL(join(matrixPath, 'axe-report.html')).href)
      const reportResults = await new AxeBuilder({ page }).options(getAxeRunOptions()).analyze()
      assert.deepEqual(reportResults.violations.map(rule => rule.id), [])
      assert.deepEqual(reportResults.violations.filter(isBestPracticeOnly).map(rule => rule.id), [])
      const headings = await page.locator('h1, h2, h3').evaluateAll(elements =>
        elements.map(element => ({ level: Number(element.tagName[1]), text: element.textContent.trim() }))
      )
      assert.equal(headings.filter(heading => heading.level === 1).length, 1)
      assert.ok(headings.some(heading => heading.level === 2 && heading.text.startsWith('WCAG Violations')))
      assert.ok(headings.some(heading => heading.level === 3 && heading.text === 'button-name'))
      assert.equal(await page.locator('.summary h2').count(), 0)

      const buttonNameRule = json.violations.find(rule => rule.id === 'button-name')
      const buttonNameNode = buttonNameRule.nodes.find(node => node.target.join(' ').includes(longSelectorId))
      const failureGroups = [
        { introduction: 'Fix any of the following:', checks: buttonNameNode.any },
        { introduction: 'Fix all of the following:', checks: [...buttonNameNode.none, ...buttonNameNode.all] }
      ].filter(group => group.checks.length)
      assert.ok(failureGroups.some(group => group.checks.length > 1), 'Fixture should include axe alternative failure conditions')
      const buttonNameIssue = page.locator('.issue.violations').filter({
        has: page.locator('h3.id').filter({ hasText: /^button-name$/ })
      }).first()
      await buttonNameIssue.locator('details').first().evaluate(element => { element.open = true })
      const affectedNode = buttonNameIssue.locator('.nodes > li').filter({ hasText: longSelectorId }).first()
      const failureConditionLists = affectedNode.locator('ul.failure-conditions')
      assert.equal(await failureConditionLists.count(), failureGroups.length)
      for (const [index, group] of failureGroups.entries()) {
        const failureList = failureConditionLists.nth(index)
        assert.equal((await failureList.locator('xpath=preceding-sibling::p[1]').textContent()).trim(), group.introduction)
        assert.deepEqual(await failureList.locator('li').allTextContents(), group.checks.map(check => check.message))
      }
      const listStyles = await failureConditionLists.first().evaluate(element => ({
        display: getComputedStyle(element).display,
        listStyleType: getComputedStyle(element).listStyleType,
        role: element.getAttribute('role'),
        itemDisplay: getComputedStyle(element.querySelector('li')).display,
        itemRole: element.querySelector('li').getAttribute('role')
      }))
      assert.equal(listStyles.display, 'block')
      assert.notEqual(listStyles.listStyleType, 'none')
      assert.equal(listStyles.role, null)
      assert.equal(listStyles.itemDisplay, 'list-item')
      assert.equal(listStyles.itemRole, null)
      const failureListAccessibilityTree = await failureConditionLists.first().ariaSnapshot()
      assert.match(failureListAccessibilityTree, /- list:/)
      assert.match(failureListAccessibilityTree, /- listitem: Element does not have inner text/)
      const failureSpacing = await affectedNode.evaluate(element => {
        const target = element.querySelector('.target').getBoundingClientRect()
        const failure = element.querySelector('.fail')
        const introduction = failure.querySelector('.failure-intro').getBoundingClientRect()
        const list = failure.querySelector('.failure-conditions').getBoundingClientRect()
        return {
          targetToIntroduction: introduction.top - target.bottom,
          introductionToList: list.top - introduction.bottom,
          blankTextNodes: [...failure.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && !node.textContent.trim()).length
        }
      })
      assert.equal(failureSpacing.blankTextNodes, 0, 'Pre-wrapped failure content should not contain template-indentation text nodes')
      assert.ok(failureSpacing.targetToIntroduction <= 16, `Unexpected gap before failure introduction: ${JSON.stringify(failureSpacing)}`)
      assert.ok(failureSpacing.introductionToList <= 8, `Unexpected gap before failure list: ${JSON.stringify(failureSpacing)}`)
      await buttonNameIssue.locator('details').first().evaluate(element => { element.open = false })

      const secondarySections = page.locator('details.secondary-results')
      assert.equal(await secondarySections.count(), 2)
      const passesDetails = page.locator('details.secondary-results.passes')
      const passesSummary = passesDetails.locator(':scope > summary')
      const inapplicableDetails = page.locator('details.secondary-results.inapplicable')
      const inapplicableSummary = page.locator('details.secondary-results.inapplicable > summary')
      assert.equal(await passesDetails.evaluate(element => element.open), false)
      assert.equal(await inapplicableDetails.evaluate(element => element.open), false)
      assert.equal(await passesSummary.textContent(), `Passed axe checks (${json.passes.length})`)
      assert.equal(await inapplicableSummary.textContent(), `Inapplicable axe rules (${json.inapplicable.length})`)
      assert.ok(await passesSummary.evaluate(element => element.getBoundingClientRect().height >= 44))
      const reportAccessibilityTree = await page.locator('body').ariaSnapshot()
      assert.match(reportAccessibilityTree, /group: Passed axe checks \(\d+\)/)
      assert.match(reportAccessibilityTree, /group: Inapplicable axe rules \(\d+\)/)

      const disclosure = page.locator('summary').first()
      await page.keyboard.press('Tab')
      assert.equal(await disclosure.evaluate(element => element === document.activeElement), true)
      assert.equal(await disclosure.evaluate(element => element.matches(':focus-visible')), true)
      assert.notEqual(await disclosure.evaluate(element => getComputedStyle(element).outlineStyle), 'none')
      await page.keyboard.press('Space')
      assert.equal(await disclosure.locator('xpath=..').evaluate(element => element.open), true)

      await passesSummary.evaluate(element => element.focus({ focusVisible: true }))
      assert.equal(await passesSummary.evaluate(element => element.matches(':focus-visible')), true)
      assert.notEqual(await passesSummary.evaluate(element => getComputedStyle(element).outlineStyle), 'none')
      await page.keyboard.press('Space')
      assert.equal(await passesDetails.evaluate(element => element.open), true)
      await page.keyboard.press('Space')
      assert.equal(await passesDetails.evaluate(element => element.open), false)
      await passesSummary.tap()
      assert.equal(await passesDetails.evaluate(element => element.open), true)
      await passesSummary.tap()
      assert.equal(await passesDetails.evaluate(element => element.open), false)

      await disclosure.press('Space')
      assert.equal(await disclosure.locator('xpath=..').evaluate(element => element.open), false)

      for (const width of [320, 375, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 900 })
        const layout = await page.evaluate(() => ({
          viewport: innerWidth,
          content: document.documentElement.scrollWidth,
          cards: [...document.querySelectorAll('.summary .card')].map(card => card.getBoundingClientRect().top)
        }))
        assert.equal(layout.content, layout.viewport, `Generated report overflows at ${width}px: ${JSON.stringify(layout)}`)
        assert.equal(layout.cards.length, 5)
        if (width <= 375) {
          assert.ok(new Set(layout.cards.map(Math.round)).size > 1, `Summary cards should wrap at ${width}px`)
        }
        if (width === 1440) {
          assert.equal(new Set(layout.cards.map(Math.round)).size, 1, 'Summary cards should fit naturally on one desktop row')
        }
      }

      await page.setViewportSize({ width: 320, height: 800 })
      const expandedReflow = await page.evaluate(() => {
        document.querySelectorAll('details').forEach(element => { element.open = true })
        return { viewport: innerWidth, content: document.documentElement.scrollWidth }
      })
      assert.equal(expandedReflow.content, expandedReflow.viewport, `Expanded report overflows at 320px: ${JSON.stringify(expandedReflow)}`)

      const scaledWidths = await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
        const overflowingElements = [...document.querySelectorAll('body *')]
          .map(element => {
            const rect = element.getBoundingClientRect()
            return {
              tag: element.tagName,
              className: typeof element.className === 'string' ? element.className : '',
              text: element.textContent.trim().slice(0, 100),
              left: rect.left,
              right: rect.right,
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth
            }
          })
          .filter(element => element.right > innerWidth + 0.1 || element.left < 0 || element.scrollWidth > element.clientWidth)
          .slice(0, 8)
        return {
          viewport: innerWidth,
          content: document.documentElement.scrollWidth,
          rootFontSize: getComputedStyle(document.documentElement).fontSize,
          bodyFontSize: getComputedStyle(document.body).fontSize,
          overflowingElements
        }
      })
      assert.equal(scaledWidths.rootFontSize, '32px')
      assert.equal(scaledWidths.bodyFontSize, '32px')
      assert.equal(scaledWidths.content, scaledWidths.viewport, `Generated report overflows with 200% root text sizing at 320px: ${JSON.stringify(scaledWidths)}`)
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

  const emptyRoute = await runCli({ A11Y_OUT: outputParent, A11Y_ROUTES: '/,/about,' })
  assert.equal(emptyRoute.status, 1)
  assert.match(emptyRoute.stderr, /empty route entries/)
  await assert.rejects(stat(outputParent), { code: 'ENOENT' })
})
