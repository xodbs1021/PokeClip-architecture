import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { DiagramViewer } from '../components/diagram/DiagramViewer'
import { DrawioDiagram, hasDrawioDiagram } from '../components/diagram/DrawioDiagram'
import { MarkdownArticle } from '../components/markdown/MarkdownArticle'
import { usePageTitle } from '../hooks/usePageTitle'
import { DIAGRAMS, diagramDoc } from '../lib/content'

export function DiagramsPage() {
  const { num } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const diagram = DIAGRAMS.find((d) => String(d.num) === num)
  usePageTitle(diagram ? `${diagram.num} ${diagram.title} · PokeClip 아키텍처` : 'PokeClip — 아키텍처')
  if (!diagram) return <Navigate to="/diagrams/0" replace />

  const isDocView = searchParams.get('view') === 'doc'
  const doc = diagramDoc(diagram.num)
  const viewSuffix = isDocView ? '?view=doc' : ''
  const isDrawio = hasDrawioDiagram(diagram.num)

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Diagrams 0–5</p>
        <h1>아키텍처 다이어그램</h1>
        <p className="lede">
          {isDrawio
            ? 'draw.io/maxGraph 렌더가 최신본이다 — 이전 HTML 버전은 아래 아카이브 링크로 열 수 있고, 문서 보기는 같은 내용을 반응형 텍스트로 보여준다.'
            : 'self-contained HTML이 원본이다 — 다이어그램 보기는 화면 폭에 맞춰 자동 축소, 문서 보기는 같은 내용을 반응형 텍스트로 보여준다.'}
        </p>
      </header>
      <div className="diagram-controls">
        <nav className="diagram-tabs" aria-label="다이어그램 선택">
          {DIAGRAMS.map((d) => {
            const active = d.num === diagram.num
            return (
              <Link
                key={d.num}
                to={`/diagrams/${d.num}${viewSuffix}`}
                className={active ? 'tab active' : 'tab'}
                aria-current={active ? 'page' : undefined}
              >
                <span className="tab-num">{d.num}</span>
                {d.title}
              </Link>
            )
          })}
        </nav>
        <div className="view-toggle" role="group" aria-label="보기 방식">
          <button
            type="button"
            className={isDocView ? undefined : 'active'}
            aria-pressed={!isDocView}
            onClick={() => setSearchParams({}, { replace: true })}
          >
            다이어그램
          </button>
          <button
            type="button"
            className={isDocView ? 'active' : undefined}
            aria-pressed={isDocView}
            onClick={() => setSearchParams({ view: 'doc' }, { replace: true })}
          >
            문서 보기
          </button>
        </div>
      </div>
      {isDocView ? (
        <article aria-label={`${diagram.title} 문서 보기`}>
          <MarkdownArticle markdown={doc} />
        </article>
      ) : isDrawio ? (
        <>
          <DrawioDiagram num={diagram.num} title={diagram.title} />
          <p className="diagram-archive-link">
            <a href={`/diagrams/${diagram.file}`} target="_blank" rel="noreferrer">
              이전 버전(HTML) 아카이브 ↗
            </a>
          </p>
        </>
      ) : (
        <DiagramViewer diagram={diagram} />
      )}
    </div>
  )
}
