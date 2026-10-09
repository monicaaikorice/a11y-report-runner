import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: 'default', width: 1280, height: 720 })
])
export const DEFAULT_COLOR_SCHEMES = Object.freeze(['light'])

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
      await mkdir(directory)
      return directory
    } catch (error) {
      if (error.code === 'EEXIST') continue
      throw new Error(`Unable to create a unique report directory under "${parentDirectory}": ${error.message}`, { cause: error })
    }
  }
}
