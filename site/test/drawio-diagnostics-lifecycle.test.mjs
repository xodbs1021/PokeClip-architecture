import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const viewerPath = fileURLToPath(new URL('../src/components/drawio/DrawioLabViewer.tsx', import.meta.url))

async function loadViewerFunction(name) {
  const source = await readFile(viewerPath, 'utf8')
  const file = ts.createSourceFile(viewerPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = file.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name)
  assert.ok(declaration, `${name} must remain an executable Viewer state contract`)
  const compiled = ts.transpileModule(
    `${declaration.getText(file)}\nmodule.exports = ${name}`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText
  const context = { module: { exports: {} }, exports: {} }
  vm.runInNewContext(compiled, context, { filename: `${name}.cjs` })
  return context.module.exports
}

test('source change and failure never expose diagnostics from a previous successful run', async () => {
  const createRunState = await loadViewerFunction('createDrawioRunState')
  const visibleRunState = await loadViewerFunction('visibleDrawioRunState')
  const previousPass = [{ id: 'old-pass', label: 'old', pass: true, detail: 'stale' }]

  const readyA = createRunState('source-a', true, 'ready', previousPass)
  assert.equal(readyA.results.length, 1)

  const loadingB = visibleRunState(readyA, 'source-b', true)
  assert.equal(loadingB.status, 'loading')
  assert.deepEqual([...loadingB.results], [])
  assert.equal(loadingB.error, null)

  const failedB = createRunState('source-b', true, 'error', previousPass, 'mount failed')
  assert.equal(failedB.status, 'error')
  assert.deepEqual([...failedB.results], [])
  assert.equal(failedB.error, 'mount failed')
})

test('diagnostics mode changes also invalidate a previous PASS snapshot', async () => {
  const createRunState = await loadViewerFunction('createDrawioRunState')
  const visibleRunState = await loadViewerFunction('visibleDrawioRunState')
  const ready = createRunState('same-source', true, 'ready', [
    { id: 'pass', label: 'pass', pass: true, detail: 'current only while enabled' },
  ])

  const disabled = visibleRunState(ready, 'same-source', false)
  assert.equal(disabled.status, 'loading')
  assert.deepEqual([...disabled.results], [])
})
