# Claw Tavern Codex 구현 명세

## 프로젝트 개요

Claw Tavern은 Base 위에서 OpenClaw 계열 에이전트가 퀘스트를 수행하고, 의뢰인은 USDC 또는 ETH를 예치하며, 결과에 따라 정산 또는 보상전환이 일어나는 에이전트 마켓플레이스다.  
문서 기준 우선순위는 다음과 같다.

1. `MASTER_ROADMAP.md`
2. `HANDOFF_CODEX.md`
3. 개별 컨트랙트 구현체

---

## 현재 컨트랙트 패키지

```text
TavernToken.sol        $TVRN 토큰, 생태계 민팅, 출석 예산, 30일 잠금
TavernRegistry.sol     길드/에이전트 등록, 평판, 마스터 배율, 3일 롤링 쿼터
TavernEscrow.sol       퀘스트 생애주기, 멀티커런시 예치, 평가, 자동 승인, 보상전환
TavernAttendance.sol   출석/하트비트 풀 (Phase 1 후속 구현)
```

---

## TavernEscrow 상태머신

### 최신 상태 정의

```text
Created       퀘스트 등록 완료, 예치금 미납
Funded        USDC 또는 ETH 예치 완료
Accepted      에이전트 수락
InProgress    작업 시작, heartbeat 수신
Submitted     결과물 제출 완료
Evaluated     의뢰인 평가 완료, 평균 3.0 이상
AutoApproved  제출 후 72시간 무응답 자동 승인
Compensated   저평가 또는 TimedOut 결과로 $TVRN+크레딧 전환 완료
TimedOut      acceptedAt + 48시간 경과, 미제출
Cancelled     Funded 이전 취소
Disputed      중재 중 (Phase 2)
```

### 금지 상태

아래 상태는 더 이상 사용하지 않는다.

```text
Rejected
Refunded
```

### 상태 전이

```text
Created    -> Funded       : fundQuestUSDC / fundQuestETH
Funded     -> Accepted     : acceptQuest
Accepted   -> InProgress   : recordHeartbeat 또는 submitResult 직전 heartbeat 처리
InProgress -> Submitted    : submitResult
Accepted   -> TimedOut     : executeTimeout
InProgress -> TimedOut     : executeTimeout
Submitted  -> Evaluated    : submitEvaluation, 평균 3.0 이상
Submitted  -> Compensated  : submitEvaluation, 평균 2.0 이하
Submitted  -> AutoApproved : executeAutoApprove
Created    -> Cancelled    : cancelQuest
TimedOut   -> Compensated  : 내부 _compensate
```

---

## TavernEscrow 핵심 구조

```solidity
struct Quest {
    uint256 questId;
    address client;
    address agent;
    address currency;      // address(0) = ETH, 그 외 USDC
    uint256 depositAmount;
    QuestState state;
    uint256 createdAt;
    uint256 fundedAt;
    uint256 acceptedAt;
    uint256 submittedAt;
    uint256 resultViewedAt;
    uint256 evaluatedAt;
    uint8[5] evalScores;
    bool compensated;
    uint256 tvrnUnlockTime;
}
```

---

## TavernEscrow 함수 목록

### 생성/예치

```solidity
function createQuest(
    address currency,
    uint256 depositAmount,
    bytes32 briefHash,
    string calldata briefUri
) external returns (uint256 questId);

function fundQuestUSDC(uint256 questId) external;
function fundQuestETH(uint256 questId) external payable;
function cancelQuest(uint256 questId) external;
```

### 수락/진행/제출

```solidity
function acceptQuest(uint256 questId) external;
function recordHeartbeat(uint256 questId) external;
function submitResult(
    uint256 questId,
    bytes32 resultHash,
    string calldata resultUri
) external;
```

### 평가/자동 처리

```solidity
function submitEvaluation(
    uint256 questId,
    uint8[5] calldata scores,
    string calldata comment,
    string[] calldata tags
) external;

function recordResultViewed(uint256 questId) external;
function executeTimeout(uint256 questId) external;
function executeAutoApprove(uint256 questId) external;
```

### 가격 검증

```solidity
function _getCheckedPrice(address feed) internal view returns (uint256) {
    (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound)
        = AggregatorV3Interface(feed).latestRoundData();

    require(price > 0, "Oracle: invalid price");
    require(updatedAt > block.timestamp - 1 hours, "Oracle: stale price");
    require(answeredInRound >= roundId, "Oracle: incomplete round");
    return uint256(price);
}
```

ETH는 `ETH/USD -> USD`, 그 다음 `USD -> TVRN` 2단계로 환산한다.  
USDC는 1:1 USD로 간주한다.

---

## 5축 평가 시스템

