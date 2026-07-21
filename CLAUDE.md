# PokeClip — 저장소 작업 가이드

스트리밍 하이라이트·클립 자동화 서비스. OBS 플러그인이 본방과 병행으로 멀티오디오(~10트랙)를 SRT로 동시 송출하고, 채팅 분석이 하이라이트를 실시간 포착해 방송이 끝나기 전에 BGM 없는 클립을 유튜브에 올린다.

## 문서 맵 (번호가 곧 체계)

| 번호 | 내용 |
|---|---|
| 0~5 | 다이어그램 (UseCase·IA·유저저니·SA·SysA·CA) — HTML이 원본, PNG는 렌더본 |
| 6 + adr/ | 설계 결정 인덱스 + ADR 15건 |
| 8 | 하이라이트 탐지 연구 노트 |
| 9 | **기능 명세서** — 기능 ID(A1~I7)·우선순위·마일스톤의 기준 문서 |
| 10 | 데이터 플로우 — SQS 메시지·DB 스키마 초안 |
| 11 | **역할 분담** — 오너십·인터페이스 계약 8종·승인권 |
| 12 | **M1 실행 계획** — 착수 순서·통합 게이트·폴백 기준 |

새 작업 시작 전 9 → 11 → 12 순서로 읽을 것. 기능은 반드시 기능 ID(예: B3, E4)로 지칭한다.

## 개발 규칙

- **main 보호**: 직접 push 금지 — 브랜치 → PR → 승인 리뷰 1명 + 리뷰 코멘트 해결 필수
- **결정 변경은 ADR로**: 기존 결정을 뒤집을 땐 새 ADR 추가 + 기존 ADR에 "대체됨 → ADR-XXX" 포인터. 삭제 금지 (예: ADR-013 → ADR-015)
- **인터페이스 계약 우선**: 서비스 경계(SQS 스키마·SSE·LL-HLS 규약 등 8종, 11번 문서)를 먼저 확정·문서화한 뒤 구현. 계약 변경은 해당 승인권자(스키마=3번, 인프라/큐=1번, UI/UX=2번) 승인 필요
- **다이어그램 HTML 수정 시 주의**: 뷰어 사이트가 원본의 `wire('idA','idB')` 호출과 요소 id를 파싱해 클릭 인터랙션을 만든다. 노드 id·wire() 패턴 구조를 유지할 것. HTML 수정 후 PNG 재렌더 필요

## 모노레포 배치 (서비스 코드 추가 시 이 경로 규칙 사용)

```
plugin/            C++ OBS 플러그인 (1번)
media-origin/      Go 미디어 서버 (1번)
services/
  auth-account/    Spring (3번)
  clip/            Spring (3번)
  chat-collector/  Node·TS (2번)
  render-upload/   Spring+FFmpeg (1번)
  ai-worker/       Python (2번)
web/               React 대시보드 (2번) — site/와 별개
infra/             IaC·배포 (1번)
site/              문서 뷰어 사이트 (기존, 아래 참조)
```

CI(I2)는 모노레포 경로 필터 전제 — 새 서비스는 위 경로에 맞춰야 빌드 필터가 성립한다.

## site/ — 문서 뷰어 (이미 배포 중)

- Vite+React SPA, Vercel 자동 배포 (main push → https://poke-clip-architecture.vercel.app, Root Directory=site)
- 루트의 md·다이어그램 HTML을 빌드 타임에 임포트/복사한다 → **문서만 고쳐도 push하면 사이트에 자동 반영**
- `site/public/diagrams/`는 생성물(커밋 금지), 로컬: `cd site && npm run dev`
- 새 루트 문서(N번) 추가 시: README 표 + `site/src/lib/{content,links}.ts` + `App.tsx` 라우트 + 네비/개요 인덱스 갱신

## 팀

1번 팀장(저장소 소유자·인프라/미디어) · 2번(프론트·실시간/AI) · 3번(데이터/코어 API). 상세·근거는 11번 문서.

## 하네스: PokeClip

**목표:** 방송이 끝나기 전에 BGM 없는 하이라이트 클립이 유튜브에 올라가는 파이프라인을 3인 팀이 M1 수직 슬라이스부터 완성한다 (상세: 프로필 1장).

**제0원칙 (다른 모든 것에 우선):** 모든 개발은 `.claude/harness/principles.md`를 최우선으로 지킨다 — 코드는 사람을 위한 것, 이름=계약, 구현=교체 가능한 부품, 과설계 금지(YAGNI).

**트리거:** 코드 변경을 수반하는 작업 요청 시 `harness-orchestrator` 스킬을 사용하라. 단순 질문·설명·조회는 직접 응답 가능.

**도메인 슬롯:** 이 프로젝트의 스택·아키텍처 불변식·경계면·운영 모델·검증 명령은 `.claude/harness/project-profile.md`에 있다.

**강제 훅 (`.claude/settings.json`, 커밋됨):** 기본 브랜치 직접 커밋 차단 / 코드·설정 편집 시 완료·설명 게이트 플래그 / Stop 시 타입체크(프로필 3장)+change-explainer+completion-auditor 미실행이면 종료 차단. 무한루프 가드 3회. 탈출구 `HARNESS_HOOKS=off` 또는 `ECC_DISABLED_HOOKS`.

**using-superpowers 전역 선점 비활성:** 이 하네스는 `harness-orchestrator`가 스킬 순서를 통제한다. "응답 전 스킬 먼저"(using-superpowers) 전역 강제가 오케스트레이터 파이프라인을 가로채지 않게 한다. 각 에이전트는 자기 정의에 명시된 superpowers 스킬만 참조 호출한다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-07-21 | 하네스 템플릿 인스턴스화 | 전체 | - |
