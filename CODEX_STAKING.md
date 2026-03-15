# 작업 11 — TavernStaking.sol 직업 신청 스테이킹 (Codex 지시서)

> **목표:** 에이전트가 직업(jobType) 신청 시 100 $TVRN을 보증금으로 스테이킹해야 하는 컨트랙트를 신규 생성한다.
> 매도 압력 억제 + 스팸 에이전트 방지가 핵심 목적.

---

## 0. 설계 근거 (백서 참조)

```
경로 2. 직업 신청 보증금
  → 직업 신청 보증금으로 $TVRN 일부 스테이킹 요구
  → 직업을 유지하려면 $TVRN을 보유해야 함 → 매도 압력 감소
```

- 최소 스테이킹: 100 TVRN (STAKE_AMOUNT)
- 직업 유지 중에는 인출 불가
- 직업 해제(자발적 탈퇴 또는 방출) 시 쿨다운 후 인출
- 쿨다운: 7일 (UNSTAKE_COOLDOWN)
- 슬래싱: 방출(kicked) 시 스테이크의 50% 슬래시 → 소각

---

## 1. 기술 스택

| 항목 | 선택 |
|------|------|
| Solidity | ^0.8.20 |
| OpenZeppelin | 5.x — AccessControl, ReentrancyGuard |
| 토큰 인터페이스 | IERC20 (TavernToken 주소) |
| 소각 | TavernToken.burn() 호출 (BURNER_ROLE 필요) |

---

## 2. 상태 변수

```solidity
uint256 public constant STAKE_AMOUNT = 100 * 1e18;      // 100 TVRN
uint256 public constant UNSTAKE_COOLDOWN = 7 days;
uint256 public constant SLASH_BPS = 5000;                // 50% = 5000 BPS

IERC20 public immutable tvrnToken;
ITavernRegistry public immutable registry;

struct StakeInfo {
    uint256 amount;          // 현재 스테이킹 잔액
    uint256 unstakeRequestAt; // 인출 요청 시각 (0이면 미요청)
    bool slashed;            // 슬래싱 여부
}

mapping(address => StakeInfo) public stakes;

bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");
```

---

## 3. 함수

### 3-A. stake()

```
조건:
  - msg.sender에게 STAKE_AMOUNT 이상 TVRN 잔고
  - 기존 스테이크 없거나 amount == 0
  - transferFrom(msg.sender, address(this), STAKE_AMOUNT)
  - stakes[msg.sender].amount = STAKE_AMOUNT
  - stakes[msg.sender].unstakeRequestAt = 0
  - stakes[msg.sender].slashed = false

이벤트: Staked(address indexed agent, uint256 amount)
```

### 3-B. requestUnstake()

```
조건:
  - stakes[msg.sender].amount > 0
  - unstakeRequestAt == 0 (중복 요청 방지)
  - TavernRegistry에서 해당 에이전트가 active가 아닐 것
    → registry.agents(msg.sender).isActive == false
    → 활성 에이전트는 먼저 직업 해제(deactivate)해야 함
  - stakes[msg.sender].unstakeRequestAt = block.timestamp

이벤트: UnstakeRequested(address indexed agent, uint256 unlockAt)
```

### 3-C. withdraw()

```
조건:
  - stakes[msg.sender].amount > 0
  - unstakeRequestAt > 0
  - block.timestamp >= unstakeRequestAt + UNSTAKE_COOLDOWN
  - 슬래싱된 경우: 남은 잔액만 인출

실행:
  - uint256 payout = stakes[msg.sender].amount
  - stakes[msg.sender] = StakeInfo(0, 0, false)  // 초기화
  - tvrnToken.transfer(msg.sender, payout)

이벤트: Withdrawn(address indexed agent, uint256 amount)
```

### 3-D. slash(address agent)

```
접근: onlyRole(SLASHER_ROLE)
조건:
  - stakes[agent].amount > 0
  - !stakes[agent].slashed

실행:
  - uint256 slashAmount = stakes[agent].amount * SLASH_BPS / 10000
  - stakes[agent].amount -= slashAmount
  - stakes[agent].slashed = true
  - stakes[agent].unstakeRequestAt = block.timestamp  // 자동 인출 요청
  - tvrnToken.approve(address(tvrnToken), slashAmount)
  - ITavernToken(address(tvrnToken)).burn(address(this), slashAmount)  // 소각

이벤트: Slashed(address indexed agent, uint256 slashAmount, uint256 remaining)
```

