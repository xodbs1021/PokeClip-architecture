// 저장소 루트의 원본 문서가 단일 소스 — 빌드 타임에 그대로 번들된다.
import dataflowRaw from '../../../10_Pokeclip_데이터플로우.md?raw'
import rolesRaw from '../../../11_Pokeclip_역할분담.md?raw'
import m1Raw from '../../../12_Pokeclip_M1실행계획.md?raw'
import decisionsRaw from '../../../6_Pokeclip_설계결정.md?raw'
import researchRaw from '../../../8_Pokeclip_하이라이트연구노트.md?raw'
import specRaw from '../../../9_Pokeclip_기능명세서.md?raw'

export interface DiagramMeta {
  num: number
  title: string
  en: string
  file: string
  /** 원본 HTML body의 고정 캔버스 크기. height가 없는 문서는 로드 후 실측한다. */
  width: number
  height: number | null
}

export const DIAGRAMS: DiagramMeta[] = [
  { num: 0, title: '유스케이스', en: 'Use Case', file: '0_Pokeclip_UseCase.html', width: 2700, height: 1425 },
  { num: 1, title: 'IA · 정보 구조', en: 'Information Architecture', file: '1_Pokeclip_IA.html', width: 2280, height: 1638 },
  { num: 2, title: '유저 저니', en: 'User Journey', file: '2_Pokeclip_UserJourney.html', width: 2620, height: 1400 },
  { num: 3, title: '서비스 아키텍처', en: 'Service Architecture', file: '3_Pokeclip_SA.html', width: 2700, height: 1560 },
  { num: 4, title: '시스템 아키텍처', en: 'System Architecture', file: '4_Pokeclip_SysA.html', width: 2700, height: 1700 },
  { num: 5, title: '클라우드 아키텍처 · AWS', en: 'Cloud Architecture', file: '5_Pokeclip_CA.html', width: 3840, height: 2320 },
]

export const DOCS = {
  spec: specRaw,
  decisions: decisionsRaw,
  research: researchRaw,
  dataflow: dataflowRaw,
  roles: rolesRaw,
  m1: m1Raw,
}

// 다이어그램의 반응형 문서 뷰 — 원본 HTML에서 파생해 site가 소유하는 md.
const diagramDocModules = import.meta.glob('../content/diagrams/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function diagramDoc(num: number): string {
  const entry = Object.entries(diagramDocModules).find(([path]) => path.endsWith(`/${num}.md`))
  return entry?.[1] ?? ''
}

const adrModules = import.meta.glob('../../../adr/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface AdrDoc {
  slug: string
  id: string
  title: string
  body: string
}

export const ADRS: AdrDoc[] = Object.entries(adrModules)
  .map(([path, body]) => {
    const slug = path.split('/').pop()!.replace(/\.md$/, '')
    const heading = (body.split('\n').find((line) => line.startsWith('# ')) ?? slug).replace(/^#\s*/, '')
    const parsed = heading.match(/^(ADR-\d+):?\s*(.*)$/)
    return {
      slug,
      id: parsed?.[1] ?? slug.split('_')[0],
      title: parsed?.[2] || heading,
      body,
    }
  })
  .sort((a, b) => a.id.localeCompare(b.id))
