import fullUseCaseXml from '../../../../labs/drawio/0_Pokeclip_UseCase.drawio?raw'
import { DrawioLabViewer } from '../../components/drawio/DrawioLabViewer'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DrawioUseCaseLabPage() {
  usePageTitle('draw.io XML / maxGraph Use Case 실험 · PokeClip')

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Isolated architecture lab</p>
        <h1>draw.io XML / maxGraph Use Case lab</h1>
        <p className="lede">
          기존 0번 Use Case와 /diagrams/0을 교체하지 않고, 액터 spine·의미 관계·장식 분리를 격리된 경로에서 검증한다.
        </p>
      </header>
      <DrawioLabViewer sourceXml={fullUseCaseXml} sourceName="PokeClip Use Case · full model" diagnostics />
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
