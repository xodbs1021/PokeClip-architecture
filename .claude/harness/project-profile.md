# 프로젝트 프로필 — PokeClip

> **이 파일은 하네스의 유일한 도메인 슬롯이다.**
> 제네릭 에이전트·오케스트레이터는 도메인 지식을 자기 안에 담지 않는다. 대신 런타임에
> 이 파일을 읽어 "이 프로젝트가 무엇이고, 무엇을 지켜야 하며, 어떻게 검증하는가"를 배운다.
> 새 프로젝트 온보딩 = **이 파일만 채우기.** 에이전트 정의는 손대지 않는다.
>
> 작성 규칙:
> - 각 섹션 머리의 `[읽는 이]`는 이 섹션을 참조하는 에이전트다. 비우면 그 에이전트는 "해당 없음"으로 처리한다.
> - 모르는 항목은 지우지 말고 `(해당 없음)` 또는 `(미정)`으로 둔다 — 빈칸과 "없음"은 다르다.
> - 사실만 적는다. 코드에서 확인되지 않는 희망사항을 불변식에 넣지 않는다.
> - 이 파일은 **하중지지 사실**(항상 로드)이다. 세션 서사·탐색 히스토리는 여기가 아니라 claude-mem으로 간다.
> - 이 프로필은 요약이다 — 충돌 시 루트 번호 문서(9·10·11·12·adr/)가 정본.

---

## 1. 정체성 (identity)
`[읽는 이: 전 에이전트 · 오케스트레이터 제목 · developer/orchestrator description]`

- **한 줄 정의:** 스트리밍 하이라이트·클립 자동화 서비스 — OBS 플러그인이 본방과 병행으로 멀티오디오(~10트랙)를 SRT로 동시 송출하고, 채팅 분석이 하이라이트를 실시간 포착해 방송이 끝나기 전에 BGM 없는 클립을 유튜브에 올린다.
- **도메인:** 실시간 미디어 인제스트(SRT→CMAF→LL-HLS/DVR) · 채팅 수집·하이라이트 탐지 · FFmpeg 렌더 · 유튜브 업로드 파이프라인
- **주 사용자 & 기술 숙련도:** 3인 개발팀 — 1번 팀장(인프라·미디어), 2번(프론트·실시간/AI), 3번(데이터·코어 API). 전원 개발자라 기술 용어 그대로 사용. 기능은 반드시 기능 ID(A1~I7, 9번 문서)로 지칭한다.
- **1차 언어(사용자 대면 보고):** 한국어 — change-explainer·clarifier가 이 언어로 보고. 섹션 참조에 § 기호를 쓰지 않는다("3장" 표기).

---

## 2. 기술 스택 (stack)
`[읽는 이: developer · planner · reviewer · plan-reviewer]`

- **언어:** C++(플러그인) · Go(미디어 서버) · Java/Spring(코어 API·워커) · TypeScript(웹·채팅 수집) · Python(AI 워커)
- **프레임워크/런타임:** libobs · React+Vite · Node · Spring Boot · faster-whisper · FFmpeg · AWS(SQS·ECS·S3·CloudFront) · PostgreSQL · Redis
- **패키지 매니저:** npm(site/·web/·chat-collector) — 그 외 서비스는 착수 시 확정
- **핵심 디렉토리 맵** — 어디에 무엇이 있나(계획·검수 시 영향 범위 판단 기준). 정본은 루트 CLAUDE.md의 "모노레포 배치":
  - 루트 번호 문서 0~12 + `adr/` — 아키텍처 산출물. 번호가 곧 체계 (9=기능명세, 10=데이터플로우, 11=역할분담, 12=M1 계획)
  - `site/` — 문서 뷰어 SPA (**현재 유일한 코드**, Vercel 배포 중)
  - `plugin/` `media-origin/` `services/{auth-account,clip,chat-collector,render-upload,ai-worker}` `web/` `infra/` — 서비스 코드 예정 경로 (**아직 미생성**, 새 서비스는 반드시 이 경로 규칙을 따를 것 — CI 경로 필터 전제)

---

## 3. 검증 명령 (verify)
`[읽는 이: developer · ecc:code-reviewer · completion-auditor · pr-author · verify-before-stop 훅]`

> **타입체크 명령의 기계 정본은 `.claude/harness/harness.env`의 `HARNESS_TYPECHECK_CMD`다** — Stop 훅은 그 파일만 읽는다.
> 여기 3장에 명령을 다시 적지 마라(이중 기입 = 드리프트). 나머지 항목(테스트·빌드·린트·관찰)은 이 섹션이 정본.

