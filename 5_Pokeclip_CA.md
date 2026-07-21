# 5_CA — Target Production Cloud Architecture (설계 노트)

> `5_Pokeclip_CA.html` / `.png` 의 판단 근거. AWS 공식 아이콘 스타일·존 위계(Region>VPC>AZ-A/B>Subnet)·엣지 프로토콜 표기를 갖춘 발표/멘토 리뷰용 상세본. (초기 EDGE-SA 톤 모노크롬본은 git 이력에 보존)

## Source of Truth
README · 3_SA · 4_SysA · 5_CA · 6_설계결정 · 9_기능명세서 · 10_데이터플로우 · adr/(특히 ADR-003·005·013·015). 최신 ADR·기능명세서 우선.

## 문서 불일치·해석 목록 (임의 선택 대신 최신 ADR 우선 + 근거 주석)

1. **CDN 분기** — ADR-013은 CDN을 2분기(Akamai 본선 / CloudFront 폴백)로 병기했으나 **ADR-015가 CloudFront 전용으로 확정(2026-07-21)**. → 다이어그램은 CloudFront 단일, 오리진 분리(라이브=Media EC2 / VOD·클립=S3). Akamai 미표기. (부제에 ADR-015 명시)
2. **워커 → DB 쓰기 경로** — 10_데이터플로우 3장 표는 "Render/AI Worker가 잡 상태·자막 메타·추천 제목을 저장"으로 읽혀 워커→PostgreSQL 직접 쓰기로 오해될 수 있음. 그러나 아키텍처 불변식·계약 8("AI 결과 반영 API, 워커→Clip Service, **DB 직접 쓰기 금지**")이 정본. → 다이어그램은 **워커→PostgreSQL 직접 엣지를 그리지 않고**, `svc-render→svc-clip`(계약1 잡 상태·업로드 결과), `svc-ai→svc-clip`(계약8 AI 결과 반영 API)로 배선. 미디어/자막 산출물의 S3 PUT은 ADR-005상 정당하므로 유지(`svc-render→s3-clip`, `svc-ai→s3-arch`).
3. **HA 수준** — 9_기능명세 I6은 "RDS Multi-AZ·ElastiCache 리플리카(데모 전)" P1, ADR-013은 "HA 실적용". → 메인 그림은 **Target Production = Multi-AZ**(RDS Multi-AZ, Redis Primary+Replica, AZ별 서브넷·NAT). MVP(dev)는 하단 주석으로 분리.
4. **SRT 이중 경로(Dual Ingest)** — ADR-013이 "SRT 이중 경로는 향후 확장으로 문서화", 6_인덱스 미결 항목에도 "SRT 이중 경로 인제스트 — 확장 로드맵". → AZ-B Public Subnet에 `SRT Dual Ingest · Standby`를 **점선(Future Expansion, MVP 미적용)**으로만 표기. 이중 액티브를 구현된 것처럼 그리지 않음.
5. **Media Origin 배치** — ADR-013 "Media = EC2 단독(스테이트풀 UDP, 오케스트레이션 부적합)". → `media-ec2`는 ECS Fargate에 넣지 않고 Public Subnet EC2로 표기. 내부 8모듈은 노드 안 파이프라인 칩(위→아래)으로.

## 주요 설계 판단 (레이아웃·표현)

