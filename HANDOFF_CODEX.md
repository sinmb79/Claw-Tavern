# Claw Tavern — Codex 작업 명세서

> **Codex 역할:** 이 파일의 작업 지시에 따라 코드를 작성하고 같은 폴더에 저장한다.
> 설계 판단은 하지 않는다. 모든 결정사항은 `MASTER_ROADMAP.md`에 있다.
> 작업 완료 후 Cowork가 검토한다.

---

## 작업 전 필독

- **설계 원본:** `MASTER_ROADMAP.md` — 모든 로직의 최종 기준
- **기존 파일:** `TavernToken.sol`, `TavernRegistry.sol` — 수정 시 덮어쓰기
- **신규 파일:** `TavernEscrow.sol` — 없는 파일, 새로 생성
- **언어:** Solidity ^0.8.20 (OpenZeppelin 5.x 사용)

---

## [작업 1] TavernEscrow.sol 신규 작성

Phase 1의 핵심 컨트랙트. 퀘스트 생애주기 전체를 관리한다.

### 상태머신 (QuestState enum)

```
Created     → 퀘스트 등록 완료, 예치금 미납
Funded      → USDC 또는 ETH 예치 완료
Accepted    → 에이전트 수락
InProgress  → 작업 시작 (heartbeat 수신)
Submitted   → 결과물 제출 완료
Evaluated   → 의뢰인 평가 완료 (평균 3점+)
AutoApproved→ 72시간 무응답 → 자동 승인
Compensated → 불만족(평균 2점 이하) 또는 TimedOut → 보상전환 완료
TimedOut    → 48시간 내 미제출 → 자동 보상전환 트리거
Cancelled   → Funded 이전 취소 → USDC·ETH 직접 환불
Disputed    → 중재 중 (Phase 2)
```

⚠️ `Refunded`와 `Rejected` 상태는 존재하지 않는다. 절대 추가하지 말 것.

---

### Quest 구조체

```solidity
struct Quest {
    uint256 questId;
    address client;
    address agent;
    address currency;        // USDC 주소 또는 address(0) = ETH
    uint256 depositAmount;   // 예치금 (원본 통화 단위)
    QuestState state;
    uint256 createdAt;
    uint256 fundedAt;
    uint256 acceptedAt;
    uint256 submittedAt;
    uint256 resultViewedAt;  // 결과물 열람 시각 (0 = 미열람)
    uint256 evaluatedAt;
    uint8[5] evalScores;     // 5축 평가 점수 [1~5]
    bool compensated;
    uint256 tvrnUnlockTime;  // $TVRN 잠금 해제 시각
}
```

---

### 보상전환 로직 (_compensate internal)

```
TimedOut (48h 미제출):
  $TVRN: 예치금 45% × ×1.1 할증 (30일 잠금)
  크레딧: 예치금 45% × ×1.2 할증 (즉시 사용)
  운영풀: 10% 귀속
  에이전트 평판: -2.0점

미열람 + 평가 평균 1점:
  $TVRN: 예치금 38% × ×0.9 (30일 잠금)
  크레딧: 예치금 38% × ×1.2
  운영풀: 24% 귀속
  에이전트 평판: -1.5점

열람 후 평가 평균 2점 이하:
  $TVRN: 예치금 18% × ×0.9 (30일 잠금)
  크레딧: 예치금 18% × ×1.2
  운영풀: 64% 귀속
  에이전트 평판: -0.8점

원칙: $TVRN 비율 + 크레딧 비율 합계 ≤ 100% (예치금 초과 불가)
```

---

### Price Oracle (_getCheckedPrice)

```solidity
// 3중 검증 필수
function _getCheckedPrice(address feed) internal view returns (uint256) {
    (uint80 roundId, int256 price, , uint256 updatedAt, uint80 answeredInRound)
        = AggregatorV3Interface(feed).latestRoundData();
    require(price > 0, "Oracle: invalid price");
    require(updatedAt > block.timestamp - 1 hours, "Oracle: stale price");
    require(answeredInRound >= roundId, "Oracle: incomplete round");
    return uint256(price);
}

// 2단계 환산: ETH → USD → $TVRN
// USDC는 1:1 (USD 직접 사용)
```

---

### 평가 시스템 (submitEvaluation)

```solidity
function submitEvaluation(
    uint256 questId,
    uint8[5] calldata scores,   // 각 1~5점
    string calldata comment,    // 선택사항
    string[] calldata tags      // 선택사항
) external
```

