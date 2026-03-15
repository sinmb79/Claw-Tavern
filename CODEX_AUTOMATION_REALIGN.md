# 작업 11-D — Automation Upkeep 재정렬 (Codex 지시서)

> **목표:** Phase 2 재배포로 변경된 TavernRegistry·TavernEscrow 주소에 맞춰 Chainlink Automation upkeep을 재등록하고, `baseSepolia.automation.json`을 새 live 주소 기준으로 갱신한다.

---

## 0. 문제

현재 `baseSepolia.automation.json`의 upkeep 3건은 **구 주소**를 target으로 가리키고 있다:

| Upkeep | 현재 target (구) | 올바른 target (신) |
|--------|-----------------|-------------------|
| dailyQuotaRebalance | `0x7749473E36a8d6E741d9E581106E81CacAb7832a` | `0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33` |
| executeTimeout | `0x243fB879fBE521c5c227Da9EF731968413755131` | `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` |
| checkAndUpgradeFeeStage | `0x243fB879fBE521c5c227Da9EF731968413755131` | `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` |

`register-automation.ts`는 기존 upkeep이 on-chain에서 active이면 **이름 기준으로 skip**하는 로직이 있다.
구 upkeep이 아직 Chainlink registry에서 active 상태이므로, 그냥 재실행하면 구 주소 그대로 유지된다.

---

## 1. 수정 사항 — `scripts/register-automation.ts`

### 1-A. Target 불일치 감지 (핵심)

기존 skip 조건:
```typescript
const newRegistrationsNeeded = upkeeps.filter((upkeep) => {
  const status = existingStatuses.get(upkeep.name);
  return !status?.isActive;
}).length;
```

이 조건에 **target 불일치 검사**를 추가:

```
skip 조건: status.isActive === true AND status.entry.target === upkeep.target
재등록 조건: status.isActive === false OR status.entry.target !== upkeep.target
```

구체적으로:
1. `existingStatuses` Map 생성 시 `entry.target`도 보존한다 (이미 `ExistingUpkeepEntry`에 있음).
2. 메인 루프에서 skip 판단 시, `status.isActive && existingTarget === newTarget`일 때만 skip.
3. `status.isActive && existingTarget !== newTarget`이면 로그 출력 후 **재등록 진행**.

로그 형식:
```
Re-registering ${upkeep.name}: target changed from ${oldTarget} to ${newTarget}.
```

### 1-B. 기존 upkeep 취소는 하지 않는다

구 upkeep은 Chainlink registry에 남겨둔다 (테스트넷이므로 가스 낭비 최소화).
새 upkeep이 등록되면 automation manifest에는 새 upkeep만 기록된다.

### 1-C. Forwarder KEEPER_ROLE 부여

새 upkeep의 forwarder가 구 forwarder와 다를 수 있다.
새 forwarder에도 TavernRegistry + TavernEscrow에서 `KEEPER_ROLE`을 부여해야 한다.
**기존 로직이 이미 이 부분을 처리**하므로 변경 불필요. 확인만 한다.

---

## 2. 실행 순서

```bash
# 1. 스크립트 수정 후 실행
npx hardhat run scripts/register-automation.ts --network baseSepolia

# 2. 결과 확인
cat deployments/baseSepolia.automation.json
```

---

## 3. 검증 체크리스트 (Cowork 검토용)

### 스크립트 수정
- [ ] `register-automation.ts`에 target 불일치 감지 로직 추가
- [ ] 기존 active upkeep이라도 target이 다르면 재등록하는 분기 확인
- [ ] target 변경 시 로그 메시지 출력 확인

### 실행 결과
- [ ] 3건 모두 새 upkeep ID로 재등록됨 (또는 LINK 잔고 부족 시 명확한 에러 출력)
- [ ] `baseSepolia.automation.json` 갱신:
  - `upkeeps[0].target` == `0x7f4fd10f1F0F847a68855f364a1C09cBF2831D33` (new Registry)
  - `upkeeps[1].target` == `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` (new Escrow)
  - `upkeeps[2].target` == `0x1528580Db5fDfbaC2fe9d364D9De402490032ccD` (new Escrow)
- [ ] 새 forwarder에 KEEPER_ROLE 부여됨 (또는 기존 forwarder 재사용 시 already-granted)
- [ ] backup manifest 생성 확인 (`baseSepolia.automation.backup.json`)

### HANDOFF_RESUME.md 갱신
- [ ] Automation State 섹션에 새 upkeep ID 기록
- [ ] "upkeep registration flow should still be rerun" 메모 제거
- [ ] Task 11 상태에 "automation re-aligned" 추가

---

## 4. LINK 잔고 부족 시

deployer 주소에 LINK이 부족하면 스크립트가 에러를 출력하고 중단한다.
이 경우 Chainlink faucet에서 LINK을 받아야 한다:
- https://faucets.chain.link/base-sepolia
- deployer: `0xf95232Ae6a716862799C90239028fb590C9bB307`

최소 `0.3 LINK` 필요 (3건 × 0.1 LINK).

---

## 5. 파일 목록

| 파일 | 작업 |
|------|------|
| `scripts/register-automation.ts` | **수정** — target 불일치 감지 추가 |
| `deployments/baseSepolia.automation.json` | **갱신** — 새 upkeep ID + target 반영 |
| `deployments/baseSepolia.automation.backup.json` | **생성** — 기존 manifest 백업 |
| `HANDOFF_RESUME.md` | **갱신** — automation 상태 업데이트 |
