# 작업 11-C — Phase 2 좌표 재배포 (Codex 지시서)

> **목표:** Phase 2 코드가 반영된 TavernRegistry + TavernEscrow를 Base Sepolia에 재배포하고, 기존 TavernToken·TavernStaking·Automation과 재연결한다.
> TavernToken은 재배포하지 않는다 (기존 주소 유지).

---

## 0. 배경

Task 11-B에서 TavernStaking(`0x50a8...621D`)은 배포·검증 완료됐지만, 현재 live TavernRegistry(`0x7749...832a`)에 Phase 2 함수(`stakingContract`, `setStakingContract`, `leaveGuild`, `removeAgent`, `isAgentActive`)가 없어서 연결 실패.

Base Sepolia는 테스트넷이므로 Registry + Escrow를 재배포하는 것이 가장 깨끗한 해법.

---

## 1. 재배포 범위

| 컨트랙트 | 조치 | 이유 |
|----------|------|------|
| TavernToken | **유지** (`0x3b63...2b16`) | 토큰 잔고·BURNER_ROLE 유지 |
| TavernRegistry | **재배포** | Phase 2 코드 (staking hooks, leaveGuild 등) 반영 |
| TavernEscrow | **재배포** | constructor에 registry 주소 하드코딩 → 새 registry 필요 |
| TavernStaking | **유지** (`0x50a8...621D`) | 이미 배포·검증 완료. registry 주소가 immutable이므로 **재배포 필요** 여부 아래 확인 |

### TavernStaking 재배포 필요 여부

TavernStaking의 `registry`는 `immutable`이다 (`0x7749...832a` = 구 Registry).
새 Registry 주소에 대해 `isAgentActive()`를 호출해야 하므로, **TavernStaking도 재배포 필요**.

최종 재배포 대상: **TavernRegistry + TavernEscrow + TavernStaking** (3개)

---

## 2. 재배포 스크립트

`deploy/04_phase2_redeploy.ts` 신규 생성.

### 실행 흐름:

```
1. baseSepolia.json에서 기존 주소 로드
   - TavernToken: 유지
   - USDC, ETH/USD Feed, TVRN/USD Feed: 유지

2. TavernRegistry 재배포
   - constructor(guildToken = TavernToken 주소)
   - ADMIN_ROLE: deployer
   - KEEPER_ROLE: 3개 automation forwarder에 부여 (아래 주소)
   - ARBITER_ROLE: deployer (임시)

3. TavernEscrow 재배포
   - constructor(usdc, tavernToken, newRegistry, ethUsdFeed, tvrnUsdFeed)
   - KEEPER_ROLE: 3개 automation forwarder에 부여
   - ARBITER_ROLE: deployer (임시)

4. TavernStaking 재배포
   - constructor(tavernToken, newRegistry)
   - SLASHER_ROLE: deployer (임시)

5. TavernToken 역할 갱신
   - MINTER_ROLE → newEscrow (기존 escrow에서 revoke 불필요 — 테스트넷)
   - BURNER_ROLE → newStaking
   - ESCROW_ROLE → newEscrow (setUnlockTime 호출용)

6. TavernRegistry 연결
   - setStakingContract(newStaking)

7. Basescan 검증 (3개 컨트랙트)

8. baseSepolia.json 갱신
   - addresses.tavernRegistry = 새 주소
   - addresses.tavernEscrow = 새 주소
   - addresses.tavernStaking = 새 주소
   - 구 주소는 notes 또는 legacy 섹션에 기록

9. baseSepolia.automation.json은 건드리지 않음
   - upkeep 등록은 기존 것 유지 (target 주소 변경 안 됨)
   - 다만 forwarder에 새 Registry/Escrow KEEPER_ROLE 부여 필요 (위 2,3에서 처리)
```

### Automation Forwarder 주소 (하드코딩):

```
dailyQuotaRebalance:      0xf69EDb49324CdE4E70B67EE8D12aBC3c9EED0Fa7
executeTimeout:           0x9022b9B7E858246B7f9B18244012bF38C1880ca9
checkAndUpgradeFeeStage:  0x70BC0311990098e0E4f5FfFAe7b6654DBC00cc70
```

