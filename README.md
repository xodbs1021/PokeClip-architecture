# PokeClip — 아키텍처 산출물

스트리밍 하이라이트·클립 자동화 서비스 **PokeClip**의 설계 산출물 저장소.

OBS 플러그인이 본방(치지직/SOOP)과 병행으로 멀티오디오(~10트랙) 방송을 SRT+MPEG-TS로 동시 송출하고, 채팅 반응 분석으로 하이라이트를 실시간 포착해 **방송이 끝나기 전에 클립이 올라가는** — 그것도 브금(BGM) 없는 트랙 조합으로 — 파이프라인을 목표로 한다. 치지직 타임머신·클립 기능을 벤치마킹.

## 산출물

| # | 산출물 | 파일 |
|---|---|---|
| 0 | 유스케이스 다이어그램 | [PNG](0_Pokeclip_UseCase.png) · [HTML](0_Pokeclip_UseCase.html) |
| 1 | IA (정보 구조) | [PNG](1_Pokeclip_IA.png) · [HTML](1_Pokeclip_IA.html) |
| 2 | 유저 저니 | [PNG](2_Pokeclip_UserJourney.png) · [HTML](2_Pokeclip_UserJourney.html) |
| 3 | SA (서비스 아키텍처) | [PNG](3_Pokeclip_SA.png) · [HTML](3_Pokeclip_SA.html) |
| 4 | SysA (시스템 아키텍처) | [PNG](4_Pokeclip_SysA.png) · [HTML](4_Pokeclip_SysA.html) |
| 5 | CA (클라우드 아키텍처, AWS · Target Production) | [PNG](5_Pokeclip_CA.png) · [HTML](5_Pokeclip_CA.html) · [설계 노트](5_Pokeclip_CA.md) |
| 6 | 설계 결정 인덱스 (ADR 현황판) | [6_Pokeclip_설계결정.md](6_Pokeclip_설계결정.md) |
| 7 | 기획서 (사업 — 소마 심사용) | 작성 예정 |
| 8 | 하이라이트 탐지 연구 노트 (팀 실측) | [8_Pokeclip_하이라이트연구노트.md](8_Pokeclip_하이라이트연구노트.md) |
| 9 | 기능 명세서 (기술 멘토 리뷰용) | [9_Pokeclip_기능명세서.md](9_Pokeclip_기능명세서.md) |
| 10 | 데이터 플로우 (SQS·DB 설계 초안) | [10_Pokeclip_데이터플로우.md](10_Pokeclip_데이터플로우.md) |
| 11 | 역할 분담 (3인 · 인터페이스 계약) | [11_Pokeclip_역할분담.md](11_Pokeclip_역할분담.md) |
| 12 | M1 수직 슬라이스 실행 계획 | [12_Pokeclip_M1실행계획.md](12_Pokeclip_M1실행계획.md) |
| — | 결정별 ADR 15건 | [adr/](adr/) |

다이어그램은 self-contained HTML로 작성 후 PNG로 렌더링한다(HTML이 원본). 설계 결정은 ADR 체계로 관리 — 결정이 뒤집히면 삭제하지 않고 `대체됨 → ADR-XXX`로 이력을 보존한다.

## 다이어그램 미리보기

### 0. 유스케이스
![UseCase](0_Pokeclip_UseCase.png)

### 1. IA
![IA](1_Pokeclip_IA.png)

### 2. 유저 저니
![UserJourney](2_Pokeclip_UserJourney.png)

### 3. 서비스 아키텍처
![SA](3_Pokeclip_SA.png)

### 4. 시스템 아키텍처
![SysA](4_Pokeclip_SysA.png)

### 5. 클라우드 아키텍처 (AWS ap-northeast-2)
![CA](5_Pokeclip_CA.png)

## 참고 자료

`*_FillMap_*.png` 는 산출물 형식 참고용 레퍼런스 다이어그램(타 프로젝트 예시)이다.
