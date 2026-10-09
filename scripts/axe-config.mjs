// WCAG 2.2 is cumulative: retain the 2.0 and 2.1 tags and add axe's 2.2 AA tag.
export const AXE_RUN_TAGS = Object.freeze([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice'
])

const WCAG_TAGS = new Set([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa'
])

export function getAxeRunOptions() {
  return {
    runOnly: { type: 'tag', values: [...AXE_RUN_TAGS] },
    rules: {
      'target-size': { enabled: true }
    }
  }
}

export function isBestPracticeOnly(rule) {
  return rule.tags?.includes('best-practice') === true &&
    !rule.tags.some(tag => WCAG_TAGS.has(tag))
}