### 3-E. isStaked(address agent) → bool (view)

```
return stakes[agent].amount >= STAKE_AMOUNT && !stakes[agent].slashed;
```

### 3-F. getStakeInfo(address agent) → StakeInfo (view)

```
return stakes[agent];
```

---

## 4. TavernRegistry 연동

TavernRegistry.sol에 다음 수정 필요:

1. `ITavernStaking public stakingContract` 상태 변수 추가
2. `setStakingContract(address)` admin 함수 추가
3. `registerAgent()` 또는 에이전트 활성화 함수에서:
   ```solidity
   require(stakingContract.isStaked(msg.sender), "Stake 100 TVRN first");
   ```
4. 기존 에이전트 등록 로직은 유지 — 스테이킹 체크만 앞에 추가

---

## 5. ITavernToken 인터페이스

```solidity
interface ITavernToken is IERC20 {
    function burn(address from, uint256 amount) external;
}
```

TavernStaking이 BURNER_ROLE을 받아야 burn() 호출 가능.
배포 후 `TavernToken.grantRole(BURNER_ROLE, TavernStaking.address)` 필요.

---

## 6. 배포 순서

```
1. TavernStaking.sol 컴파일
2. deploy/03_deploy_staking.ts 신규 작성
   - TavernStaking(tvrnToken, registry) 배포
   - TavernToken에서 BURNER_ROLE 부여
   - TavernRegistry에서 setStakingContract() 호출
   - baseSepolia.json에 TavernStaking 주소 추가
3. scripts/verify-contracts.ts에 TavernStaking 추가
```

---

## 7. 파일 목록

| 파일 | 작업 |
|------|------|
| `contracts/TavernStaking.sol` | 신규 생성 |
| `contracts/interfaces/ITavernToken.sol` | 신규 생성 (또는 기존 인터페이스에 추가) |
| `contracts/interfaces/ITavernStaking.sol` | 신규 생성 |
| `contracts/TavernRegistry.sol` | 수정 — 스테이킹 체크 추가 |
| `deploy/03_deploy_staking.ts` | 신규 생성 |
| `scripts/verify-contracts.ts` | 수정 — TavernStaking 추가 |
| `deployments/baseSepolia.json` | 배포 후 업데이트 |

---

## 8. 보안 고려사항

- ReentrancyGuard 적용 (withdraw, slash)
- slash()는 SLASHER_ROLE만 호출 가능 — admin이 방출 결정 시 호출
- withdraw() 시 잔액 먼저 0으로 설정 후 transfer (CEI 패턴)
- 슬래싱+소각은 한 트랜잭션에서 완료 (중간 상태 없음)
- STAKE_AMOUNT은 immutable constant — 변경 불가 (Phase 2 거버넌스에서 upgradeable로 전환 가능하나 현재는 고정)

---

## 9. 검증 체크리스트 (Cowork 검토용)

- [ ] TavernStaking.sol 컴파일 성공 (hardhat compile)
- [ ] STAKE_AMOUNT = 100e18, UNSTAKE_COOLDOWN = 7 days, SLASH_BPS = 5000
- [ ] stake(): transferFrom 정상, StakeInfo 초기화
- [ ] requestUnstake(): isActive == false 체크, 중복 방지
- [ ] withdraw(): 쿨다운 경과 확인, CEI 패턴, 잔액 초기화 후 transfer
- [ ] slash(): SLASHER_ROLE 체크, 50% 소각, 자동 unstakeRequest
- [ ] isStaked() view 함수 존재
- [ ] TavernRegistry에 stakingContract 변수 + isStaked 체크 추가
- [ ] deploy/03_deploy_staking.ts 존재 + BURNER_ROLE 부여 로직
- [ ] ReentrancyGuard 적용 (withdraw, slash)
- [ ] 이벤트 4개: Staked, UnstakeRequested, Withdrawn, Slashed
- [ ] HANDOFF_RESUME.md에 Task 11 반영
