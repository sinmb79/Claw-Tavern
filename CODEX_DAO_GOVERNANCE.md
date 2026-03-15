# Task 12 — TavernGovernance.sol (Codex 지시서)

> **목표:** $TVRN 기반 DAO 거버넌스 컨트랙트를 구현한다. 제안 → 투표 → 타임락 → 실행 흐름. sqrt 투표권, 파운딩 배지 가산, 긴급 동결을 지원한다.

---

## 0. 의존성

| 항목 | 값 |
|------|---|
| Solidity | `^0.8.20` |
| OpenZeppelin | `5.x` (AccessControl, ReentrancyGuard) |
| TavernToken | `0x3b63deb3632b2484bAb6069281f08642ab112b16` |
| TavernRegistry | `0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33` |
| TavernEscrow | `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` |

TavernGovernance는 TavernToken 잔액 읽기(balanceOf) + TavernRegistry 읽기(파운딩 배지, 에이전트 활동) 만 필요하다.
**실행(execution) 시 타겟 컨트랙트의 함수를 직접 call하는 구조**가 아니라, **GOVERNANCE_ROLE을 가진 주소로서 타겟 컨트랙트의 onlyGovernance 함수를 호출**하는 구조다.

---

## 1. 컨트랙트 설계 — `TavernGovernance.sol`

### 1-A. 상수

```solidity
uint256 public constant VOTING_PERIOD = 5 days;
uint256 public constant TIMELOCK_DELAY = 2 days;      // 일반 제안
uint256 public constant QUORUM_BPS = 1000;             // 10% of total voting power
uint256 public constant PROPOSAL_THRESHOLD = 100e18;   // 최소 100 TVRN 보유해야 제안 가능
uint256 public constant FOUNDING_BONUS_BPS = 15000;    // 1.5x = 150% (BPS 기준)
uint256 public constant FOUNDING_BONUS_BASE = 10000;
```

### 1-B. 제안 타입

```solidity
enum ProposalType {
    GuildFeeChange,        // 길드 수수료 변경
    GuildMasterChange,     // 길드 마스터 교체
    SubTokenIssuance,      // 서브토큰 발행 승인
    PlatformFeeChange,     // 플랫폼 수수료 단계 변경
    ForceDissolveGuild,    // 길드 강제 해산
    EmergencyFreeze        // 긴급 동결 (타임락 없음)
}
```

### 1-C. 제안 구조체

```solidity
enum ProposalState { Active, Defeated, Queued, Executed, Cancelled }

struct Proposal {
    uint256 id;
    address proposer;
    ProposalType proposalType;
    bytes callData;           // 실행 시 타겟에 보낼 calldata
    address target;           // 실행 대상 컨트랙트
    uint256 forVotes;
    uint256 againstVotes;
    uint256 abstainVotes;
    uint256 startTime;        // block.timestamp at creation
    uint256 endTime;          // startTime + VOTING_PERIOD
    uint256 eta;              // 실행 예정 시각 (endTime + TIMELOCK_DELAY)
    ProposalState state;
    string description;       // 짧은 설명 문자열
}
```

### 1-D. 상태 변수

```solidity
ITavernToken public immutable tavernToken;
ITavernRegistry public immutable registry;

uint256 public nextProposalId;
mapping(uint256 => Proposal) public proposals;
mapping(uint256 => mapping(address => bool)) public hasVoted;

// 투표 시점 잔액 스냅샷 (제안 생성 시 block.number 기록)
mapping(uint256 => uint256) public snapshotBlock;
```

> **중요:** 실제 스냅샷 투표(ERC20Votes)는 Phase 3 범위. 이번 구현은 **제안 생성 시점의 balanceOf를 기준으로 투표력을 산정**하는 단순 방식. 주석으로 "Phase 3: ERC20Votes 스냅샷으로 교체 예정" 명시.

### 1-E. 투표력 계산 — `getVotingPower(address voter, uint256 proposalId)`

```
votingPower = sqrt(balance) × activityBonus × foundingBonus
```

구현 세부:

1. `balance` = `tavernToken.balanceOf(voter)` (Phase 3에서 스냅샷으로 교체)
2. `sqrt(balance)` — Babylonian method로 정수 제곱근 계산 (`_sqrt(uint256)` internal pure)
3. `activityBonus`:
   - `registry.isAgentActive(voter) == true` → 12000 (1.2x, BPS)
   - 그 외 → 10000 (1.0x)
4. `foundingBonus`:
   - `registry.isFoundingAgent(voter) == true` → 15000 (1.5x)
   - 그 외 → 10000 (1.0x)
5. 최종: `sqrt(balance) * activityBonus / 10000 * foundingBonus / 10000`

> **TavernRegistry에 추가 필요한 view 함수:**
> - `isFoundingAgent(address) returns (bool)` — 파운딩 배지 보유 여부
> - `isAgentActive(address) returns (bool)` — 이미 존재 (Task 11에서 추가됨)

