# Task 22 — 토큰노믹스 마스터 플랜 정합 + 보안/거버넌스 강화

> 참조: `GAP_ANALYSIS_MASTER_VS_CODE.md`, `MASTER_ROADMAP.md`
> 난이도: 높음 (컨트랙트 핵심 재설계 + 보안 강화)
> 선행: Task 21 완료

---

## 목표

1. MASTER_ROADMAP.md와 코드 사이의 **Critical 6건** 해소 (토큰노믹스 근본 수정)
2. 코드 리뷰 HIGH/MEDIUM 이슈 **7건** 대응 (보안·거버넌스 강화)

**참고:** TavernToken.sol은 수정 1의 대부분이 이미 반영됨 (2.1B, 4개 풀, DAO 통제). 아래 수정 1은 Codex가 이미 완료한 부분과 남은 부분을 모두 포함. 이미 반영된 항목은 검증만 수행.

---

## 수정 1: TavernToken.sol 전면 재작성

### 1-A. MAX_SUPPLY 변경

```
변경 전: MAX_SUPPLY = 1_000_000_000 * 1e18   (1B)
변경 후: MAX_SUPPLY = 2_100_000_000 * 1e18   (2.1B)
```

### 1-B. 팀 민팅 완전 제거

```
삭제: _mint(initialTeam, 150_000_000 * 1e18)
삭제: constructor의 initialTeam 파라미터
변경: constructor()는 인자 없음 — 민팅 없이 배포
```

constructor 시그니처:
```solidity
constructor() ERC20("Tavern Token", "TVRN") {
    _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    currentYearStart = block.timestamp;
}
```

### 1-C. 4개 풀 분리

단일 `ecosystemRemaining` 대신 4개 독립 풀:

```solidity
// ── 풀별 잔여량 ──
uint256 public questPoolRemaining    = 1_050_000_000 * 1e18;  // 50% — 퀘스트 수행 에이전트 보상
uint256 public attendancePoolRemaining = 210_000_000 * 1e18;  // 10% — 출석·하트비트 보상
uint256 public clientPoolRemaining     = 168_000_000 * 1e18;  //  8% — 의뢰인 활동 보상
uint256 public operationPoolRemaining  = 672_000_000 * 1e18;  // 32% — 운영 에이전트 (마스터 포함)
```

각 풀 전용 민팅 함수:

```solidity
function questMint(address to, uint256 amount, string calldata reason) external onlyRole(MINTER_ROLE);
function attendanceMint(address to, uint256 amount) external onlyRole(MINTER_ROLE);
function clientRewardMint(address to, uint256 amount, string calldata reason) external onlyRole(MINTER_ROLE);
function operationMint(address to, uint256 amount, string calldata reason) external onlyRole(MINTER_ROLE);
```

각 함수는 해당 풀의 remaining에서 차감. MAX_SUPPLY 초과 검증도 유지.

기존 `ecosystemMint()`는 삭제. 기존 `ecosystemRemaining` 삭제.

### 1-D. 반감기 스케줄 마스터 플랜 정합

출석 보상:
```
변경 전: attendanceYearlyBudget = 30_000_000 * 1e18, 최소 1M
변경 후: attendanceYearlyBudget = 60_000_000 * 1e18, 최소 7_000_000 * 1e18
```

반감기 로직은 동일 (매년 /2, 최소값만 변경):
```solidity
uint256 public attendanceYearlyBudget = 60_000_000 * 1e18; // Year1: 60M
// ...
if (attendanceYearlyBudget < 7_000_000 * 1e18) {
    attendanceYearlyBudget = 7_000_000 * 1e18;
}
```

### 1-E. DAO 통제 메커니즘 추가

