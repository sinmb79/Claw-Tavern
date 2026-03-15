# Task 13 — ERC-8004 Identity + Reputation 연동 (Codex 지시서)

> **목표:** TavernRegistry.sol의 `registerWithERC8004()` stub을 실제 구현으로 교체하고, 퀘스트 완료 시 ERC-8004 Reputation Registry에 평판을 미러링하는 연동 레이어를 추가한다. ERC-8004 미등록 에이전트도 기존 자체 등록으로 참여 가능한 이중 경로를 유지한다.

---

## 0. ERC-8004 개요

ERC-8004 "Trustless Agents"는 3개 온체인 레지스트리를 정의한다.

| 레지스트리 | 역할 | 이번 Task 범위 |
|-----------|------|--------------|
| Identity Registry | ERC-721 기반 에이전트 신원 NFT. `registerAgent(address, string agentURI)` | ✅ 연동 |
| Reputation Registry | 에이전트 평판 피드백. `giveFeedback(uint256 agentId, uint8 score, ...)` | ✅ 미러링 |
| Validation Registry | ZKP 기반 모델 검증 | ❌ Phase 3 |

---

## 1. 인터페이스 정의

### 1-A. `contracts/interfaces/IERC8004Identity.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC-8004 Identity Registry interface for Claw Tavern integration.
interface IERC8004Identity {
    /// @notice Check if an agent address has a registered identity NFT.
    function getAgent(address agentAddress) external view returns (string memory agentURI);

    /// @notice ERC-721 ownerOf — verify the agent owns the identity NFT.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice ERC-721 balanceOf — check if address has any identity NFT.
    function balanceOf(address owner) external view returns (uint256);
}
```

### 1-B. `contracts/interfaces/IERC8004Reputation.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal ERC-8004 Reputation Registry interface for Claw Tavern integration.
interface IERC8004Reputation {
    /// @notice Post feedback for an agent.
    /// @param agentId   The ERC-8004 identity token ID of the agent
    /// @param score     Rating (1-5)
    /// @param tag1      Primary category tag (e.g., keccak256("quest_completion"))
    /// @param tag2      Secondary category tag (e.g., keccak256("coding"))
    /// @param fileuri   IPFS URI to detailed feedback (or empty string)
    /// @param filehash  Hash of the feedback file (or bytes32(0))
    /// @param feedbackAuth  Signed authorization from the agent (EIP-191 or ERC-1271)
    function giveFeedback(
        uint256 agentId,
        uint8 score,
        bytes32 tag1,
        bytes32 tag2,
        string calldata fileuri,
        bytes32 filehash,
        bytes calldata feedbackAuth
    ) external;
}
```

> **Note:** `feedbackAuth` 서명 검증은 ERC-8004 Reputation Registry 측에서 수행한다. Claw Tavern은 Escrow가 ARBITER_ROLE로 호출하므로 빈 bytes를 보내도 테스트넷에서 동작한다. 프로덕션 연동 시 서명 로직은 Phase 3에서 추가한다.

---

## 2. TavernRegistry.sol 수정

### 2-A. 새 상태 변수

```solidity
IERC8004Identity public erc8004Identity;
IERC8004Reputation public erc8004Reputation;

/// @notice Mapping: agent address → ERC-8004 identity token ID (0 = not linked)
mapping(address => uint256) public erc8004TokenId;

/// @notice Whether ERC-8004 identity is REQUIRED for joinGuild (false = optional)
bool public erc8004Required;
```

### 2-B. Admin 설정 함수

```solidity
function setERC8004Identity(address _identity) external onlyRole(DEFAULT_ADMIN_ROLE) {
    erc8004Identity = IERC8004Identity(_identity);
    emit ERC8004IdentitySet(_identity);
}

function setERC8004Reputation(address _reputation) external onlyRole(DEFAULT_ADMIN_ROLE) {
    erc8004Reputation = IERC8004Reputation(_reputation);
    emit ERC8004ReputationSet(_reputation);
}

function setERC8004Required(bool required) external onlyRole(DEFAULT_ADMIN_ROLE) {
    erc8004Required = required;
    emit ERC8004RequiredSet(required);
}
```

### 2-C. `registerWithERC8004()` — stub 교체

기존 stub 제거하고 실제 구현으로 교체:

```solidity
/// @notice Link an ERC-8004 identity NFT to the caller's Tavern profile.
/// @param tokenId  The ERC-8004 Identity NFT token ID owned by msg.sender.
/// @return linked  true if successfully linked.
function registerWithERC8004(uint256 tokenId) external returns (bool linked) {
    require(address(erc8004Identity) != address(0), "ERC-8004 Identity not configured");
    require(erc8004Identity.ownerOf(tokenId) == msg.sender, "Not NFT owner");
    require(erc8004TokenId[msg.sender] == 0, "Already linked");

    // Verify the agent URI exists (not empty)
    string memory uri = erc8004Identity.getAgent(msg.sender);
    require(bytes(uri).length > 0, "No agent URI registered");

    erc8004TokenId[msg.sender] = tokenId;
    emit ERC8004Linked(msg.sender, tokenId, uri);
    return true;
}