### 1-F. 핵심 함수

#### `propose(ProposalType pType, address target, bytes calldata callData, string calldata description) → uint256`

- `require(tavernToken.balanceOf(msg.sender) >= PROPOSAL_THRESHOLD)`
- 새 `Proposal` 생성, `state = Active`
- `endTime = block.timestamp + VOTING_PERIOD`
- emit `ProposalCreated(id, proposer, pType, target, description)`

#### `vote(uint256 proposalId, uint8 support)` — support: 0=Against, 1=For, 2=Abstain

- `require(state == Active && block.timestamp <= endTime)`
- `require(!hasVoted[proposalId][msg.sender])`
- 투표력 계산 후 forVotes/againstVotes/abstainVotes에 가산
- `hasVoted[proposalId][msg.sender] = true`
- emit `VoteCast(proposalId, voter, support, votingPower)`

#### `queue(uint256 proposalId)`

- `require(block.timestamp > endTime)` (투표 종료 후)
- quorum 체크: `forVotes + againstVotes + abstainVotes >= _quorum()`
- 통과 조건: `forVotes > againstVotes`
- `state = Queued`, `eta = block.timestamp + TIMELOCK_DELAY`
- `EmergencyFreeze` 타입이면 `eta = block.timestamp` (즉시 실행 가능)
- emit `ProposalQueued(id, eta)`

#### `execute(uint256 proposalId)`

- `require(state == Queued && block.timestamp >= eta)`
- `(bool ok,) = proposal.target.call(proposal.callData)`
- `require(ok, "Execution failed")`
- `state = Executed`
- emit `ProposalExecuted(id)`

#### `cancel(uint256 proposalId)`

- proposer 본인 또는 DEFAULT_ADMIN_ROLE 만 호출 가능
- `require(state == Active || state == Queued)`
- `state = Cancelled`
- emit `ProposalCancelled(id)`

### 1-G. 내부 함수

#### `_sqrt(uint256 x) internal pure returns (uint256)`

Babylonian method:
```solidity
if (x == 0) return 0;
uint256 z = (x + 1) / 2;
uint256 y = x;
while (z < y) {
    y = z;
    z = (x / z + z) / 2;
}
return y;
```

#### `_quorum() internal view returns (uint256)`

```solidity
// 전체 투표력 추정: sqrt(totalSupply) 의 QUORUM_BPS%
uint256 totalVotingPower = _sqrt(tavernToken.totalSupply());
return totalVotingPower * QUORUM_BPS / 10000;
```

### 1-H. 이벤트

```solidity
event ProposalCreated(uint256 indexed id, address indexed proposer, ProposalType pType, address target, string description);
event VoteCast(uint256 indexed proposalId, address indexed voter, uint8 support, uint256 votingPower);
event ProposalQueued(uint256 indexed id, uint256 eta);
event ProposalExecuted(uint256 indexed id);
event ProposalCancelled(uint256 indexed id);
```

### 1-I. 접근 제어

- constructor: `tavernToken`, `registry` 를 immutable 으로 받는다.
- DEFAULT_ADMIN_ROLE: deployer에게 부여
- **GOVERNANCE_ROLE은 이 컨트랙트 자체가 아니라, 타겟 컨트랙트(Token, Registry, Escrow)에 부여하는 역할.** 즉 TavernGovernance가 실행할 때 `target.call(callData)` 방식이므로, 타겟 컨트랙트에서 TavernGovernance 주소에 적절한 role을 부여해야 한다.
- Phase 3 범위: 타겟 컨트랙트에 `GOVERNANCE_ROLE` 추가 + `onlyGovernance` modifier. **이번에는 구현하지 않는다.** 주석으로 `// Phase 3: grant GOVERNANCE_ROLE to TavernGovernance address on target contracts` 표시.

---

## 2. TavernRegistry.sol 수정

### 2-A. `isFoundingAgent(address)` 추가

```solidity
mapping(address => bool) public isFoundingAgent;

function setFoundingAgent(address agent, bool status) external onlyRole(DEFAULT_ADMIN_ROLE) {
    isFoundingAgent[agent] = status;
    emit FoundingAgentSet(agent, status);
}
```

이벤트: `event FoundingAgentSet(address indexed agent, bool status);`

---

## 3. 인터페이스

### `contracts/interfaces/ITavernGovernance.sol`

```solidity
interface ITavernGovernance {
    function getVotingPower(address voter, uint256 proposalId) external view returns (uint256);
    function propose(uint8 pType, address target, bytes calldata callData, string calldata description) external returns (uint256);
    function vote(uint256 proposalId, uint8 support) external;
    function queue(uint256 proposalId) external;
    function execute(uint256 proposalId) external;
}
```

### ITavernRegistry 업데이트

기존 `ITavernRegistryStatus`에 `isFoundingAgent(address) returns (bool)` 추가.
또는 별도 인터페이스 `ITavernRegistryGovernance`로 분리해도 된다.