- **타입체크:** `.claude/harness/harness.env` 참조 (여기 다시 적지 않는다)
- **테스트:** (미정) — site/는 테스트 없음. 서비스 코드 착수 시 서비스별로 확정해 여기에 추가한다
- **빌드:** `cd site && npm run build` (prebuild가 다이어그램을 `site/public/diagrams/`로 동기화 — 생성물이므로 커밋 금지)
- **린트/포맷(선택):** `cd site && npm run lint` (oxlint)
- **브라우저·런타임 관찰 필요?** 예 — site/·web/ 변경은 preview 도구로 실제 렌더까지 확인. 특히 다이어그램 뷰어(iframe+스케일)와 md 렌더는 마크업 변화에 민감

---

## 4. 아키텍처 불변식 (invariants)
`[읽는 이: planner · plan-reviewer · developer · reviewer · architecture-guide]`

> 이 프로젝트에서 **어기면 버그**인 규칙들. 형식: `규칙 — 왜(안 지키면 뭐가 터지나)`.
> 상세 근거는 10번(데이터플로우)·11번(역할분담)·adr/ 문서.

- 미디어 바이너리는 전부 S3, PostgreSQL엔 메타데이터·상태·포인터만 (ADR-005) — DB에 바이너리를 넣는 순간 용량·쓰기량이 폭발한다
- 채팅 원문은 DB 저장 금지 — S3 아카이브 + 윈도우 단위 집계(chat_metrics)만 PG로. 원문을 넣으면 방송 피크에 쓰기량 폭발
- Media Origin은 방송 생명주기 이벤트(`broadcast.started/ended`)만 발행, 렌더·AI·업로드 잡 생성은 Clip Service 전담 — 인제스트 노드가 비즈니스 로직에 결합되면 장애 복구 범위가 커진다
- 워커는 DB 직접 쓰기 금지 — AI 결과는 Clip Service API 경유(계약 8). 우회하면 스키마 오너(3번)의 통제 밖에서 상태가 변한다
- recipes(영구)와 clips(재렌더 가능 산출물)의 분리 유지 — "레시피는 영구, 렌더물은 60일 내 재렌더" 정책이 테이블 구조 그 자체
- 실시간성 데이터는 Redis, "새로고침해도 남아야 하는 것"만 PG — 경계를 흐리면 PG가 실시간 부하를 맞는다
- 인터페이스 계약 우선 — 서비스 경계(5장의 계약 8종)를 먼저 확정·문서화한 뒤 구현. 계약 변경은 승인권자(스키마=3번 · 인프라/큐=1번 · UI/UX=2번) 승인 필수
- 결정 변경은 새 ADR 추가 + 기존 ADR에 "대체됨 → ADR-XXX" 포인터 — 기존 ADR 삭제 금지 (예: ADR-013 → ADR-015)
- 다이어그램 HTML 수정 시 노드 id·`wire('idA','idB')` 패턴 구조 유지 — 뷰어 사이트가 이를 파싱해 인터랙션을 만든다. 수정 후 PNG 재렌더 필요
- 유튜브 토큰 원문은 DB 저장 금지 — Secrets Manager 보관, DB엔 참조만

---

## 5. 경계면 맵 (boundaries)
`[읽는 이: planner · plan-reviewer · reviewer]`

> 데이터 shape이 계층을 넘나드는 지점. 정본은 11번 문서의 인터페이스 계약 8종.
> 형식: `경계: A ↔ B — 공유 계약/타입 위치`.

- SQS 잡 메시지 (렌더·AI·업로드): Clip Service ↔ 워커들 — 계약 1 (스키마 초안: 10번 문서 2장, 3번이 오너)
- 점프카드 SSE + 채팅 차트 API: Clip Service ↔ 웹 대시보드 — 계약 2
- LL-HLS/DVR 재생 URL·매니페스트: Media Origin ↔ 플레이어 — 계약 3 (M1 0단계에서 확정)
- 스트림 키: 발급=Auth ↔ 검증=Media Origin — 계약 4
- 유튜브 토큰: 보관=Auth ↔ 사용=업로드 워커 — 계약 5
- 레시피 JSON 스키마 (crop·트랙·자막): 웹 ↔ Clip Service ↔ 렌더 워커 — 계약 6 (**최우선 확정**)
- FFmpeg 구간 디코드 커맨드 스펙: 1번 제공 → 에디터 서버(3번) — 계약 7
- AI 결과 반영 API: AI Worker → Clip Service — 계약 8 (DB 직접 쓰기 금지)
- site/ ↔ 루트 문서: 파일명·다이어그램 HTML의 wire()/id 구조가 사실상의 계약 — `site/src/lib/{content,links}.ts`가 참조. 새 루트 문서(N번) 추가 시 README 표 + content/links + App.tsx 라우트 + 네비 갱신