**$TVRN 성실도 보상 (감소 곡선):**
```
월별 평가 건수 (evalCountThisMonth[msg.sender]):
  1~10건:  보상 100% (클릭만 +1 / 50자+ +3 / 100자+태그 +5 $TVRN)
  11~20건: 보상 50%
  21~30건: 보상 20%
  31건+:   보상 0%

동일 에이전트 평가: 월 3회 초과 시 보상 없음 (기록은 유지)
```

**상태 전이:**
```
평균 점수 ≥ 3.0: Evaluated → 에이전트 정산 (예치 통화 그대로 지급)
평균 점수 < 3.0 AND 열람: Compensated (보상전환)
평균 점수 = 1.0 AND 미열람: Compensated (더 높은 비율)
```

---

### 자동 처리 함수

```solidity
// Chainlink Automation 또는 keeper가 호출
function executeTimeout(uint256 questId) external
  // acceptedAt + 48시간 경과 AND 미제출 → TimedOut → 보상전환

function executeAutoApprove(uint256 questId) external
  // submittedAt + 72시간 경과 AND 미평가 → AutoApproved → 에이전트 정산

function recordResultViewed(uint256 questId) external
  // 에이전트가 결과물 열람 시 온체인 기록 (resultViewedAt 설정)
```

---

### 정산 (settleQuest internal)

```
에이전트 수령:
  - 예치 통화 그대로 87% (USDC면 USDC, ETH면 ETH)
  - 완료 보너스 $TVRN (별도 풀, TavernToken.mintReward 호출)

수수료 단계 (checkFeeStage):
  - 의뢰인 < 1,000 OR 에이전트 < 200: 0%
  - 의뢰인 ≥ 1,000 AND 에이전트 ≥ 200: 1%
  - 의뢰인 ≥ 5,000 AND 에이전트 ≥ 500: 2%
  - 의뢰인 ≥ 10,000 AND 에이전트 ≥ 1,000: 3%

수수료 분배:
  60% → 운영 에이전트 기여도 비례
  20% → $TVRN 시장 매입 후 소각
  20% → 운영 준비금
```

---

### 이벤트

```solidity
event QuestCreated(uint256 questId, address client, address currency, uint256 amount);
event QuestFunded(uint256 questId);
event QuestAccepted(uint256 questId, address agent);
event QuestSubmitted(uint256 questId);
event QuestEvaluated(uint256 questId, uint8[5] scores, uint256 avgScore);
event QuestAutoApproved(uint256 questId);
event QuestCompensated(uint256 questId, uint256 tvrnAmount, uint256 creditAmount);
event QuestTimedOut(uint256 questId);
event QuestCancelled(uint256 questId, uint256 refundAmount);
event ResultViewed(uint256 questId, uint256 viewedAt);
```

---

## [작업 2] TavernRegistry.sol + TavernToken.sol 업데이트

### TavernRegistry.sol 변경사항

현재 파일에서 다음을 추가/수정:

```solidity
// 마스터 에이전트 — yearMultiplier 수정 (구버전 [10,7,5,3,1] 제거)
uint256[5] public yearMultiplier = [5, 4, 3, 2, 1];

uint256 public masterExpiryPrimary;   // 창시자 정: 배포 후 5년
uint256 public masterExpirySecondary; // 창시자 부: 배포 후 5년 6개월
mapping(address => bool) public isMasterFounder;
mapping(address => bool) public isMasterSuccessor;

// 3일 롤링 쿼터
uint256[6][3] public rollingScores; // [직업][날짜슬롯]
uint256 public rollingDay;          // 현재 슬롯 인덱스 (0,1,2 순환)
uint256 public constant MIN_QUOTA = 500;       // 최소 5%
uint256 public constant MAX_DAILY_CHANGE = 2000; // ±20%
uint256 public constant HYSTERESIS_BPS = 200;    // 2%
```

**dailyQuotaRebalance() 수정:**

```
기존 로직에 히스테리시스 추가:
  변동이 모든 직업에서 200bps(2%) 미만이면
  → 저장 없이 return (가스비 절약, 에이전트 불안 방지)
```

---

### TavernToken.sol 변경사항

현재 파일에서 다음을 추가:

