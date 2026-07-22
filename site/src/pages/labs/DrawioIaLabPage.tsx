import { useSearchParams } from 'react-router-dom'
import fullIaXml from '../../../../labs/drawio/1_Pokeclip_IA.drawio?raw'
import routingXml from '../../../../labs/drawio/fixture-routing.drawio?raw'
import smokeXml from '../../../../labs/drawio/fixture-smoke.drawio?raw'
import { DrawioLabViewer } from '../../components/drawio/DrawioLabViewer'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DrawioIaLabPage() {
  const [searchParams] = useSearchParams()
  const fixture = searchParams.get('fixture')
  const source = fixture === 'routing'
    ? { xml: routingXml, name: 'Routing fixture' }
    : fixture === 'smoke'
      ? { xml: smokeXml, name: 'Smoke fixture' }
      : { xml: fullIaXml, name: 'PokeClip IA · full model' }
  usePageTitle('draw.io XML / maxGraph IA 실험 · PokeClip')

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Isolated architecture lab</p>
        <h1>draw.io XML / maxGraph engine lab</h1>
        <p className="lede">
          기존 1번 IA를 교체하지 않고, 중앙 포트·직교 라우팅·cell ID 기반 인터랙션을 격리된 경로에서 검증한다.
        </p>
      </header>
      <DrawioLabViewer sourceXml={source.xml} sourceName={source.name} diagnostics />
      <footer className="drawio-lab-license">
        <p>
          <strong>maxGraph 0.24.0</strong> · Apache-2.0 · 실험용 브라우저 런타임 ·{' '}
          <a href="https://github.com/maxGraph/maxGraph" target="_blank" rel="noreferrer">공식 소스</a> ·{' '}
          <a href="/licenses/maxgraph-Apache-2.0.txt" target="_blank" rel="noreferrer">라이선스 전문</a>
        </p>
        <p><code>@drawio/mcp@1.5.0</code>과 bundled libavoid는 XML 생성 단계 전용이며 브라우저 런타임에 포함되지 않는다.</p>
      </footer>
    </div>
  )
}
