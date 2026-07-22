import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useElementWidth } from '../../hooks/useElementWidth'
import { runFullIaDiagnostics, runFullUseCaseDiagnostics, runFullUserJourneyDiagnostics, runRoutingDiagnostics, runSmokeDiagnostics, type DrawioDiagnostic } from '../../lib/drawio/drawioDiagnostics'
import { mountDrawioScene, type DrawioScene } from '../../lib/drawio/mountDrawioScene'
import './drawio-lab.css'

export interface DrawioLabViewerProps {
  readonly sourceXml: string
  readonly sourceName: string
  readonly diagnostics: boolean
}

const ZOOM_LEVELS = [0.5, 1, 2] as const

type DrawioRunStatus = 'loading' | 'ready' | 'error'

interface DrawioRunState {
  readonly sourceXml: string
  readonly diagnostics: boolean
  readonly status: DrawioRunStatus
  readonly results: readonly DrawioDiagnostic[]
  readonly error: string | null
}

function createDrawioRunState(
  sourceXml: string,
  diagnostics: boolean,
  status: DrawioRunStatus,
  results: readonly DrawioDiagnostic[] = [],
  error: string | null = null,
): DrawioRunState {
  return {
    sourceXml,
    diagnostics,
    status,
    results: status === 'ready' ? results : [],
    error: status === 'error' ? error : null,
  }
}