- **자체 미디어 계층 유지(ADR-003/013)** — MediaLive/MediaPackage/MediaConvert/Transcribe로 대체하지 않음. Media EC2 내부에 SRT Listener→MPEG-TS Demuxer→Multi-Audio Track Mapper→CMAF Segmenter→LL-HLS Origin·DVR→S3 Segment Uploader→Broadcast Lifecycle Publisher를 명시. 부제에 "의도적 배제" 문구.
- **진입 분리** — HTTP/HTTPS(Route53→CloudFront/WAF→ALB→ECS)와 SRT UDP(OBS→SRT Entry EIP→Media EC2, UDP 9000)를 완전히 분리. ALB는 SRT를 처리하지 않음을 구조·라벨로 명시("HTTP/HTTPS · SRT 미처리").
- **OBS 이중 송출** — OBS→본방 플랫폼(CHZZK/SOOP 본방, 굵은 미디어선 "본방 송출")과 OBS→PokeClip Media Origin(SRT+MPEG-TS·UDP 9000·~10 Audio)을 별도 경로로.
- **SQS 분해** — 단일 박스 대신 방송이벤트·렌더·AI·업로드 4큐 + 각 큐 DLQ(대표 격리 엣지 + "각 큐 DLQ" 표기). 생산자·소비자 화살표: Media→방송Q, 방송Q→Chat·Clip(팬아웃), Clip→렌더/AI/업로드Q, 렌더/업로드Q→Render·Upload Worker, AIQ→AI Worker. 멱등성 키·재시도·DLQ 주석.
- **VPC 서브넷 순서 = Public(Media)|Data|App** — 레퍼런스(Public|App|Data)와 달리 App을 우측(외부 플랫폼 열 인접)에 배치해 외부 API 연결선을 짧게 유지하고, 서비스→데이터(좌측) 접근은 하단 클리어 레인으로 우회(노드 관통 0 유지 목적).
- **선 스타일 규약** — 실선=동기/실시간 스트림, 점선=비동기 이벤트/잡 큐, 굵은선=미디어(SRT·CMAF·HLS), 얇은선=제어/메타, 초록=CI/CD. 범례 박스로 명시. 모든 주요 연결에 프로토콜/데이터 종류 라벨.
- **외부 API × NAT** — 우측 논리 연결선(대상·프로토콜)과 NAT 구조(app→NAT→IGW)를 병기. 주석: "Private Subnet 아웃바운드 = NAT Gateway → IGW".
- **CI/CD** — GitHub Monorepo→Actions(Test/Build)→ECR→ECS Rolling(Clip 등) / Actions→SSM Run Command→Media EC2(별도 경로). 별도 색(초록).

## MVP(dev) vs Target Production

| 항목 | Target Production (그림 본체) | MVP(dev, 하단 주석) |
|---|---|---|
| Media | AZ-A EC2 + AZ-B Future Dual Ingest(미적용) | EC2 1대 |
| ECS | Multi-AZ 태스크 분산(AZ-A 상세 + AZ-B 리플리카) | 최소 태스크 |
| RDS | Multi-AZ(Primary + Standby 자동 페일오버) | dev Single-AZ(micro) |
| Redis | Primary + Replica(자동 승격) | 단일 |
| NAT | AZ별(비용 절충 시 공유) | 최소 |
| SRT Dual Ingest | Future Expansion(점선) | 미적용 |

## 스펙 10개 영역 반영 확인

1. Customer Environment — Streamer/Editor(채운 실루엣)·OBS Plugin·React Web Dashboard·CHZZK/SOOP 본방·SRT 표기 ✅
2. Edge/Public Entry — Route53·CloudFront·WAF·IGW·ALB·SRT Entry(EIP UDP9000), HTTP와 SRT 분리 ✅
3. Media Ingest/Origin — 8모듈 파이프라인 칩 + 흐름, 생명주기 이벤트만 SQS 발행 ✅
4. Application/Worker — Auth·Clip·Chat·Render·Upload·AI 각 책임 표기(ECS Fargate Cluster) ✅
5. 비동기/큐 — 4큐+DLQ, 생산자·소비자 화살표, 멱등성·재시도 주석 ✅
6. Data — RDS(테이블·메타만)·Redis(실시간)·S3(논리 3버킷, CMAF 한 벌 공유 ADR-005) ✅
7. 콘텐츠 제공 — CloudFront 오리진 분리(라이브=Media/VOD=S3), TTL 주석 ✅
8. 외부 플랫폼 — Google·YouTube·CHZZK·SOOP·Discord + NAT 경유 ✅
9. 운영/보안 — CloudWatch(9종 알람)·Secrets·IAM·KMS·WAF·SG·Private DB ✅
10. CI/CD — GitHub→Actions→ECR→ECS / SSM→Media, 환경 전략 주석 ✅

## 검증 수치

- 기하 전수 관통 검사(세그먼트×`.aws`/`.actor` rect, 3px 인셋): **0**
- 전 svg 직계 커넥터 합 == `wire()` 호출 수: **52 == 52**
- `site` `npx tsc -b`: **exit 0**
- 렌더 PNG 5760×3480(캔버스 3840×2320, DPR 1.5) — 라벨 겹침·잘림 육안 검수 후 2건(본방 송출·Artifact) 수정 재렌더
- site 뷰어 5번으로 등록(`content.ts` DIAGRAMS num 5 · `content/diagrams/5.md` 문서 뷰)

## 검증 스크립트
헤드리스 `--dump-dom`으로 HTML 내장 `#selftest`(관통·커넥터 수) 판독. HTML 자체가 자가검증을 담고 있어 재현 가능.