```solidity
uint256 public constant MAX_MINT_PER_EPOCH = 30_000_000 * 1e18;  // 에포크(30일)당 최대 발행량
uint256 public constant DAO_REALLOC_CAP = 100_000_000 * 1e18;    // 총 재배분 한도 1억
uint256 public daoReallocated;
uint256 public lastEpochStart;
uint256 public epochMinted;
bytes32 public emissionScheduleHash;  // 발행 스케줄 해시 (변경 시 이벤트)

bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

function daoReallocate(address pool, uint256 amount) external onlyRole(GOVERNANCE_ROLE) {
    require(daoReallocated + amount <= DAO_REALLOC_CAP, "Cap exceeded");
    _checkEpochReset();
    require(epochMinted + amount <= MAX_MINT_PER_EPOCH, "Epoch cap exceeded");

    daoReallocated += amount;
    epochMinted += amount;
    require(totalSupply() + amount <= MAX_SUPPLY, "Max supply exceeded");
    _mint(pool, amount);

    emit DaoReallocation(pool, amount, daoReallocated);
}

function _checkEpochReset() internal {
    if (block.timestamp >= lastEpochStart + 30 days) {
        lastEpochStart = block.timestamp;
        epochMinted = 0;
    }
}

function setEmissionScheduleHash(bytes32 newHash) external onlyRole(GOVERNANCE_ROLE) {
    bytes32 old = emissionScheduleHash;
    emissionScheduleHash = newHash;
    emit EmissionScheduleUpdated(old, newHash);
}
```

이벤트 추가:
```solidity
event DaoReallocation(address indexed pool, uint256 amount, uint256 totalReallocated);
event EmissionScheduleUpdated(bytes32 oldHash, bytes32 newHash);
```

### 1-F. 나머지 유지 사항

- `MINTER_ROLE`, `BURNER_ROLE`, `ESCROW_ROLE` — 유지
- `burn()` — 유지
- `tvrnUnlockAt`, `setUnlockTime()` — 유지
- `_update()` 전송 락 — 유지

---

## 수정 2: TavernEscrow.sol 정산 분배 재설계

### 2-A. 정산 비율 변경

현재 코드:
```
에이전트: 87% 전액 예치통화
보너스: 별도 30% TVRN 추가
→ 실질 117%
```

마스터 플랜 정합:
```
수행 에이전트: 87% (70% 예치통화 + 30% TVRN 환산)
기획 에이전트: 5%
검증 에이전트: 5%
출석 풀 충전: 3%
```

상수 변경:
```solidity
// 삭제
// uint256 public constant AGENT_PAYOUT_BPS = 8_700;
// uint256 public completionBonusBps = 3_000;

// 추가
uint256 public constant AGENT_TOTAL_BPS = 8_700;           // 87% 전체
uint256 public constant AGENT_CURRENCY_RATIO_BPS = 7_000;  // 87%의 70% = 예치통화
uint256 public constant AGENT_TVRN_RATIO_BPS = 3_000;      // 87%의 30% = TVRN 환산
uint256 public constant PLANNING_AGENT_BPS = 500;           // 5%
uint256 public constant VERIFICATION_AGENT_BPS = 500;       // 5%
uint256 public constant ATTENDANCE_POOL_BPS = 300;          // 3%
```

### 2-B. Quest 구조체에 역할 에이전트 추가

```solidity
struct Quest {
    // ... 기존 필드 유지 ...
    address planningAgent;      // 기획 에이전트 (신규)
    address verificationAgent;  // 검증 에이전트 (신규)
}
```

### 2-C. _settleQuest() 재작성

