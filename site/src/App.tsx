import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SiteFooter, SiteHeader } from './components/layout/SiteHeader'
import { DOCS } from './lib/content'
import { AdrDetailPage, AdrIndexPage } from './pages/AdrPage'
import { DiagramsPage } from './pages/DiagramsPage'
import { DocPage } from './pages/DocPage'
import { OverviewPage } from './pages/OverviewPage'

const DrawioIaLabPage = lazy(() =>
  import('./pages/labs/DrawioIaLabPage').then(({ DrawioIaLabPage: Page }) => ({ default: Page })),
)
const DrawioUseCaseLabPage = lazy(() =>
  import('./pages/labs/DrawioUseCaseLabPage').then(({ DrawioUseCaseLabPage: Page }) => ({ default: Page })),
)
const DrawioUserJourneyLabPage = lazy(() =>
  import('./pages/labs/DrawioUserJourneyLabPage').then(({ DrawioUserJourneyLabPage: Page }) => ({ default: Page })),
)

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        본문 바로가기
      </a>
      <ScrollToTop />
      <SiteHeader />
      <main id="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/diagrams" element={<Navigate to="/diagrams/0" replace />} />
          <Route path="/diagrams/:num" element={<DiagramsPage />} />
          <Route
            path="/labs/drawio/0"
            element={
              <Suspense fallback={<p className="page">draw.io XML lab 로딩 중…</p>}>
                <DrawioUseCaseLabPage />
              </Suspense>
            }
          />
          <Route
            path="/labs/drawio/1"
            element={
              <Suspense fallback={<p className="page">draw.io XML lab 로딩 중…</p>}>
                <DrawioIaLabPage />
              </Suspense>
            }
          />
          <Route
            path="/labs/drawio/2"
            element={
              <Suspense fallback={<p className="page">draw.io XML lab 로딩 중…</p>}>
                <DrawioUserJourneyLabPage />
              </Suspense>
            }
          />
          <Route
            path="/spec"
            element={
              <DocPage
                eyebrow="Doc 9 · Functional Spec"
                title="기능 명세서"
                lede="기능 범위·우선순위·개발 순서·리스크 — 기술 멘토 리뷰용 개발 기획서."
                markdown={DOCS.spec}
              />
            }
          />
          <Route
            path="/research"
            element={
              <DocPage
                eyebrow="Doc 8 · Research Note"
                title="하이라이트 탐지 연구 노트"
                lede="채팅 반응 기반 하이라이트 탐지 방법론 — 팀 실측 기록."
                markdown={DOCS.research}
              />
            }
          />
          <Route
            path="/dataflow"
            element={
              <DocPage
                eyebrow="Doc 10 · Data Flow"
                title="데이터 플로우"
                lede="Media Origin → SNS/SQS → ECS → S3·PostgreSQL — 방송 이벤트, 잡 수명주기, 실시간 API 계약."
                markdown={DOCS.dataflow}
              />
            }
          />
          <Route
            path="/roles"
            element={
              <DocPage
                eyebrow="Doc 11 · Team Roles"
                title="역할 분담"
                lede="3인 분담 — 서비스 단위 오너십, 인터페이스 계약 9종, 조정 카드·폴백 기준."
                markdown={DOCS.roles}
              />
            }
          />
          <Route
            path="/m1"
            element={
              <DocPage
                eyebrow="Doc 12 · M1 Plan"
                title="M1 수직 슬라이스 실행 계획"
                lede="계약 → 언블록 스텁 → 리스크 우선 검증 → 병렬 → 통합 게이트 4개 — 폴백 판정 기준 포함."
                markdown={DOCS.m1}
              />
            }
          />
          <Route path="/adr" element={<AdrIndexPage />} />
          <Route path="/adr/:slug" element={<AdrDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <SiteFooter />
    </>
  )
}

export default App