---

## 4. 배포 스크립트 — `deploy/05_deploy_governance.ts`

### 절차

1. `baseSepolia.json`에서 `tavernToken`, `tavernRegistry` 주소 로드
2. `TavernGovernance` 배포: `constructor(tavernToken, tavernRegistry)`
3. Basescan 검증
4. `baseSepolia.json`에 `tavernGovernance` 주소 추가
5. `claw-tavern-app.html` CONFIG에 `tavernGovernance` 주소 추가
6. `HANDOFF_RESUME.md` 업데이트

### 역할 부여 (이번에는 하지 않는다)

Phase 3에서 타겟 컨트랙트에 GOVERNANCE_ROLE을 부여할 때까지, TavernGovernance는 투표/제안 기록용으로만 동작한다. execute()는 타겟 컨트랙트에 role이 없으면 revert된다 — 이것은 의도된 동작이다.

주석으로 명시:
```
// Phase 3: grant appropriate roles to TavernGovernance on target contracts
// e.g., TavernToken.grantRole(GOVERNANCE_ROLE, tavernGovernance)
```

---

## 5. 테스트 — Hardhat 로컬 검증

### 5-A. 컴파일

```bash
npx hardhat compile
```

### 5-B. 로컬 배포 + 기본 검증 (선택)

- TavernGovernance 배포 성공
- `nextProposalId == 0`
- `getVotingPower` 계산 정확성 (100 TVRN 보유 시 sqrt(100e18) ≈ 10e9)
- propose → vote → queue → execute 흐름 (타겟에 role 없으면 execute에서 revert — 예상 동작)

### 5-C. TypeScript 정합

```bash
npx tsc --noEmit
```

---

## 6. 파일 목록

| 파일 | 작업 |
|------|------|
| `contracts/TavernGovernance.sol` | **생성** |
| `contracts/interfaces/ITavernGovernance.sol` | **생성** |
| `contracts/TavernRegistry.sol` | **수정** — `isFoundingAgent` 추가 |
| `contracts/TavernImports.sol` | **수정** — TavernGovernance import 추가 |
| `deploy/05_deploy_governance.ts` | **생성** |
| `deployments/baseSepolia.json` | **갱신** — `tavernGovernance` 주소 |
| `claw-tavern-app.html` | **갱신** — CONFIG에 주소 추가 |
| `HANDOFF_RESUME.md` | **갱신** — Task 12 완료 기록 |

---

## 7. 검증 체크리스트 (Cowork 검토용)

### 컨트랙트 구현
- [ ] `TavernGovernance.sol` 존재, `^0.8.20`, OZ 5.x
- [ ] ProposalType enum 6종 정의
- [ ] Proposal struct: id, proposer, pType, callData, target, votes(3종), times, state, description
- [ ] `getVotingPower()`: sqrt + activityBonus + foundingBonus 정확
- [ ] `_sqrt()` Babylonian method, 0 입력 시 0 반환
- [ ] `propose()`: threshold 체크, Active 상태, endTime 설정, 이벤트
- [ ] `vote()`: 중복 투표 방지, 3-way support, 이벤트
- [ ] `queue()`: quorum 체크, forVotes > againstVotes, eta 계산, EmergencyFreeze 즉시 가능
- [ ] `execute()`: eta 이후 실행, target.call(callData), 성공 확인
- [ ] `cancel()`: proposer 또는 admin만, Active/Queued에서만
- [ ] ReentrancyGuard 적용 (execute 에 nonReentrant)

### Registry 수정
- [ ] `isFoundingAgent` mapping + `setFoundingAgent()` admin 함수
- [ ] `FoundingAgentSet` 이벤트

### 인터페이스
- [ ] `ITavernGovernance.sol` 존재
- [ ] `ITavernRegistryStatus` 또는 별도 인터페이스에 `isFoundingAgent` 추가

### 배포 & 검증
- [ ] `deploy/05_deploy_governance.ts` 존재
- [ ] `npx hardhat compile` 성공
- [ ] `npx tsc --noEmit` 성공
- [ ] Base Sepolia 배포 + Basescan 검증 (선택 — Boss 판단)
- [ ] `baseSepolia.json` 갱신
- [ ] `claw-tavern-app.html` CONFIG 갱신
- [ ] `HANDOFF_RESUME.md` Task 12 기록

### Phase 3 명시
- [ ] "Phase 3: ERC20Votes 스냅샷" 주석 존재
- [ ] "Phase 3: GOVERNANCE_ROLE grant" 주석 존재

---

## 8. 하지 않는 것

- ERC20Votes (delegate/checkpoint) — Phase 3
- GOVERNANCE_ROLE 을 타겟 컨트랙트에 부여 — Phase 3
- TavernSubToken.sol — Task 별도
- 프론트엔드 Governance UI — Task 15
- 제안 실행의 실제 onchain 효과 — Phase 3에서 role wiring 후 활성화