```solidity
function _settleQuest(uint256 questId, int256 reputationDelta, string memory reputationTag) internal {
    Quest storage q = quests[questId];
    address currency = q.currency;
    uint256 deposit = q.depositAmount;

    // 수수료 차감
    uint256 feeAmount = (deposit * feeRateBps[currentFeeStage]) / BPS_DENOMINATOR;
    uint256 afterFee = deposit - feeAmount;
    _routeFeeAmount(currency, feeAmount);

    // 수행 에이전트: 87%의 70% = 예치통화
    uint256 agentCurrencyPayout = (afterFee * AGENT_TOTAL_BPS * AGENT_CURRENCY_RATIO_BPS) / (BPS_DENOMINATOR * BPS_DENOMINATOR);
    _transferCurrency(currency, q.agent, agentCurrencyPayout);

    // 수행 에이전트: 87%의 30% = TVRN 환산 민팅
    uint256 agentTvrnUsd = _toUsd18(currency, (afterFee * AGENT_TOTAL_BPS * AGENT_TVRN_RATIO_BPS) / (BPS_DENOMINATOR * BPS_DENOMINATOR));
    uint256 agentTvrnAmount = _usd18ToTVRN(agentTvrnUsd);
    if (agentTvrnAmount > 0) {
        _mintTVRN(q.agent, agentTvrnAmount, "quest-tvrn-share");
    }

    // 기획 에이전트: 5%
    if (q.planningAgent != address(0)) {
        uint256 planningPayout = (afterFee * PLANNING_AGENT_BPS) / BPS_DENOMINATOR;
        _transferCurrency(currency, q.planningAgent, planningPayout);
    }

    // 검증 에이전트: 5%
    if (q.verificationAgent != address(0)) {
        uint256 verificationPayout = (afterFee * VERIFICATION_AGENT_BPS) / BPS_DENOMINATOR;
        _transferCurrency(currency, q.verificationAgent, verificationPayout);
    }

    // 출석 풀: 3%
    uint256 attendanceAmount = (afterFee * ATTENDANCE_POOL_BPS) / BPS_DENOMINATOR;
    servicePoolBalance[currency] += attendanceAmount;

    // 잔여분 → 서비스 풀
    // (기획/검증 에이전트 미배정 시 해당 몫은 서비스 풀로)

    _notifyRegistryReputation(q.agent, reputationDelta, reputationTag);
}
```

### 2-D. 기획/검증 에이전트 배정 함수 추가

```solidity
function assignPlanningAgent(uint256 questId, address agent) external onlyKeeperOrAdmin {
    Quest storage q = quests[questId];
    require(q.state == QuestState.Funded || q.state == QuestState.Accepted, "Invalid state");
    q.planningAgent = agent;
}

function assignVerificationAgent(uint256 questId, address agent) external onlyKeeperOrAdmin {
    Quest storage q = quests[questId];
    require(q.state == QuestState.Submitted, "Invalid state");
    q.verificationAgent = agent;
}
```

### 2-E. completionBonusBps 관련 코드 삭제

`completionBonusBps` 변수, `setCompletionBonusBps()` 함수, `_settleQuest` 내 보너스 민팅 블록 삭제.
보너스는 이제 87% 중 30% TVRN으로 통합됨.

### 2-F. _mintTVRN 풀 분기

기존 `ecosystemMint` 호출을 풀별로 분기:
- 퀘스트 정산 TVRN → `questMint()` 호출
- 보상(compensation) TVRN → `questMint()` 호출
- 출석 → `attendanceMint()` 호출 (기존과 동일)

내부 함수:
```solidity
function _mintTVRN(address to, uint256 amount, string memory reason) internal {
    ITavernToken(tavernToken).questMint(to, amount, reason);
}
```

---

## 수정 3: WHITEPAPER_V2.md 원복

Task 21에서 "2.1B → 1B"로 수정한 부분 원복:

```
변경 후:
- 총 발행량: 2,100,000,000 $TVRN (2.1B)
- 배분: 퀘스트 보상 50% (1,050M) / 출석 10% (210M) / 의뢰인 8% (168M) / 운영 32% (672M)
- 팀 보유: 0% — 팀은 운영 에이전트 보상 + 수수료 분배로만 수익
```

WHITEPAPER_V2.md의 Section 6 (Tokenomics) 전체를 MASTER_ROADMAP 기준으로 재작성.

---

## 수정 4: HANDOFF_RESUME.md 업데이트

Task 22 완료 내용 추가:
- TavernToken MAX_SUPPLY 2.1B, 팀 민팅 제거, 4개 풀 분리
- TavernEscrow 정산 구조 변경 (87% = 70% cash + 30% TVRN)
- DAO 통제 메커니즘 추가

---

## 수정 5: 배포 스크립트 업데이트

`deploy/` 스크립트에서:
- TavernToken 생성자 인자 `initialTeam` 제거
- 배포 시 민팅 없음 확인
- `.env.example`에서 `MAINNET_INITIAL_TEAM_ADDRESS` 제거

---

## 수정 6: 테스트 업데이트

### 기존 테스트 수정

TavernToken 관련 모든 테스트에서:
- `MAX_SUPPLY` 검증값 `1e9 * 1e18` → `2.1e9 * 1e18`
- constructor에 `initialTeam` 인자 전달 부분 삭제
- `ecosystemMint` 호출 → `questMint` / `clientRewardMint` / `operationMint` 등 풀별 함수로 변경
- 출석 예산 `30M` → `60M`, 최소값 `1M` → `7M` 검증

