import fullUserJourneyXml from '../../../../labs/drawio/2_Pokeclip_UserJourney.drawio?raw'
import { DrawioLabViewer } from '../../components/drawio/DrawioLabViewer'
import { usePageTitle } from '../../hooks/usePageTitle'

export function DrawioUserJourneyLabPage() {
  usePageTitle('draw.io XML / maxGraph User Journey 실험 · PokeClip')

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Isolated architecture lab</p>
        <h1>draw.io XML / maxGraph User Journey lab</h1>
        <p className="lede">
          2번 User Journey를 레인×페이즈 overlay와 2개 전이 화살표로 격리 검증한다 — overlay·annotation은 비-obstacle
          장식, 두 전이 엣지만 결정적으로 라우팅한다.
        </p>
      </header>
      <DrawioLabViewer sourceXml={fullUserJourneyXml} sourceName="PokeClip User Journey · full model" diagnostics />
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
