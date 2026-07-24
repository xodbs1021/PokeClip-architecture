# Pokeclip 데이터 플로우 — Media Origin → SQS → ECS → PostgreSQL

**이 문서의 목적**: 이벤트·잡 큐를 중심으로 한 백엔드 데이터 흐름을 4단계(① Media EC2→SQS ② SQS→ECS ③ ECS→PostgreSQL ④ 테이블 설계)로 정리한다. 스키마는 대시보드 화면에서 역산한 **구현 착수용 초안**이며, 확정 시 ADR로 승격한다.

**같이 볼 문서**: [3_SA](3_Pokeclip_SA.html) · [4_SysA](4_Pokeclip_SysA.html) · [5_CA](5_Pokeclip_CA.html) · [ADR-005 저장 일원화](adr/ADR-005_저장일원화.md) · [ADR-006 PostgreSQL](adr/ADR-006_DB_PostgreSQL.md) · [ADR-014 비용 모델](adr/ADR-014_비용모델.md) · [ADR-016 이벤트 전달 보증](adr/ADR-016_방송이벤트전달보증.md)

---

## 1. Media EC2 → SQS — 방송 생명주기 이벤트만 발행

**원칙**: Media Origin은 "일을 시키는" 쪽이 아니라 **"사실을 알리는" 쪽**이다. 스테이트풀한 인제스트 노드는 최대한 단순해야 하므로(CA의 HA 원칙 — 피해 최소화), 무거운 작업 지시는 하지 않고 방송 생명주기 이벤트만 발행한다.

| 메시지 | 등급 | 페이로드 (예) | 왜 필요한가 |
|---|---|---|---|
| `broadcast.started` | **Critical** | streamId, streamerId, startedAt, 트랙 매니페스트(오디오 트랙 수·라벨) | 파이프라인 전체의 시동키 — 채팅 수집 시작 트리거, 라이브 상태 등록, 대시보드 "방송 중" 전환. **유실 시 방송 전체 클립 0** |
| `broadcast.ended` | High | streamId, endedAt, 최종 세그먼트 범위 | 채팅 수집 종료, VOD 확정 처리(매니페스트는 Media가 S3에 확정, 레코드 생성은 백엔드), 종료 직후 리포트 |

렌더·AI·업로드 잡은 Media EC2가 넣지 않는다 — 그것은 Clip Service의 역할이다. Media가 잡까지 만들면 인제스트 노드가 비즈니스 로직에 결합되고, 장애 시 복구 범위가 커진다.

**전달 보증**([ADR-016](adr/ADR-016_방송이벤트전달보증.md)): 위 두 이벤트는 등급이 다르다. `broadcast.started`(Critical)는 재시도를 넉넉히·DLQ 1건이라도 즉시 알람·상태 재조정을 적용한다. 라이브 여부의 정본은 이벤트가 아니라 `Redis Live State` + 진행 중 SRT 연결에 두어(불변식), 이벤트 유실이 영구 손실이 아닌 **복구 가능한 지연**이 되게 한다. `started` 핸들러는 멱등(이미 라이브면 no-op)이라 redrive·재조정·중복 수신에 안전하다.

## 2. SQS → ECS — 큐별 생산자·소비자 매핑

SQS는 "맡기는 주체"가 아니라 **생산자와 소비자 사이의 버퍼**다.

| 큐/타입 | 생산자 | 소비자 (ECS) | 하는 일 |
|---|---|---|---|
| 방송 이벤트 | Media EC2 | Chat Collector | 치지직·SOOP 채팅 수집 시작·종료, 시차 보정 타임라인 정렬 |
| 방송 이벤트 | Media EC2 | Clip Service | broadcasts 레코드 생성·종료 처리, VOD 레코드 확정 |
| 렌더 잡 | Clip Service (레시피 저장·원클릭 시) | Render·Upload Worker | FFmpeg 렌더 — 구간 컷·비율 5종 크롭·자막 번인·amix·-14 LUFS |
| AI 잡 | Clip Service | AI Worker | faster-whisper 자막(선택 트랙, vad_filter) → 추천 제목 → 결과 저장·상태 갱신 |
| 업로드 잡 | Clip Service (렌더·승인 완료 시) | Render·Upload Worker | YouTube resumable 업로드(스트리머 토큰), CC 등록, 일일 쿼터 관리·재시도 |

**왜 큐인가**: 렌더·AI는 클립당 수십 초 걸리는 배치 작업이다. 동기 호출이면 방송 피크 때 API가 밀리지만, 큐면 ① 워커만 오토스케일하면 되고 ② 실패 시 재시도가 공짜이며(SQS 재전달) ③ 하이라이트가 몰려도 백프레셔로 흡수된다.

## 3. ECS → PostgreSQL — 메타데이터·상태·포인터만

**대원칙** (ADR-005 저장 일원화와 일관): 미디어 바이너리는 전부 S3, PostgreSQL엔 **메타데이터·상태·포인터만** 저장한다.