/// @notice Unlink ERC-8004 identity from caller's profile.
function unlinkERC8004() external {
    require(erc8004TokenId[msg.sender] != 0, "Not linked");
    uint256 oldTokenId = erc8004TokenId[msg.sender];
    erc8004TokenId[msg.sender] = 0;
    emit ERC8004Unlinked(msg.sender, oldTokenId);
}

/// @notice Check if an agent has a linked ERC-8004 identity.
function hasERC8004Identity(address agent) external view returns (bool) {
    return erc8004TokenId[agent] != 0;
}
```

> **함수 시그니처 변경:** 기존 stub은 `registerWithERC8004(address)` — 새 구현은 `registerWithERC8004(uint256)`. 파라미터 타입이 달라지므로 ABI 호환 문제 없음 (selector가 다름). 기존 stub 함수를 완전 삭제하고 새 함수로 교체한다.

### 2-D. `joinGuild()` 수정 — ERC-8004 게이트 (선택적)

기존 `joinGuild()` 에 조건 추가:

```solidity
// 기존 staking gate 뒤에 추가
if (erc8004Required && address(erc8004Identity) != address(0)) {
    require(erc8004TokenId[msg.sender] != 0, "Link ERC-8004 identity first");
}
```

`erc8004Required == false`(기본값)이면 기존과 동일하게 동작. Admin이 `setERC8004Required(true)` 호출해야 강제됨.

### 2-E. 평판 미러링 함수

```solidity
/// @notice Mirror a reputation update to ERC-8004 Reputation Registry.
/// @dev Called internally or by ARBITER_ROLE after quest settlement.
function mirrorReputationToERC8004(
    address agent,
    uint8 score,
    bytes32 questTag
) external onlyRole(ARBITER_ROLE) {
    if (address(erc8004Reputation) == address(0)) return; // not configured, skip
    uint256 tokenId = erc8004TokenId[agent];
    if (tokenId == 0) return; // agent not linked, skip

    // Best-effort: don't revert if external call fails
    try erc8004Reputation.giveFeedback(
        tokenId,
        score,
        questTag,                          // tag1: quest category
        bytes32("claw_tavern"),            // tag2: platform identifier
        "",                                // fileuri: empty for now
        bytes32(0),                        // filehash: empty for now
        ""                                 // feedbackAuth: empty (Phase 3)
    ) {
        emit ERC8004ReputationMirrored(agent, tokenId, score, questTag);
    } catch {
        // Silently skip — mirroring is best-effort
    }
}
```

### 2-F. 새 이벤트

```solidity
event ERC8004IdentitySet(address indexed identity);
event ERC8004ReputationSet(address indexed reputation);
event ERC8004RequiredSet(bool required);
event ERC8004Linked(address indexed agent, uint256 indexed tokenId, string agentURI);
event ERC8004Unlinked(address indexed agent, uint256 indexed tokenId);
event ERC8004ReputationMirrored(address indexed agent, uint256 indexed tokenId, uint8 score, bytes32 questTag);
```

---

## 3. TavernEscrow.sol 수정 (최소)

### 3-A. 평판 미러링 호출

`_notifyRegistryReputation()` 함수 끝에 미러링 호출을 추가:

```solidity
function _notifyRegistryReputation(address agent, int256 reputationDelta) internal {
    // ... 기존 로직 유지 ...

    // ERC-8004 mirroring (best-effort)
    if (reputationDelta > 0) {
        uint8 score = uint8(_min(uint256(reputationDelta) / 10, 5)); // normalize to 1-5
        if (score == 0) score = 1;
        try ITavernRegistry(registry).mirrorReputationToERC8004(
            agent,
            score,
            bytes32("quest_completed")
        ) {} catch {}
    }
}
```

> **중요:** `mirrorReputationToERC8004`는 `onlyRole(ARBITER_ROLE)` — TavernEscrow는 이미 Registry에서 `ARBITER_ROLE`을 가지고 있으므로 추가 role 부여 불필요.

---

## 4. 외부 평판 임포트 (읽기 전용, 선택)

### 4-A. `getExternalReputation()` view 함수

TavernRegistry에 추가:

```solidity
/// @notice Read an agent's ERC-8004 reputation feedback count.
/// @dev This is a convenience view. Actual scoring logic stays in Claw Tavern.
///      Phase 3 will add weighted import for initial trust scoring.
function getExternalReputation(address agent) external view returns (uint256 tokenId, bool hasIdentity) {
    tokenId = erc8004TokenId[agent];
    hasIdentity = tokenId != 0;
    // Phase 3: fetch actual reputation score from erc8004Reputation
}
```

---

## 5. 배포 — 코드 변경만, 재배포 불필요

### 5-A. 왜 재배포가 필요한가

TavernRegistry는 **프록시 패턴이 아닌 immutable 배포**이므로, 새 상태 변수·함수 추가는 재배포를 요구한다.

**하지만:** TavernGovernance가 아직 live deploy 전이고, TavernStaking·TavernEscrow 모두 `registry` 주소를 immutable로 갖고 있다.
→ **Registry를 재배포하면 Staking·Escrow도 재배포해야 한다 (Phase 2 redeploy 전례 있음).**

### 5-B. 두 가지 경로

**경로 A — Phase 3 통합 재배포 시 포함 (권장)**
- 이번 Task에서는 코드 변경만 완료하고, 컴파일·로컬 검증까지만 수행
- 실제 배포는 Phase 3 통합 재배포 시 한 번에 진행
- TavernGovernance live deploy도 이때 함께

**경로 B — 지금 재배포**
- `deploy/04_phase2_redeploy.ts`를 재사용해 Registry+Escrow+Staking+Governance 한 번에 재배포
- Automation upkeep도 다시 재등록

**Codex는 경로 A를 기본으로 수행한다.** Boss가 경로 B를 원하면 별도 지시.

### 5-C. 경로 A 실행 사항

```bash
# 1. 코드 수정 후 컴파일
npx hardhat compile

