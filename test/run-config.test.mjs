import assert from 'node:assert/strict'
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createUniqueRunDirectory } from '../scripts/run-config.mjs'

test('creates distinct same-second output directories atomically and preserves existing reports', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'a11y-report-runner-collision-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const date = new Date('2026-10-08T21:30:00.000Z')
  const existing = join(parent, '2026-10-08T21-30-00Z')
  await mkdir(existing)
  const sentinelPath = join(existing, 'axe-results.json')
  await writeFile(sentinelPath, 'previous report')

  const directories = await Promise.all(Array.from({ length: 6 }, () => createUniqueRunDirectory(parent, date)))
  assert.equal(new Set(directories).size, 6)
  assert.ok(directories.every(directory => directory !== existing))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'previous report')
  assert.deepEqual(directories.map(directory => directory.split('/').at(-1)).sort(), [
    '2026-10-08T21-30-00Z-01',
    '2026-10-08T21-30-00Z-02',
    '2026-10-08T21-30-00Z-03',
    '2026-10-08T21-30-00Z-04',
    '2026-10-08T21-30-00Z-05',
    '2026-10-08T21-30-00Z-06'
  ])

  const blockingFile = join(parent, 'not-a-directory')
  await writeFile(blockingFile, 'occupied')
  await assert.rejects(
    createUniqueRunDirectory(join(blockingFile, 'reports'), date),
    /Unable to create report parent directory/
  )

  const freshParent = await mkdtemp(join(tmpdir(), 'a11y-report-runner-concurrent-'))
  t.after(() => rm(freshParent, { recursive: true, force: true }))
  const simultaneous = await Promise.all(Array.from({ length: 6 }, () => createUniqueRunDirectory(freshParent, date)))
  assert.equal(new Set(simultaneous).size, 6)
  assert.ok(simultaneous.some(directory => directory.endsWith('2026-10-08T21-30-00Z')))
  assert.ok(simultaneous.every(directory => directory.startsWith(freshParent + '/')))
})