의뢰인은 결과물 제출 후 아래 5개 항목을 각각 1~5점으로 평가한다.

| 축 | 설명 | 태그 평판 키 |
|---|---|---|
| 요구사항 충족 | 의뢰 요구를 제대로 반영했는가 | `task_completion` |
| 정확성 | 사실 오류, 계산 오류, 논리 오류가 없는가 | `accuracy` |
| 실행가능성 | 바로 사용 가능한 결과물인가 | `practicality` |
| 커뮤니케이션 | 진행 중 응답과 설명이 명확했는가 | `communication` |
| 재의뢰 의향 | 다음 퀘스트도 맡길 의향이 있는가 | `rehire_intent` |

### 평가 보상

평가 보상은 월별 감소곡선을 따른다.

```text
1~10건   100%
11~20건   50%
21~30건   20%
31건+      0%
동일 에이전트 대상 보상은 월 3회 상한
```

기본 보상 기준:

```text
5축 점수만 제출                      +1 TVRN
5축 + 코멘트 50자 이상               +3 TVRN
5축 + 코멘트 100자 이상 + 태그 선택  +5 TVRN
```

---

## 보상전환 규칙

원칙: USDC/ETH 직접 환불은 없다.  
불만족은 `$TVRN + 크레딧`으로 전환한다.

| 상황 | TVRN 전환 | 크레딧 전환 | 운영 풀 귀속 | 평판 |
|---|---|---|---|---|
| TimedOut | 예치금 45% x 1.1 | 예치금 45% x 1.2 | 10% | -2.0 |
| 미열람 + 평균 1점 | 예치금 38% x 0.9 | 예치금 38% x 1.2 | 24% | -1.5 |
| 열람 후 평균 2점 이하 | 예치금 18% x 0.9 | 예치금 18% x 1.2 | 64% | -0.8 |

### 추가 원칙

```text
TVRN 잠금 기간       30일
크레딧 유효기간      12개월
48시간 미제출        TimedOut -> Compensated
72시간 무응답        AutoApproved
TVRN base ratio + credit base ratio <= 100%
```

---

## 정산 규칙

정상 정산 시:

```text
에이전트 수령: 예치 통화 그대로 87%
퀘스트 수수료: 사용자 수 기준 0% -> 1% -> 2% -> 3%
잔여 서비스 몫: 내부 서비스/운영 풀로 적립
완료 보너스: TVRN 별도 민팅
```

수수료 단계:

```text
의뢰인 < 1,000 또는 에이전트 < 200         0%
의뢰인 >= 1,000 그리고 에이전트 >= 200    1%
의뢰인 >= 5,000 그리고 에이전트 >= 500    2%
의뢰인 >= 10,000 그리고 에이전트 >= 1,000 3%
```

수수료 분배:

```text
60% 운영 에이전트 풀
20% TVRN 바이백/소각 준비금
20% 운영 준비금
```

---

## TavernRegistry 현재 기준

`TavernRegistry.sol`은 아래 값을 공개 상태로 유지한다.

```text
yearMultiplier        = [5, 4, 3, 2, 1]
masterExpiryPrimary   = deploy + 5 years
masterExpirySecondary = deploy + 5 years + 180 days
MIN_QUOTA             = 500   (5%)
MAX_DAILY_CHANGE      = 2000  (20%)
HYSTERESIS_BPS        = 200   (2%)
```

`dailyQuotaRebalance()`는 3일 롤링 평균을 기반으로 쿼터를 계산하고, 모든 직업의 변동폭이 2% 미만이면 저장하지 않는다.

---

## TavernToken 현재 기준

`TavernToken.sol`은 보상전환 수령자를 위한 잠금 기능을 갖는다.

```solidity
mapping(address => uint256) public tvrnUnlockAt;
function setUnlockTime(address account, uint256 unlockAt) external;
```

전송 잠금은 OpenZeppelin 5.x 방식에 맞춰 `_update()`에서 검사한다.

```text
mint는 잠금 미적용
transfer / transferFrom / burn 경로는 잠금 적용
잠금 기간 중 approve 기반 스테이킹/투표는 별도 구현 경로에서 허용
```

---

## 구현 상수 요약

```text
ORACLE_STALENESS    = 1 hours
TIMEOUT_PERIOD      = 48 hours
AUTO_APPROVE_PERIOD = 72 hours
TVRN_LOCK_PERIOD    = 30 days

MIN_QUOTA           = 500
MAX_DAILY_CHANGE    = 2000
HYSTERESIS_BPS      = 200
```

이 문서를 기준으로 이후 작업자는 `Rejected`, `Refunded`, 현금 환불 기반 설명을 다시 넣지 않는다.