# 2. TypeScript 정합
npx tsc --noEmit

# 3. 로컬 배포 검증 (optional)
npx hardhat run deploy/05_deploy_governance.ts
```

---

## 6. 테스트

### 6-A. 컴파일 통과

```bash
npx hardhat compile
```

### 6-B. TypeScript 정합

```bash
npx tsc --noEmit
```

### 6-C. 로컬 검증 (선택)

- ERC-8004 인터페이스를 만족하는 MockERC8004Identity, MockERC8004Reputation 작성 (테스트 전용)
- `registerWithERC8004(tokenId)` 호출 후 `erc8004TokenId[agent]` 확인
- `mirrorReputationToERC8004()` 호출 후 이벤트 emit 확인
- `erc8004Required = true` 일 때 `joinGuild()` 이 linked agent만 허용하는지 확인

---

## 7. 파일 목록

| 파일 | 작업 |
|------|------|
| `contracts/interfaces/IERC8004Identity.sol` | **생성** |
| `contracts/interfaces/IERC8004Reputation.sol` | **생성** |
| `contracts/TavernRegistry.sol` | **수정** — ERC-8004 연동 추가, stub 교체 |
| `contracts/TavernEscrow.sol` | **수정** — `_notifyRegistryReputation`에 미러링 호출 추가 |
| `contracts/TavernImports.sol` | **수정** — 새 인터페이스 import 추가 (필요 시) |
| `HANDOFF_RESUME.md` | **갱신** — Task 13 기록 |

> MockERC8004Identity.sol, MockERC8004Reputation.sol은 테스트 편의를 위해 작성해도 좋으나 필수는 아님.

---

## 8. 검증 체크리스트 (Cowork 검토용)

### 인터페이스
- [ ] `IERC8004Identity.sol` 존재 — `getAgent`, `ownerOf`, `balanceOf`
- [ ] `IERC8004Reputation.sol` 존재 — `giveFeedback` 7-param

### Registry 수정
- [ ] `erc8004Identity`, `erc8004Reputation` 상태 변수
- [ ] `erc8004TokenId` mapping
- [ ] `erc8004Required` bool + setter
- [ ] `setERC8004Identity()`, `setERC8004Reputation()` — admin only
- [ ] `registerWithERC8004(uint256)` — ownerOf 체크, URI 존재 체크, 이벤트
- [ ] `unlinkERC8004()` — 호출자 본인만
- [ ] `hasERC8004Identity()` view
- [ ] `mirrorReputationToERC8004()` — ARBITER_ROLE, try/catch, best-effort
- [ ] `getExternalReputation()` view — Phase 3 placeholder
- [ ] 기존 `registerWithERC8004(address)` stub 완전 삭제
- [ ] `joinGuild()`에 `erc8004Required` 조건 추가
- [ ] 6개 이벤트 정의

### Escrow 수정
- [ ] `_notifyRegistryReputation()`에 미러링 호출 추가
- [ ] delta→score 정규화 (1-5 범위)
- [ ] try/catch로 감싸서 revert 방지

### 빌드 & 정합
- [ ] `npx hardhat compile` 성공
- [ ] `npx tsc --noEmit` 성공
- [ ] `HANDOFF_RESUME.md` Task 13 기록

### Phase 3 명시
- [ ] "Phase 3: feedbackAuth 서명 로직" 주석
- [ ] "Phase 3: getExternalReputation weighted import" 주석
- [ ] "Phase 3: Validation Registry ZKP" 주석
- [ ] "배포는 경로 A (Phase 3 통합 재배포) 대기" 명시

---

## 9. 하지 않는 것

- ERC-8004 Validation Registry (ZKP) — Phase 3
- `feedbackAuth` 서명 생성/검증 — Phase 3
- 외부 평판 점수를 Claw Tavern 입장 조건으로 가중치 적용 — Phase 3
- Base Sepolia 재배포 — 경로 A (코드 변경만, 배포 대기)
- MockERC8004 컨트랙트 작성 — 선택 사항
