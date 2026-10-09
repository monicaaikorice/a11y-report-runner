/**
 * Explicit axe rule-selection policy for this runner. WCAG 2.2 incorporates
 * applicable 2.0/2.1 criteria, so their tags remain selected alongside axe's
 * 2.2 AA tag. Best-practice rules are run too, but separated from WCAG failures.
 */
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

/**
 * Return axe's native run configuration for the declared WCAG and best-practice
 * tags; target-size is enabled explicitly because axe leaves it disabled by default.
 * @returns {{runOnly: {type: 'tag', values: string[]}, rules: object}} Axe options.
 */
export function getAxeRunOptions() {
  return {
    runOnly: { type: 'tag', values: [...AXE_RUN_TAGS] },
    rules: {
      // axe disables this WCAG 2.2 AA target-size rule by default; include it in the declared baseline.
      'target-size': { enabled: true }
    }
  }
}

/**
 * Classify a failed axe rule as best-practice-only, not as a WCAG violation.
 * Rules carrying any selected WCAG tag stay in the WCAG category even if axe
 * also labels them as best practice.
 * @param {object} rule Axe rule result with a `tags` array.
 * @returns {boolean} Whether the result belongs only to the best-practice set.
 */
export function isBestPracticeOnly(rule) {
  return rule.tags?.includes('best-practice') === true &&
    !rule.tags.some(tag => WCAG_TAGS.has(tag))
}