function visibleDrawioRunState(
  run: DrawioRunState,
  sourceXml: string,
  diagnostics: boolean,
): DrawioRunState {
  if (run.sourceXml === sourceXml && run.diagnostics === diagnostics) return run
  return { sourceXml, diagnostics, status: 'loading', results: [], error: null }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function nextAnimationFrame(signal: AbortSignal) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', onAbort)
      resolvePromise()
    })
    const onAbort = () => {
      cancelAnimationFrame(frame)
      rejectPromise(new DOMException('draw.io geometry 측정이 취소되었습니다.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function selectedMessage(scene: DrawioScene | null, selectedId: string | null) {
  if (!scene || !selectedId) return '선택이 해제되었습니다.'
  const label = scene.svg.querySelector<SVGElement>(`[data-cell-id="${CSS.escape(selectedId)}"][aria-label]`)?.getAttribute('aria-label') ?? selectedId
  const adjacent = scene.topology.adjacentTo(selectedId)
  return `${label} 선택됨. 직접 연결 노드 ${adjacent.vertexIds.size}개, 연결선 ${adjacent.edgeIds.size}개.`
}

function applySelection(scene: DrawioScene, selectedId: string | null) {
  const adjacent = selectedId ? scene.topology.adjacentTo(selectedId) : null
  const incidentPhysical = new Set<string>()
  if (adjacent) {
    for (const semanticEdgeId of adjacent.edgeIds) {
      for (const physicalEdgeId of scene.topology.physicalEdgeIdsOf(semanticEdgeId)) incidentPhysical.add(physicalEdgeId)
    }
  }
  for (const node of scene.svg.querySelectorAll<SVGElement>('[data-cell-id]')) {
    const id = node.dataset.cellId ?? ''
    const isFocus = id === selectedId
    const isAdjacent = Boolean(adjacent?.vertexIds.has(id))
    const isIncident = incidentPhysical.has(id)
    const isDecoration = node.dataset.cellKind === 'decoration'
    const isRelated = !selectedId || isDecoration || isFocus || isAdjacent || isIncident
    node.classList.toggle('is-focus', isFocus)
    node.classList.toggle('is-adjacent', isAdjacent)
    node.classList.toggle('is-incident', isIncident)
    node.classList.toggle('is-dimmed', !isRelated)
    if (node.dataset.cellInteractive === 'true') node.setAttribute('aria-pressed', String(isFocus))
  }
}

function eventVertex(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<SVGElement>('[data-cell-kind="vertex"][data-cell-interactive="true"]')
    : null
}

export function DrawioLabViewer({ sourceXml, sourceName, diagnostics }: DrawioLabViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [stageRef, stageWidth] = useElementWidth<HTMLDivElement>()
  const [scene, setScene] = useState<DrawioScene | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [run, setRun] = useState<DrawioRunState>(() =>
    createDrawioRunState(sourceXml, diagnostics, 'loading'))
  const visibleRun = visibleDrawioRunState(run, sourceXml, diagnostics)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const controller = new AbortController()
    let mountedScene: DrawioScene | null = null
    setScene(null)
    setSelectedId(null)
    setRun(createDrawioRunState(sourceXml, diagnostics, 'loading'))
    void mountDrawioScene(host, sourceXml, { signal: controller.signal })
      .then(async (nextScene) => {
        if (controller.signal.aborted) {
          nextScene.dispose()
          return
        }
        mountedScene = nextScene
        setScene(nextScene)
        if (!diagnostics) {
          setRun(createDrawioRunState(sourceXml, diagnostics, 'ready'))
          return
        }
        const isRoutingFixture = nextScene.topology.vertexIds.has('routing-focus')
        const isFullIa = nextScene.topology.vertexIds.has('ia-dashboard')
        const isFullUseCase = nextScene.topology.vertexIds.has('ac-streamer')
        const isFullUserJourney = nextScene.topology.vertexIds.has('uj-hotkey')
        let fontFaceCount = 0
        if (isRoutingFixture || isFullIa || isFullUseCase || isFullUserJourney) {
          const label = isFullUserJourney
            ? '점프카드 뜨는 즉시 클립 제작 — 방송 전에'
            : isFullUseCase
              ? '스트리머 · 방송 시작부터 유튜브 업로드까지'
              : isFullIa ? '제품 영역 · Windows OBS 플러그인 (스트리머)' : '방송 채널과 업로드 권한을 한 화면에서 관리'
          await document.fonts.ready
          fontFaceCount = (await document.fonts.load('12px "Pretendard Variable"', label)).length
        }
        await nextAnimationFrame(controller.signal)
        await nextAnimationFrame(controller.signal)
        const snapshot = await nextScene.refreshAndCollectGeometry(controller.signal)
        const nextResults = isFullUseCase
          ? runFullUseCaseDiagnostics(nextScene, snapshot, fontFaceCount)
          : isFullUserJourney ? runFullUserJourneyDiagnostics(nextScene, snapshot, fontFaceCount)
          : isFullIa ? runFullIaDiagnostics(nextScene, snapshot, fontFaceCount)
          : isRoutingFixture
            ? runRoutingDiagnostics(nextScene, snapshot, fontFaceCount)
            : runSmokeDiagnostics(nextScene, snapshot)
        if (!controller.signal.aborted) {
          setRun(createDrawioRunState(sourceXml, diagnostics, 'ready', nextResults))
        }
      })
      .catch((mountError: unknown) => {
        if (!controller.signal.aborted && !isAbortError(mountError)) {
          const message = mountError instanceof Error ? mountError.message : String(mountError)
          setRun(createDrawioRunState(sourceXml, diagnostics, 'error', [], message))
        }
      })
    return () => {
      controller.abort()
      mountedScene?.dispose()
      host.replaceChildren()
    }
  }, [diagnostics, sourceXml])

  useEffect(() => {
    if (scene) applySelection(scene, selectedId)
  }, [scene, selectedId])

  const natural = scene?.naturalSize ?? { width: 1, height: 1 }
  const fitScale = stageWidth > 0 ? Math.min(1, stageWidth / natural.width) : 1
  const scale = fitScale * zoom
  const canvasSize = useMemo(
    () => ({ width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }),
    [natural.height, natural.width, scale],
  )

  const toggleVertex = (id: string) => setSelectedId((current) => (current === id ? null : id))
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const vertex = eventVertex(event.target)
    if (!vertex?.dataset.cellId) setSelectedId(null)
    else toggleVertex(vertex.dataset.cellId)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setSelectedId(null)
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const vertex = eventVertex(event.target)
    if (vertex?.dataset.cellInteractive !== 'true' || !vertex.dataset.cellId) return
    event.preventDefault()
    toggleVertex(vertex.dataset.cellId)
  }

  return (
    <section className="drawio-lab-viewer" aria-label={`${sourceName} maxGraph 뷰어`}>
      <div className="drawio-lab-toolbar">
        <p><strong>{sourceName}</strong><span>비압축 XML · inline SVG</span></p>
        <div className="drawio-zoom-controls" role="group" aria-label="확대/축소">
          {ZOOM_LEVELS.map((level) => (
            <button key={level} type="button" className={zoom === level ? 'active' : undefined} aria-pressed={zoom === level} onClick={() => setZoom(level)}>
              {level * 100}%
            </button>
          ))}
        </div>
      </div>
      {visibleRun.error && <p className="drawio-lab-error" role="alert">렌더 실패: {visibleRun.error}</p>}
      <div className="drawio-lab-stage" ref={stageRef}>
        <div className="drawio-lab-canvas" style={canvasSize} onClick={handleClick} onKeyDown={handleKeyDown}>
          <div className="drawio-lab-mount" ref={hostRef} />
        </div>
      </div>
      <p className="drawio-lab-hint">노드를 클릭하거나 Enter/Space로 선택하세요. 같은 노드·배경·Escape로 해제됩니다.</p>
      <p className="sr-only" aria-live="polite">{selectedMessage(scene, selectedId)}</p>
      {diagnostics && (
        <details
          className="drawio-diagnostics"
          data-diagnostics-state={visibleRun.status}
          aria-busy={visibleRun.status === 'loading'}
          open
        >
          <summary>fail-fast 진단</summary>
          <ul>
            {visibleRun.status === 'loading' && (
              <li data-diagnostic="diagnostics-loading" data-status="pending">
                <strong>RUN</strong> 진단 실행 중<span>새 XML 렌더와 geometry 측정을 기다리는 중</span>
              </li>
            )}
            {visibleRun.status === 'error' && (
              <li data-diagnostic="diagnostics-error" data-status="fail">
                <strong>FAIL</strong> 진단 실행 실패<span>{visibleRun.error}</span>
              </li>
            )}
            {visibleRun.results.map((result) => (
              <li key={result.id} data-diagnostic={result.id} data-status={result.pass ? 'pass' : 'fail'}>
                <strong>{result.pass ? 'PASS' : 'FAIL'}</strong> {result.label}<span>{result.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
