# ADR-016: 방송 생명주기 이벤트 — SNS FIFO + 소비자별 SQS FIFO

- **상태**: 채택
- **결정일**: 2026-07-22
- **관련**: [ADR-005](ADR-005_저장일원화.md) · [ADR-013](ADR-013_인프라.md)
- **반영 산출물**: 3_SA · 4_SysA · 5_CA · 9_기능명세 · 10_데이터플로우 · 11_역할분담 · 12_M1실행계획

## 컨텍스트

Media Origin이 발행하는 `broadcast.started`와 `broadcast.ended`는 Chat Collector와 Clip Service가 각각 받아야 한다. 단일 SQS 큐에 두 소비자를 연결하면 경쟁 소비가 되어 한 메시지를 둘 중 하나만 받을 수 있다. Media Origin이 두 큐에 직접 이중 발행하면 한쪽만 성공하는 부분 실패를 인제스트 노드가 복구해야 해, 생명주기 사실만 발행한다는 경계를 깨뜨린다.

같은 `streamId`의 시작·종료 순서는 보존해야 하고, SNS/SQS의 at-least-once 전달에서도 소비 결과가 중복되지 않아야 한다.

## 결정

- Media Origin은 방송 사실마다 논리 이벤트 하나를 만들고 `broadcast-lifecycle.fifo` **SNS FIFO Topic**에 publish한다. 네트워크 타임아웃·실패로 결과가 불명확하면 새 이벤트를 만들지 않고 동일한 `eventId`로 재시도한다.
- SNS는 Raw Message Delivery로 다음 소비자 전용 FIFO 큐에 팬아웃한다.
  - `broadcast-lifecycle-chat.fifo` + 전용 DLQ → Chat Collector
  - `broadcast-lifecycle-clip.fifo` + 전용 DLQ → Clip Service
- 발행 시 `MessageGroupId=streamId`, `MessageDeduplicationId=eventId`를 사용한다. 같은 논리 이벤트의 재시도는 반드시 동일한 `eventId`를 유지한다.
- 계약 9 envelope는 `schemaVersion`, `eventId`, `eventType`, `occurredAt`, `streamId`, `streamerId`, `sequence`, `traceId`, `payload`를 가진다.
- `broadcast.started` payload의 `trackManifest`는 Media Origin이 보유한 A3 등록본의 `manifestVersion` 스냅샷이다.
- 각 소비자는 `eventId`를 멱등 키로 처리하고 상태를 `INITIAL → LIVE → ENDED` 방향으로만 전이한다.
- 방어적으로 `INITIAL`에서 `broadcast.ended`를 받으면 Clip Service는 ended placeholder를 PostgreSQL에 upsert하고, Chat Collector는 Redis에 `ENDED` tombstone(TTL 24h)을 남긴 뒤 ack와 알람을 수행한다. 이후 더 낮은 `sequence`의 started는 무시한다. 처리 예외만 DLQ로 이동한다.

## 결과

- Chat Collector와 Clip Service가 같은 이벤트를 독립적으로 받고 재시도·장애 격리도 분리된다.
- Media Origin은 소비자 목록과 큐별 부분 실패를 알 필요가 없다.
- FIFO Topic 구독 대상은 SQS FIFO로 제한되지만 현재 소비자는 두 서비스뿐이며 필요한 처리량에 충분하다.

## 검토한 대안

- **단일 SQS + 다중 소비자**: 경쟁 소비라 두 서비스에 동일 이벤트를 보장하지 못해 기각.
- **Media Origin의 두 큐 직접 발행**: 부분 성공 복구와 소비자 결합이 Media Origin에 들어가므로 기각.
- **EventBridge**: 규칙 기반 라우팅·다수 SaaS 연계가 필요한 단계가 아니어서 현재 범위에는 과함.
- **Standard SNS/SQS**: 처리량은 충분하지만 started/ended 역전 보정 로직이 불필요하게 커져 기각.
