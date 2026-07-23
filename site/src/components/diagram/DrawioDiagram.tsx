import { useEffect, useState } from 'react'
import { DrawioLabViewer } from '../drawio/DrawioLabViewer'

// 승격된 draw.io/maxGraph 다이어그램 소스 — 0·1·2만 랩에서 정본화됐다.
// 대용량 XML은 지연 로드해 초기 번들에서 분리한다(각 청크 분리).
const DRAWIO_LOADERS: Record<number, () => Promise<{ default: string }>> = {
  0: () => import('../../../../labs/drawio/0_Pokeclip_UseCase.drawio?raw'),
  1: () => import('../../../../labs/drawio/1_Pokeclip_IA.drawio?raw'),
  2: () => import('../../../../labs/drawio/2_Pokeclip_UserJourney.drawio?raw'),
}

export function hasDrawioDiagram(num: number): boolean {
  return num in DRAWIO_LOADERS
}

interface DrawioDiagramProps {
  num: number
  title: string
}

export function DrawioDiagram({ num, title }: DrawioDiagramProps) {
  const [sourceXml, setSourceXml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setSourceXml(null)
    setError(null)
    const loader = DRAWIO_LOADERS[num]
    if (!loader) {
      setError(`draw.io 소스가 없는 다이어그램: ${num}`)
      return
    }
    loader()
      .then((module) => {
        if (active) setSourceXml(module.default)
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError))
      })
    return () => {
      active = false
    }
  }, [num])

  if (error) {
    return (
      <p className="page" role="alert">
        draw.io 소스 로드 실패: {error}
      </p>
    )
  }
  if (sourceXml === null) {
    return <p className="page">draw.io 다이어그램 로딩 중…</p>
  }
  return <DrawioLabViewer sourceXml={sourceXml} sourceName={`PokeClip ${title}`} diagnostics={false} />
}