| 서비스 | 저장하는 것 | 저장하지 않는 것 |
|---|---|---|
| Auth·Account | 계정, 편집자 권한, 채널 연동, 스트림 키(**streamid 해시**) | 유튜브 토큰·**SRT passphrase 원문** (→ Secrets Manager, DB엔 참조만 — [ADR-018](adr/ADR-018_스트림키저장분리.md)) |
| Clip Service | 방송 세션, 점프카드, 레시피(영구), 클립 상태, 템플릿, 승인 이력 | 영상 파일 (→ S3 키만) |
| Chat Collector | 윈도우 단위 집계(채팅량·참여율), 하이라이트 점수 | 채팅 원문 (→ S3 아카이브 — DB에 넣으면 쓰기량·용량 폭발) |
| Render/AI Worker | 잡 상태(재시도·에러), 자막 메타, 추천 제목, 업로드 결과 | 자막 파일 본문 (→ S3, DB엔 키) |

실시간성 데이터(SRT 송출 통계, SSE 팬아웃, 라이브 차트 캐시)는 Redis 담당이고, PG는 "새로고침해도 남아야 하는 것"만 맡는다.

## 4. 테이블/컬럼 설계 — 대시보드 역산 (초안)

```sql
-- 계정·권한 (Auth·Account)
users          (id PK, google_sub UNIQUE, email, display_name, role, created_at)
channels       (id PK, user_id FK, platform 'chzzk'|'soop', channel_ext_id, name, connected_at)
editor_grants  (id PK, streamer_id FK, editor_id FK, can_upload bool, can_auto_upload bool,
                invited_at, accepted_at)                     -- 권한 토글 2종이 컬럼으로
stream_keys    (id PK, user_id FK, streamid_hash, passphrase_ref, active bool, created_at)
               -- ADR-018: streamid는 해시(대조용), passphrase 원문은 Secrets Manager·PG엔 참조만

-- 방송·하이라이트 (Clip Service)
broadcasts     (id PK, streamer_id FK, started_at, ended_at, status 'live'|'ended'|'vod_ready',
                track_manifest jsonb, vod_expires_at)        -- 남은 보관일 = vod_expires_at 역산
jump_cards     (id PK, broadcast_id FK, source 'hotkey'|'auto', ts_in_stream, score,
                created_at, expires_at)
recipes        (id PK, broadcast_id FK, creator_id FK, in_ts, out_ts, aspect, crop jsonb,
                audio_tracks int[], subtitle_track, template_id FK, created_at)  -- 영구 보존
clips          (id PK, recipe_id FK, status 'draft'|'rendering'|'awaiting_approval'|'approved'
                |'rejected'|'uploading'|'uploaded'|'failed', s3_key, rejected_reason, updated_at)
templates      (id PK, streamer_id FK, name, aspect, subtitle_style jsonb, audio_tracks int[],
                visibility, created_at)

-- 잡·산출물 (Workers)
jobs           (id PK, type 'render'|'ai'|'upload', clip_id FK, status, attempt, last_error,
                queued_at, started_at, finished_at)
subtitles      (id PK, clip_id FK, track_no, srt_s3_key, model, created_at)
suggested_titles (id PK, clip_id FK, title, rank)
upload_results (id PK, clip_id FK, youtube_video_id, cc_registered bool, quota_units, uploaded_at)

-- 채팅 집계 (Chat Collector)
chat_metrics   (broadcast_id FK, window_start, msg_count, uniq_chatters, participation,
                PK(broadcast_id, window_start))              -- 라이브 차트가 이 테이블을 그대로 그림
```

### 대시보드 화면 ↔ 테이블 매핑

| 화면 (1_IA 기준) | 읽는 테이블 |
|---|---|
| 라이브 뷰 — 점프카드 스트립 | jump_cards (SSE 푸시, 만료 = expires_at) |
| 라이브 뷰 — 채팅량 차트 | chat_metrics (실시간 구간은 Redis 캐시 → 종료 후 PG) |
| 클립 보관함 (렌더 중·대기·완료) | clips.status + jobs (진행률·에러) |
| 승인 대기함 | clips WHERE status='awaiting_approval' + recipes.creator_id |
| 업로드 결과 (링크·재시도) | upload_results + jobs WHERE type='upload' |
| VOD 목록 (남은 보관일) | broadcasts (vod_expires_at) + jump_cards (챕터 재활성) |
| 재편집 | recipes (파라미터 복원 → 재렌더 = 새 jobs) |
| 운영 콘솔 | jobs 실패 집계, users·broadcasts 사용 통계 |

### 설계 포인트

- **clips.status가 사실상 상태 머신** — 보관함·승인함·업로드 화면이 전부 이 컬럼 하나로 필터된다. 인덱스 필수 (`clips.status`, `jump_cards(broadcast_id, ts_in_stream)`, `jobs.status`).
- **recipes와 clips의 분리가 핵심** — "레시피는 영구, 렌더물은 60일 내 재렌더"라는 정책이 그대로 테이블 구조가 된 것.
- **jsonb vs 정규 컬럼** — 구조가 유동적인 것(track_manifest·crop·subtitle_style)은 jsonb, 필터·조인에 쓰이는 것은 정규 컬럼으로 선을 지킨다.