### 주의 — Automation target 주소 변경

기존 upkeep은 **구 Registry/Escrow 주소**를 target으로 등록했다.
새 컨트랙트 주소에 대해 upkeep이 동작하려면 **upkeep 재등록이 필요**하다.

두 가지 선택지:
- **A) upkeep 재등록** — `scripts/register-automation.ts` 재실행 (새 주소 대상)
- **B) 보류** — Phase 2 전체가 live 안정화될 때까지 automation 재등록 보류

→ **선택 A를 실행한다.** 재배포 스크립트 마지막에 안내 메시지 출력:
```
"Run `npx hardhat run scripts/register-automation.ts --network baseSepolia` to re-register upkeeps for new contract addresses."
```

단, `register-automation.ts`가 새 컨트랙트 주소를 baseSepolia.json에서 읽으므로, 매니페스트 갱신이 먼저 완료되어야 한다.

---

## 3. 구 주소 정리

구 컨트랙트에 남은 역할은 테스트넷이므로 revoke 불필요.
단 HANDOFF_RESUME.md에 **구 주소를 legacy로 기록**:

```
Legacy (Phase 1, superseded):
  TavernRegistry: 0x7749473E36a8d6E741d9E581106E81CacAb7832a
  TavernEscrow:   0x243fB879fBE521c5c227Da9EF731968413755131
  TavernStaking:  0x50a8866F7E24441e636aFeB4a276Fd201522621D
```

---

## 4. 프론트엔드 주소 갱신

`claw-tavern-app.html`의 `CONFIG.addresses`를 새 주소로 갱신:
- `tavernRegistry`: 새 주소
- `tavernEscrow`: 새 주소

TavernToken, USDC 주소는 변경 없음.

---

## 5. 파일 목록

| 파일 | 작업 |
|------|------|
| `deploy/04_phase2_redeploy.ts` | **신규** — 재배포 스크립트 |
| `deployments/baseSepolia.json` | **갱신** — 새 주소 반영 |
| `claw-tavern-app.html` | **갱신** — CONFIG.addresses 업데이트 |
| `HANDOFF_RESUME.md` | **갱신** — 새 주소 + legacy 기록 |
| `scripts/verify-contracts.ts` | 확인 — TavernStaking 검증 로직이 새 주소에도 동작하는지 |

---

## 6. 검증 체크리스트 (Cowork 검토용)

### 배포 확인 (on-chain)
- [ ] 새 TavernRegistry 배포 + Basescan 검증
- [ ] 새 TavernEscrow 배포 + Basescan 검증
- [ ] 새 TavernStaking 배포 + Basescan 검증
- [ ] TavernToken은 기존 주소 유지 확인

### 역할 연결 (on-chain)
- [ ] TavernToken.hasRole(MINTER_ROLE, newEscrow) == true
- [ ] TavernToken.hasRole(BURNER_ROLE, newStaking) == true
- [ ] newRegistry.stakingContract() == newStaking
- [ ] newRegistry.hasRole(KEEPER_ROLE, forwarder1) == true (×3 forwarders)
- [ ] newEscrow.hasRole(KEEPER_ROLE, forwarder1) == true (×3 forwarders)
- [ ] newStaking.tvrnToken() == TavernToken
- [ ] newStaking.registry() == newRegistry
- [ ] newEscrow에서 TavernToken.setUnlockTime 호출 가능 (ESCROW_ROLE 확인)

### 매니페스트 + 프론트엔드
- [ ] baseSepolia.json에 새 3개 주소 반영
- [ ] claw-tavern-app.html CONFIG.addresses 갱신
- [ ] HANDOFF_RESUME.md 새 주소 + legacy 기록
- [ ] node --check claw-tavern-app.html 통과

### Automation (후속)
- [ ] `register-automation.ts` 재실행 안내 메시지 출력 확인
- [ ] 또는 실제 재등록 완료 시 baseSepolia.automation.json 갱신