### 신규 테스트 추가

1. **test/TavernToken.pool.test.ts**
   - 4개 풀 각각의 초기 잔여량 검증
   - 풀 간 교차 민팅 불가 검증 (questMint로 attendancePool 차감 안 됨)
   - MAX_SUPPLY 초과 시 revert
   - `daoReallocate()` 한도 테스트 (DAO_REALLOC_CAP, MAX_MINT_PER_EPOCH)
   - 에포크 리셋 테스트 (30일 후 epochMinted 리셋)
   - 권한 없는 주소의 `daoReallocate` 호출 시 revert

2. **test/TavernEscrow.settlement.test.ts**
   - 정산 시 에이전트 수령: 예치금의 87% × 70% = 예치통화
   - 정산 시 에이전트 TVRN: 87% × 30% USD 환산
   - 기획 에이전트: 5% 수령
   - 검증 에이전트: 5% 수령
   - 출석 풀: 3% 적립
   - 기획/검증 에이전트 미배정 시 잔여분 서비스 풀 귀속
   - completionBonusBps 관련 로직 제거 확인

---

## 체크리스트

### TavernToken.sol
- [ ] MAX_SUPPLY = 2_100_000_000 * 1e18
- [ ] constructor 인자 없음, 초기 민팅 없음
- [ ] ecosystemRemaining 삭제
- [ ] ecosystemMint() 삭제
- [ ] questPoolRemaining = 1,050M
- [ ] attendancePoolRemaining = 210M
- [ ] clientPoolRemaining = 168M
- [ ] operationPoolRemaining = 672M
- [ ] questMint(), clientRewardMint(), operationMint() 각각 구현
- [ ] attendanceMint()가 attendancePoolRemaining에서 차감
- [ ] attendanceYearlyBudget = 60M, 최소 7M
- [ ] MAX_MINT_PER_EPOCH = 30M
- [ ] DAO_REALLOC_CAP = 100M
- [ ] daoReallocated, epochMinted 상태 변수
- [ ] daoReallocate() — GOVERNANCE_ROLE 전용
- [ ] emissionScheduleHash + setEmissionScheduleHash()
- [ ] MINTER_ROLE, BURNER_ROLE, ESCROW_ROLE 유지
- [ ] burn(), tvrnUnlockAt, _update() 락 유지

### TavernEscrow.sol
- [ ] AGENT_PAYOUT_BPS 삭제 → AGENT_TOTAL_BPS + CURRENCY/TVRN 비율
- [ ] PLANNING_AGENT_BPS = 500
- [ ] VERIFICATION_AGENT_BPS = 500
- [ ] ATTENDANCE_POOL_BPS = 300
- [ ] Quest 구조체에 planningAgent, verificationAgent 추가
- [ ] _settleQuest() 재작성 (70% cash + 30% TVRN + 5%+5%+3%)
- [ ] assignPlanningAgent(), assignVerificationAgent()
- [ ] completionBonusBps 삭제
- [ ] setCompletionBonusBps() 삭제
- [ ] _mintTVRN → questMint() 호출로 변경

### 문서
- [ ] WHITEPAPER_V2.md Section 6 원복 (2.1B, 4개 풀, 0% 팀)
- [ ] HANDOFF_RESUME.md Task 22 항목 추가
- [ ] .env.example에서 MAINNET_INITIAL_TEAM_ADDRESS 삭제

### 배포
- [ ] deploy 스크립트 TavernToken constructor 인자 제거
- [ ] 기존 Sepolia 배포 무효화 명시 (재배포 필요)

### 테스트
- [ ] 기존 테스트 전부 새 인터페이스에 맞게 수정
- [ ] TavernToken.pool.test.ts 신규
- [ ] TavernEscrow.settlement.test.ts 신규
- [ ] `npx hardhat test` 전체 PASS
- [ ] `node scripts/run-forge.js` 퍼즈 PASS
- [ ] Slither 경고 트리아지

