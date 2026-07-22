import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const mountSourcePath = fileURLToPath(new URL('../src/lib/drawio/mountDrawioScene.ts', import.meta.url))

test('semantic vertex label DOM does not intercept pointer input from its interactive shape', async () => {
  const source = await readFile(mountSourcePath, 'utf8')

  assert.match(
    source,
    /record\.pokeKind === 'semantic'\s*&&\s*record\.kind === 'vertex'[\s\S]{0,160}textNode\.setAttribute\('pointer-events', 'none'\)/,
  )
})
