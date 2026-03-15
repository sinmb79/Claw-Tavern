# Claw Tavern Agent Worker 연동 명세

## 역할

에이전트 워커는 Base 체인의 `TavernEscrow` 이벤트를 감시하고, OpenClaw Gateway에 작업을 전달하며, 결과 제출 후 후속 상태를 모니터링한다.  
평가 제출은 최종적으로 의뢰인 지갑이 서명해야 하지만, 워커/백엔드는 평가 데이터 구조와 온체인 호출 포맷을 제공해야 한다.

---

## 메인 루프

```typescript
async function main() {
  await Promise.all([
    heartbeatLoop(),
    questPollLoop(),
    settlementWatchLoop(),
  ]);
}
```

### heartbeatLoop

- 30분마다 `TavernAttendance.heartbeat()` 또는 대응 헬스체크 트랜잭션 호출
- 실패 시 최대 3회 재시도
- 48시간 타임아웃 구간에 진입한 잡은 별도 경고 로그 기록

### questPollLoop

- `QuestCreated`, `QuestFunded` 또는 오프체인 매칭 큐 감시
- 처리 가능 조건:
  - 지원 카테고리 일치
  - 남은 시간 충분
  - 현재 동시 처리 수 `< MAX_CONCURRENT`
- 수락 성공 시 `acceptQuest()`
- 작업 시작 즉시 `recordHeartbeat()`

### settlementWatchLoop

- `QuestSubmitted`
- `QuestEvaluated`
- `QuestAutoApproved`
- `QuestCompensated`
- `QuestTimedOut`

이 다섯 이벤트는 워커의 잡 상태를 terminal 또는 follow-up 상태로 갱신하는 기준이다.

---

## 결과 제출 플로우

```text
1. acceptQuest(questId)
2. recordHeartbeat(questId)
3. OpenClaw execute
4. 결과를 IPFS/스토리지에 업로드
5. submitResult(questId, resultHash, resultUri)
6. 이후 평가는 의뢰인 측 UI/서비스에서 submitEvaluation 처리
```

결과 제출 후 워커는 직접 정산하지 않는다.  
정산, 자동 승인, 보상전환은 모두 `TavernEscrow` 상태 전이에 따른다.

---

## submitEvaluation 연동

### 호출 주체

`submitEvaluation()`의 최종 호출자는 의뢰인 지갑이다.  
다만 워커 또는 API 계층은 평가 입력을 아래 형식으로 정규화해 프론트엔드에 전달해야 한다.

```solidity
function submitEvaluation(
    uint256 questId,
    uint8[5] calldata scores,
    string calldata comment,
    string[] calldata tags
) external
```

### 5축 점수 배열 순서

배열 순서는 고정이다.

```text
scores[0] = 요구사항 충족
scores[1] = 정확성
scores[2] = 실행가능성
scores[3] = 커뮤니케이션
scores[4] = 재의뢰 의향
```

각 값은 `1~5` 범위만 허용한다.

### 클라이언트 측 직렬화 예시

```typescript
type EvaluationScores = [number, number, number, number, number];

function buildScores(input: {
  taskCompletion: number;
  accuracy: number;
  practicality: number;
  communication: number;
  rehireIntent: number;
}): EvaluationScores {
  return [
    input.taskCompletion,
    input.accuracy,
    input.practicality,
    input.communication,
    input.rehireIntent,
  ];
}
```

### 평가 보상 규칙

```text
5축만 제출                      +1 TVRN
5축 + 50자 이상 코멘트          +3 TVRN
5축 + 100자 이상 코멘트 + 태그  +5 TVRN

월 누적 1~10건   100%
월 누적 11~20건   50%
월 누적 21~30건   20%
월 누적 31건+      0%
동일 에이전트 대상 보상은 월 3회 상한
```

워커는 평가 저장 성공 후 아래 값을 로깅하면 된다.

```text
questId
client
agent
avgScore
rewardTier
tags
```

---

## recordResultViewed 연동

### 호출 타이밍

실제 호출자는 결과물을 여는 의뢰인 지갑이다.  
워커/백엔드는 아래 시점 중 최초 1회만 `recordResultViewed(questId)`를 트리거하도록 클라이언트에 안내한다.

- 결과 상세 페이지 최초 진입
- 다운로드 버튼 클릭
- `resultUri` 외부 링크 최초 오픈

### 중요한 점

- `recordResultViewed()`는 평가 전에 먼저 호출될 수 있다.
- 이 값은 보상전환 비율 계산에 직접 쓰인다.
- 미열람 + 평균 1점은 더 높은 보상전환 비율을 사용한다.

### 권장 처리

```typescript
if (!quest.resultViewedAt) {
  await escrow.write.recordResultViewed([questId]);
}
```

중복 호출은 피하되, 이미 기록된 경우 UI에서 조용히 무시해도 된다.

---

## Compensated 상태 처리

`Compensated`는 워커 입장에서 terminal state다.

### 원인

- `TimedOut` 이후 자동 보상전환
- 제출은 했지만 평균 2점 이하
- 미열람 상태에서 평균 1점

### 워커가 해야 할 일

```text
1. 해당 잡을 즉시 종료 상태로 마킹
2. 이후 재제출/재시도 큐에서 제거
3. 늦은 submitResult 시도 차단
4. 에이전트에게 정산 없음, 평판 패널티 발생을 알림
5. 운영 로그에 compensation reason 기록
```

### 권장 로그 필드

```typescript
type CompensationLog = {
  questId: number;
  agent: string;
  reason: 'timeout' | 'unviewed_one_star' | 'low_score';
  tvrnAmount: string;
  creditAmountUsd: string;
  unlockAt?: number;
};
```

### 늦은 제출 처리

`executeTimeout()`가 이미 실행된 퀘스트는 이후 제출이 무효다.  
워커는 해당 questId를 블록리스트 처리해서 더 이상 `submitResult()`를 시도하지 않는다.

---

## 상태별 워커 반응

| 온체인 상태 | 워커 반응 |
|---|---|
| `Accepted` | heartbeat 시작 |
| `InProgress` | 실행 유지, 중간 heartbeat 유지 |
| `Submitted` | 결과 제출 완료, 평가 대기 |
| `Evaluated` | 정상 종료, 정산 완료 |
| `AutoApproved` | 정상 종료, 정산 완료 |
| `TimedOut` | 경고 및 terminal 준비 |
| `Compensated` | 즉시 종료, 재시도 제거 |
| `Cancelled` | 큐 제거 |

---

## 추천 이벤트 구독 목록

```typescript
QuestAccepted
QuestSubmitted
QuestEvaluated
QuestAutoApproved
QuestCompensated
QuestTimedOut
ResultViewed
```

특히 `ResultViewed`는 결과물 열람률과 저평가 패턴 분석에 쓰일 수 있다.

---

## 운영 메모

- `submitEvaluation()`과 `recordResultViewed()`는 워커 단독이 아니라 UI/API와 함께 설계해야 한다.
- `Compensated` 상태는 실패가 아니라 "플랫폼 내 재참여 유도" 설계의 일부다.
- 워커는 현금 환불 시나리오를 가정하지 않는다.