### 정합성 최종 확인
- [ ] MASTER_ROADMAP.md 토큰노믹스 섹션과 코드 1:1 대조
- [ ] GAP_ANALYSIS의 C1~C6 전부 RESOLVED 표기

---

## 수정 7: 코드 리뷰 HIGH/MEDIUM 이슈 대응

> 아래 항목들은 코드 리뷰에서 발견된 보안·설계 이슈.
> **이미 해결 확인된 항목은 표기만 하고 넘어갈 것.**

---

### 7-A. [HIGH #4] 메인넷 오라클 전략 — AdminPriceFeed 운영 자동화

**현황:** AdminPriceFeed.sol 이미 구현됨 (Task 21). TVRN/USD용 admin 오라클, ETH/USD는 Chainlink 공식 피드.

**남은 문제:** TavernEscrow의 `ORACLE_STALENESS = 1 hours`로 인해, 운영자가 1시간 이내에 `refreshPrice()`를 호출하지 않으면 정산이 실패함. 메인넷에서 수동 갱신은 비현실적.

**대응:**
1. `TavernAutomationRouter`에 **AdminPriceFeed refresh 태스크** 추가:
   - TaskType 추가: `PriceRefresh` (기존 4개 + 1개 = 5개)
   - `checkUpkeep()`에서 AdminPriceFeed의 `latestRoundData()` updatedAt이 50분 경과했으면 true 반환
   - `performUpkeep()`에서 `AdminPriceFeed.refreshPrice()` 호출
   - AdminPriceFeed의 owner를 TavernAutomationRouter로 이전하거나, 별도 REFRESHER_ROLE 추가

2. AdminPriceFeed에 **REFRESHER_ROLE** 추가:
```solidity
// AdminPriceFeed.sol 수정
// 기존: Ownable → 변경: AccessControl
// refreshPrice()를 onlyOwner 대신 onlyRole(REFRESHER_ROLE) || onlyOwner로 변경

bytes32 public constant REFRESHER_ROLE = keccak256("REFRESHER_ROLE");

function refreshPrice() external {
    require(
        msg.sender == owner() || hasRole(REFRESHER_ROLE, msg.sender),
        "Not authorized"
    );
    _recordPrice(rounds[latestRoundId].answer);
}
```

3. 배포 시 TavernAutomationRouter에 REFRESHER_ROLE 부여

**참고:** AdminPriceFeed를 Ownable→AccessControl로 바꾸면 기존 `updatePrice()` onlyOwner도 유지 필요. 가장 깔끔한 방법은 Ownable을 유지하면서 `refreshPrice()`만 별도 mapping으로 허용:

```solidity
mapping(address => bool) public isRefresher;

function setRefresher(address addr, bool enabled) external onlyOwner {
    isRefresher[addr] = enabled;
}

function refreshPrice() external {
    require(msg.sender == owner() || isRefresher[msg.sender], "Not authorized");
    _recordPrice(rounds[latestRoundId].answer);
}
```

---

### 7-B. [HIGH #5] arbitrary-send-eth 추가 방어

**현황:** `_transferCurrency()`가 ETH를 quest의 agent 주소로 전송. Slither High 경고.

**현재 코드 (L1112-1125):**
```solidity
function _transferCurrency(address currency, address to, uint256 amount) internal {
    if (currency == address(0)) {
        (bool success, ) = payable(to).call{value: amount}("");
        require(success, "ETH transfer failed");
        return;
    }
    IERC20(address(usdc)).safeTransfer(to, amount);
}
```