---

## 6. 배포·운영 모델 (ops)
`[읽는 이: completion-auditor · change-explainer]`

> **"머지 = 사용자 화면 반영"이 아닐 수 있는 지점.**

- **site/ (문서 뷰어):** main push → Vercel 자동 배포 (https://poke-clip-architecture.vercel.app, Root Directory=site). **브랜치·PR 단계에선 반영 안 됨** — 머지 후 배포 완료까지가 "반영". 확인법: 배포 URL에서 변경 내용 실제 확인
- **문서(루트 md·다이어그램):** 문서만 고쳐도 main 머지 시 사이트에 자동 반영 — 문서 작업의 "운영 반영"은 곧 사이트 반영
- **서비스 코드:** 운영 배포 파이프라인 미구축 (M1은 docker-compose 로컬, CI/CD=I2·prod=I7은 1번 담당) — 당분간 "머지 = 운영 반영 아님"이 기본값
- **로컬 개발:** `cd site && npm run dev` (문서 뷰어) · M1부터 `docker-compose` (PG·Redis·Media — I1)

---

## 7. 버전관리 정책 (vcs)
`[읽는 이: pr-author · pr-reviewer]`

- **기본 브랜치:** main — **보호됨**: 직접 push 금지, PR + 승인 리뷰 1명 + 리뷰 코멘트 해결 필수
- **브랜치 전략:** 기능마다 기본 브랜치에서 새 브랜치 → PR → **squash merge**. 스택 PR 금지(앞 PR 머지 시 base 삭제로 뒤 PR이 닫히는 사고).
- **한 PR = 한 논리적 변경** — squash 후 커밋 하나 `revert`로 롤백.
- **커밋/PR 제목:** Conventional Commits (`feat:`·`fix:`·`refactor:`·`docs:`·`test:`·`chore:`·`perf:`). 본문은 한국어(기존 이력 관례).
- **머지 주체:** 사용자 승인 후에만. 계약·스키마·인프라를 건드리는 PR은 해당 승인권자 리뷰 필수.
- **프로젝트 예외:** 팀원(jaehwan-space·kth4778)과 공유하는 저장소 — PR 설명은 팀원이 읽는 문서로 취급

---

## 8. 도메인 예시 (examples)
`[읽는 이: clarifier · 오케스트레이터 테스트 시나리오]`

- _"점프카드 만료 처리해줘"_ → 라이브 스트립에서의 만료(expires_at·SSE 제거)인가, VOD 챕터 재활성인가? Clip Service(3번) 작업인가 프론트(2번) 작업인가? — 상태·오너 경계가 숨어 있음
- _"DVR 시킹이 안 돼요 고쳐줘"_ → Media Origin의 세그먼트/매니페스트 문제인가, 플레이어(hls.js) 설정 문제인가? — 계약 3의 양쪽을 동시에 열어야 하고, G2 폴백 판정(12번 문서)과도 얽힘
- _"자막 품질 좀 올려줘"_ → faster-whisper 모델/vad 튜닝(E4)인가, 자막 UI 표시(E5)인가, 렌더 번인(F2)인가? — 세 오너에 걸침

---

## 9. 참고 — 전역 의존 (이 프로젝트가 기대는 참조 시스템)
`[정보용: 사람이 읽는 메모. 에이전트는 각자 필요한 참조를 직접 호출]`

- **ECC 룰:** `~/.claude/rules/ecc/` — 언어 일반 코딩/테스트/보안 표준(항상 로드).
- **superpowers 스킬(참조, 복사 아님):** developer→`test-driven-development`·`receiving-code-review`, completion-auditor→`verification-before-completion`, clarifier→`brainstorming`, 디버깅→`systematic-debugging`.
- **claude-mem:** 세션 히스토리 자동 캡처 + 검색. ecc:planner·clarifier가 착수 전 "전에 이거 풀었나" 검색.
- **파일 메모리:** 하중지지 사실(핵심 규칙·확정 결정·로드맵)은 `~/.claude/projects/<proj>/memory/`(항상 로드). 이 프로필도 하중지지 사실이다.
