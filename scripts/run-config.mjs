/**
 * Parse environment-backed scan settings and build stable scan identities.
 * This module stays independent of Playwright so input validation and output
 * directory safety can be tested without launching a browser.
 */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * @typedef {object} ScanConfiguration
 * @property {string} id Stable identifier for the route and browser environment.
 * @property {string} route Configured route before URL resolution.
 * @property {number} routeIndex Position in the configured route list.
 * @property {string} url Resolved URL to scan.
 * @property {{name: string, width: number, height: number}} viewport CSS viewport settings.
 * @property {'light' | 'dark'} colorScheme Emulated browser color preference.
 */

export const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'default', width: 1280, height: 720 })
])
export const DEFAULT_COLOR_SCHEMES = Object.freeze(['light'])
export const DEFAULT_ROUTES = Object.freeze(['/'])

/**
 * Parse comma-separated routes, defaulting to the origin root so the CLI makes
 * no assumptions about a target application's route structure.
 * @param {string | undefined} value A11Y_ROUTES value.
 * @returns {string[]} Trimmed relative paths or absolute URLs, in input order.
 * @throws {Error} If the value is empty or contains an empty list entry.
 */
export function parseRoutes(value) {
  if (value === undefined) return [...DEFAULT_ROUTES]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A11Y_ROUTES must contain one or more comma-separated routes.')
  }

  const routes = value.split(',').map(route => route.trim())
  if (routes.some(route => route === '')) {
    throw new Error('A11Y_ROUTES cannot contain empty route entries.')
  }
  return routes
}

/**
 * Parse named CSS viewport dimensions. Names become part of report metadata;
 * dimensions must be positive safe integers so Playwright receives valid sizes.
 * @param {string | undefined} value A11Y_VIEWPORTS value.
 * @returns {{name: string, width: number, height: number}[]} Configured viewports.
 * @throws {Error} If an entry is malformed, duplicated, or has invalid dimensions.
 */
export function parseViewports(value) {
  if (value === undefined) return DEFAULT_VIEWPORTS.map(viewport => ({ ...viewport }))
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A11Y_VIEWPORTS must contain one or more named viewport configurations.')
  }

  const names = new Set()
  return value.split(',').map(entry => {
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)=(\d+)x(\d+)\s*$/.exec(entry)
    if (!match) {
      throw new Error(`Invalid A11Y_VIEWPORTS entry "${entry.trim()}". Use name=WIDTHxHEIGHT, for example mobile=390x844.`)
    }

    const [, name, rawWidth, rawHeight] = match
    if (names.has(name)) throw new Error(`Duplicate A11Y_VIEWPORTS name "${name}".`)
    names.add(name)

    const width = Number(rawWidth)
    const height = Number(rawHeight)
    if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
      throw new Error(`Viewport "${name}" must use positive, safe integer dimensions.`)
    }

    return { name, width, height }
  })
}

/**
 * Parse Playwright's supported color-scheme preferences; these emulate the
 * browser media preference and do not represent forced-colors or OS themes.
 * @param {string | undefined} value A11Y_COLOR_SCHEMES value.
 * @returns {('light' | 'dark')[]} Selected schemes, in input order.
 * @throws {Error} If a scheme is unsupported, duplicated, or missing.
 */
export function parseColorSchemes(value) {
  if (value === undefined) return [...DEFAULT_COLOR_SCHEMES]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('A11Y_COLOR_SCHEMES must contain light, dark, or both.')
  }

  const schemes = value.split(',').map(scheme => scheme.trim())
  const seen = new Set()
  for (const scheme of schemes) {
    if (!['light', 'dark'].includes(scheme)) {
      throw new Error(`Invalid A11Y_COLOR_SCHEMES value "${scheme}". Use light, dark, or light,dark.`)
    }
    if (seen.has(scheme)) throw new Error(`Duplicate A11Y_COLOR_SCHEMES value "${scheme}".`)
    seen.add(scheme)
  }
  return schemes
}

/**
 * Expand routes, viewports, and schemes into the Cartesian scan matrix.
 * The route index is included in the stable ID so duplicate route entries remain
 * distinguishable in reports even when they resolve to the same URL.
 * @param {string[]} routes Parsed route list.
 * @param {string} baseUrl URL used to resolve relative routes.
 * @param {{name: string, width: number, height: number}[]} viewports Parsed viewports.
 * @param {('light' | 'dark')[]} colorSchemes Parsed schemes.
 * @returns {ScanConfiguration[]} Configurations with deterministic IDs and resolved URLs.
 */
export function buildConfigurations(routes, baseUrl, viewports, colorSchemes) {
  const configurations = []
  for (const viewport of viewports) {
    for (const colorScheme of colorSchemes) {
      for (const [routeIndex, route] of routes.entries()) {
        const url = new URL(route, baseUrl).toString()
        const dimensions = { name: viewport.name, width: viewport.width, height: viewport.height }
        const identity = JSON.stringify({ routeIndex, route, url, viewport: dimensions, colorScheme })
        const id = `cfg-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
        configurations.push({ id, route, routeIndex, url, viewport: dimensions, colorScheme })
      }
    }
  }
  return configurations
}

/**
 * Reserve a new UTC timestamped run directory without reusing existing output.
 * Exclusive mkdir provides the collision check across simultaneous processes;
 * only EEXIST retries with a suffix, while other filesystem failures are surfaced.
 * @param {string} parentDirectory Report root directory.
 * @param {Date} [date] Optional date for deterministic tests.
 * @returns {Promise<string>} Newly created run directory path.
 * @throws {Error} If the parent or unique run directory cannot be created.
 */
export async function createUniqueRunDirectory(parentDirectory, date = new Date()) {
  try {
    await mkdir(parentDirectory, { recursive: true })
  } catch (error) {
    throw new Error(`Unable to create report parent directory "${parentDirectory}": ${error.message}`, { cause: error })
  }
  const timestamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z')

  for (let suffix = 0; ; suffix += 1) {
    const name = suffix === 0 ? timestamp : `${timestamp}-${String(suffix).padStart(2, '0')}`
    const directory = path.join(parentDirectory, name)
    try {
      // Non-recursive mkdir is atomic: EEXIST advances the suffix instead of reusing old reports.
      await mkdir(directory)
      return directory
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw new Error(`Unable to create a unique report directory under "${parentDirectory}": ${error.message}`, { cause: error })
    }
  }
}