**이미 양호한 점:** `payable.transfer()` 대신 `call{value}` 사용 중 (리뷰 #7 해결됨). 상태 전이 검증 + ReentrancyGuard 적용.

**추가 방어 (구현 필요):**

1. **퀘스트별 출금 한도**: 단일 퀘스트에서 과도한 ETH 전송 방지
```solidity
uint256 public constant MAX_QUEST_DEPOSIT = 100 ether; // 초기 상한

function createQuest(...) external returns (uint256 questId) {
    require(depositAmount <= MAX_QUEST_DEPOSIT, "Exceeds max deposit");
    // ... 기존 로직
}
```

2. **긴급 일시정지**: 이상 감지 시 모든 정산 중단
```solidity
bool public settlementPaused;

modifier whenSettlementActive() {
    require(!settlementPaused, "Settlements paused");
    _;
}

function setSettlementPaused(bool paused) external onlyRole(ADMIN_ROLE) {
    settlementPaused = paused;
}
```

`_settleQuest()`, `_compensate()`, `executeTimeout()`, `executeAutoApprove()` 모두에 `whenSettlementActive` 적용.

---

### 7-C. [HIGH #6] 거버넌스 GOVERNANCE_ROLE 와이어링

**현황:** TavernGovernance의 `execute()`가 `proposal.target.call(proposal.callData)`로 임의 호출 가능하나, 대상 컨트랙트들이 TavernGovernance 주소에 권한을 부여하지 않아 실질적으로 무력.

**대응:**

1. **TavernToken**: `GOVERNANCE_ROLE`을 TavernGovernance 컨트랙트에 부여
```
배포 후: TavernToken.grantRole(GOVERNANCE_ROLE, tavernGovernanceAddress)
```
→ 이제 거버넌스가 `daoReallocate()`, `setEmissionScheduleHash()` 호출 가능

2. **TavernEscrow**: 거버넌스가 조작할 수 있는 파라미터 함수 추가
```solidity
// TavernEscrow.sol에 추가
bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

// 수수료 단계 하향 (리뷰 #8 대응 — 아래 7-D 참조)
function governanceDowngradeFeeStage(uint256 newStage) external onlyRole(GOVERNANCE_ROLE) {
    require(newStage < currentFeeStage, "Not a downgrade");
    currentFeeStage = newStage;
    emit FeeStageDowngraded(newStage, feeRateBps[newStage]);
}
```

3. **TavernRegistry**: 거버넌스가 마스터 에이전트를 비상 해임할 수 있는 경로 (리뷰 #9 대응 — 아래 7-E 참조)

4. **배포 스크립트**: 모든 대상 컨트랙트에서 `grantRole(GOVERNANCE_ROLE, governance)` 호출 추가

---

### 7-D. [MEDIUM #8] Fee Stage 거버넌스 하향 경로

**현황:** `checkAndUpgradeFeeStage()`는 단방향(상승만). 사용자 급감 시 수수료 유지는 이탈 가속화 리스크.

**대응:** TavernEscrow에 거버넌스 전용 하향 함수 추가:

```solidity
event FeeStageDowngraded(uint256 indexed stage, uint256 feeBps);

function governanceDowngradeFeeStage(uint256 newStage) external onlyRole(GOVERNANCE_ROLE) {
    require(newStage < currentFeeStage, "Not a downgrade");
    currentFeeStage = newStage;
    emit FeeStageDowngraded(newStage, feeRateBps[newStage]);
}
```

**설계 원칙:**
- 상승은 자동(Keeper), 하향은 거버넌스 투표 필수
- 마스터 플랜의 "한번 올라간 단계는 내려가지 않음"은 **자동 하강 불가**를 의미. 거버넌스(DAO 투표)를 통한 의도적 하향은 허용
- ADMIN_ROLE이 아닌 GOVERNANCE_ROLE로 제한 → 관리자 독단 불가

---

### 7-E. [MEDIUM #9] 마스터 에이전트 비상 해임

**현황:** `isMasterFounder`는 5년 임기 내 방출 불가. 악의적 행동/완전 비활성 시 제거 불가.

**대응:** TavernRegistry에 거버넌스 비상 해임 함수 추가:

```solidity
event MasterEmergencyRemoved(address indexed agent, string reason);

function emergencyRemoveMaster(address agent, string calldata reason)
    external
    onlyRole(GOVERNANCE_ROLE)
{
    require(isMasterFounder[agent] || isMasterSuccessor[agent], "Not a master");

    isMasterFounder[agent] = false;
    isMasterSuccessor[agent] = false;

    emit MasterEmergencyRemoved(agent, reason);
}
```

**설계 원칙:**
- 일반 방출(monthlySettle)로는 마스터 해임 불가 (마스터 플랜 유지)
- **EmergencyFreeze 거버넌스 프로포절** 통과 시에만 해임 가능
- TavernGovernance의 `ProposalType.EmergencyFreeze`는 타임락 0 (즉시 큐) → 긴급 상황 대응
- `reason` 파라미터로 온체인 사유 기록

**TavernGovernance 연동:**
- `emergencyRemoveMaster()`를 GOVERNANCE_ROLE로 보호
- 배포 시 `TavernRegistry.grantRole(GOVERNANCE_ROLE, governanceAddress)` 추가

---

### 7-F. [MEDIUM #10] USDC 6→18 decimal 정밀도 재검증

**현황:** `_toUsd18()`, `_usd18ToTVRN()`, `_quoteCompensation()`에서 decimal 변환 수행. Slither divide-before-multiply 수정 완료 주장.

**대응 — 테스트로 검증:**

```
test/TavernEscrow.precision.test.ts (신규):

1. 극소액 USDC (1 USDC = 1e6) 정산 시 에이전트 수령액 검증
   - 1 USDC 퀘스트 → 87% × 70% = 0.609 USDC → 반올림 오차 ≤ 1 wei
2. 대액 USDC (1,000,000 USDC) 정산 시 총합 검증
   - 에이전트 현금 + TVRN USD 환산 + 기획 + 검증 + 출석 + 수수료 + 잔여 = 원금
3. ETH 정산 (0.001 ETH ~ 100 ETH 범위)
   - 동일 총합 검증
4. 보상(compensation) 경로: Timeout/UnviewedOneStar/LowScore 각각
   - tvrnAmount + creditAmountUsd18 + operatorAmount 계산 일관성
5. 경계값: depositAmount = 1 (최소), depositAmount = type(uint128).max (오버플로 안전)
```

**Math.mulDiv 사용 확인:**
현재 코드에서 `Math.mulDiv()`을 적극 사용 중인 것은 양호. 추가로 `_toUsd18()`의 나눗셈 경로에서 정밀도 손실 여부만 테스트로 커버.

---

### 7-G. [MEDIUM #7] ETH 전송 패턴 — 이미 해결

**확인 완료:** TavernEscrow.sol L1118에서 이미 `payable(to).call{value: amount}("")` 사용 중.
MASTER_ROADMAP의 `payable(agent).transfer()`는 예시 코드일 뿐, 실제 구현은 올바름.

**추가 조치 불필요.**

---

## 추가 체크리스트 (수정 7)

### AdminPriceFeed.sol (7-A)
- [ ] `isRefresher` 매핑 + `setRefresher()` 추가
- [ ] `refreshPrice()`에 refresher 허용 조건 추가
- [ ] TavernAutomationRouter에 PriceRefresh TaskType 추가
- [ ] checkUpkeep에서 50분 경과 체크
- [ ] performUpkeep에서 refreshPrice() 호출

### TavernEscrow.sol 보안 강화 (7-B, 7-C, 7-D)
- [ ] `MAX_QUEST_DEPOSIT` 상수 + createQuest 한도 체크
- [ ] `settlementPaused` + `whenSettlementActive` modifier
- [ ] `setSettlementPaused()` ADMIN_ROLE 전용
- [ ] `GOVERNANCE_ROLE` 추가
- [ ] `governanceDowngradeFeeStage()` 구현
- [ ] `FeeStageDowngraded` 이벤트

### TavernRegistry.sol 비상 해임 (7-E)
- [ ] `GOVERNANCE_ROLE` 추가
- [ ] `emergencyRemoveMaster()` 구현
- [ ] `MasterEmergencyRemoved` 이벤트

### 거버넌스 와이어링 — 배포 스크립트 (7-C)
- [ ] TavernToken.grantRole(GOVERNANCE_ROLE, governance)
- [ ] TavernEscrow.grantRole(GOVERNANCE_ROLE, governance)
- [ ] TavernRegistry.grantRole(GOVERNANCE_ROLE, governance)

### 정밀도 테스트 (7-F)
- [ ] test/TavernEscrow.precision.test.ts 신규
- [ ] 극소액/대액 USDC 정산 총합 검증
- [ ] ETH 정산 범위 검증
- [ ] 보상 3경로 계산 일관성 검증
- [ ] 경계값 오버플로 안전 검증

### 확인 완료 (조치 불필요)
- [x] ETH 전송 패턴: `call{value}` 사용 확인 (7-G)