```solidity
// $TVRN 30일 잠금
mapping(address => uint256) public tvrnUnlockAt;

function setUnlockTime(address account, uint256 unlockAt) external onlyEscrow {
    if (unlockAt > tvrnUnlockAt[account]) {
        tvrnUnlockAt[account] = unlockAt; // 더 긴 잠금으로만 갱신
    }
}

function _beforeTokenTransfer(
    address from,
    address to,
    uint256 amount
) internal override {
    if (from != address(0)) { // mint는 잠금 적용 안 함
        require(
            block.timestamp >= tvrnUnlockAt[from],
            "TVRN: transfer locked (30-day compensation lock)"
        );
    }
    super._beforeTokenTransfer(from, to, amount);
}
// 잠금 중에도 스테이킹·투표 허용 (transfer가 아닌 별도 approve 경로 사용)
```

---

## [작업 3] CODEX 패키지 4개 업데이트

### CODEX_INSTRUCTIONS.md

다음 항목을 교체/추가:

1. **상태머신 전면 교체**
   - `Rejected` → 제거
   - `Refunded` → 제거
   - `Evaluated` / `AutoApproved` / `Compensated` / `TimedOut` → 추가
   - "검토 거부 시 USDC 환불" → "평가 평균 2점 이하 → 보상전환($TVRN+크레딧)"

2. **함수 목록 업데이트**
   - `submitEvaluation()` 추가 (5축 점수, 성실도 보상, 상태 전이)
   - `recordResultViewed()` 추가
   - `executeAutoApprove()` 추가
   - `_getCheckedPrice()` 추가 (3중 staleness 검증 명시)

3. **보상전환 비율 명시** (작업 1 기준 그대로)

---

### CODEX_AGENT_WORKER.md

다음 항목 추가:

1. **submitEvaluation 연동**
   - 의뢰인 평가 제출 후 온체인 호출 방법
   - 5축 점수 배열 구성 방법

2. **recordResultViewed 연동**
   - 에이전트가 결과물 열람 시 자동 호출

3. **Compensated 상태 처리**
   - 보상전환 발생 시 에이전트 측 처리 로직

---

### CODEX_GOVERNANCE.md

다음 항목 추가:

1. **GTM Launch Strategy 섹션**
   - 초기 3개 카테고리: 코딩·자동화 / 리서치·요약 / 번역·콘텐츠
   - 비공식 카테고리: 법률·리스크, 대형 멀티에이전트, 고위험 의존형

2. **파운딩 에이전트 특전**
   - Soul-bound NFT 배지
   - 스테이킹 보너스 (100 $TVRN → 150 $TVRN 크레딧)
   - Phase 2 수수료 면제 6개월 추가
   - DAO 투표력 ×1.5

3. **후임 마스터 에이전트 2년 임기 구조**

---

### CODEX_DASHBOARD.md

다음 항목 추가/교체:

1. **평가 5축 UI 컴포넌트**
   - 요구사항 충족 / 정확성 / 실행가능성 / 커뮤니케이션 / 재의뢰 의향
   - 별점 슬라이더 또는 클릭 UI

2. **Compensated 상태 표시**
   - 퀘스트 카드에 "보상전환 완료" 뱃지
   - $TVRN 잠금 해제까지 남은 일수 표시

3. **KPI 위젯 추가**
   - `firstAttemptSuccessRate` (첫 시도 성공률 — 목표 75%+)
   - 태그별 평판 점수
   - 직업별 쿼터 비율 실시간 표시

---

## 작업 완료 후 알릴 것

각 작업 완료 시 Cowork에게:
1. 작성/수정한 파일명
2. 주요 변경 내용 3줄 요약
3. 검토 요청 항목 (불확실한 부분)

---

## 참고 — 주요 상수값

```
ORACLE_STALENESS = 1 hours
TVRN_LOCK_PERIOD = 30 days
TIMEOUT_PERIOD   = 48 hours
AUTO_APPROVE_PERIOD = 72 hours
HYSTERESIS_BPS   = 200   (2%)
MAX_DAILY_CHANGE = 2000  (±20%)
MIN_QUOTA        = 500   (5%)

평가 감소 곡선:
  evalCount  1~10: 100%
  evalCount 11~20: 50%
  evalCount 21~30: 20%
  evalCount 31+:    0%
  동일 에이전트 월 3회 상한

yearMultiplier = [5, 4, 3, 2, 1]
masterExpiryPrimary   = deploy + 5 years
masterExpirySecondary = deploy + 5.5 years
successorTermLength   = 2 years
successorMultiplier   = 3 (고정)
```
