# 작업 9 — Automation 스크립트 Idempotent 보강 (Codex 지시서)

> **배경:** Automation 등록/정리 과정에서 nonce 충돌, stale forwarder, manifest 덮어쓰기 문제가 발생했다. 현재 on-chain 상태는 정상이지만, 재배포/재등록 시 같은 문제가 반복되지 않도록 스크립트를 보강한다.

---

## 0. 현재 on-chain 상태 (정상)

```
최신 upkeep 3개 (baseSepolia.automation.json 기준):
- dailyQuotaRebalance  → forwarder 0xf69EDb49324CdE4E70B67EE8D12aBC3c9EED0Fa7
- executeTimeout       → forwarder 0x9022b9B7E858246B7f9B18244012bF38C1880ca9
- checkAndUpgradeFeeStage → forwarder 0x70BC0311990098e0E4f5FfFAe7b6654DBC00cc70

레거시 upkeep 3개: 취소 완료
레거시 forwarder 4개: KEEPER_ROLE revoke 완료
```

---

## 1. 수정 대상 파일 4개

### 1-A. `scripts/register-automation.ts` — Idempotent 등록

**현재 문제:** 기존 upkeep이 있어도 name 매칭만으로 skip 판단. upkeepId가 on-chain에서 실제 active인지 확인하지 않음.

**보강 사항:**
1. 기존 manifest에 upkeepId가 있으면 → on-chain `getUpkeep()` 호출로 active 여부 확인
2. active이면 skip, cancelled이면 새로 등록
3. 등록 성공 후 forwarder resolve → 즉시 KEEPER_ROLE grant (현재는 별도 스크립트 필요)
4. manifest 저장 시 기존 파일을 `.backup.json`으로 복사 후 덮어쓰기
5. 모든 tx에 `buildTxOverrides(nextNonce)` 사용 (이미 구현됨 — 유지)

**추가할 함수:**
```typescript
async function isUpkeepActive(registry: any, upkeepId: bigint): Promise<boolean> {
  try {
    const upkeep = await registry.getUpkeep(upkeepId);
    // maxValidBlocknumber == UINT32_MAX (4294967295) means active
    return upkeep.maxValidBlocknumber.toString() === "4294967295";
  } catch {
    return false;
  }
}
```

**KEEPER_ROLE 자동 부여 로직:**
```typescript
// 등록 완료 후 forwarder가 확인되면:
for (const forwarder of newForwarders) {
  await ensureKeeperRole("TavernRegistry", registryContract, forwarder);
  await ensureKeeperRole("TavernEscrow", escrowContract, forwarder);
}
```

### 1-B. `deploy/02_setup_automation.ts` — Manifest 보호

**현재 문제:** `baseSepolia.automation.json`을 무조건 덮어쓴다.

**보강 사항:**
1. 파일이 이미 존재하고 `upkeeps[].upkeepId`가 채워져 있으면 → 덮어쓰지 않고 경고 후 종료
2. `--force` 플래그로 강제 덮어쓰기 허용 (process.argv 체크)
3. 덮어쓸 때는 `.backup.json` 생성

```typescript
const existingManifest = await readJsonFile(AUTOMATION_PATH);
if (existingManifest?.upkeeps?.some(u => u.upkeepId)) {
  if (!process.argv.includes("--force")) {
    console.log("Automation manifest already contains registered upkeeps. Use --force to overwrite.");
    return;
  }
  // backup
  await writeFile(AUTOMATION_PATH + ".backup.json", JSON.stringify(existingManifest, null, 2));
}
```

### 1-C. `scripts/cleanup-legacy-automation.ts` — Stale 자동 감지

**현재 문제:** LEGACY_UPKEEP_IDS와 STALE_KEEPER_GRANTEES가 하드코딩.

**보강 사항:**
1. `baseSepolia.automation.json`의 최신 upkeep forwarder 목록을 읽기
2. TavernRegistry + TavernEscrow에서 KEEPER_ROLE 보유자 전체 열거 (RoleGranted 이벤트 스캔)
3. 최신 forwarder 목록에 없는 KEEPER_ROLE 보유자 = stale → revoke 후보로 표시
4. `--dry-run` 모드: 감지만 하고 실행하지 않음 (기본값)
5. `--execute` 모드: 실제 revoke 수행

**이벤트 스캔 로직:**
```typescript
const KEEPER_ROLE = ethers.id("KEEPER_ROLE");
const filter = contract.filters.RoleGranted(KEEPER_ROLE);
const events = await contract.queryFilter(filter, 0, "latest");
const allGrantees = new Set(events.map(e => e.args.account));
// 최신 forwarder + deployer 제외 → stale 후보
```

### 1-D. 새 파일: `scripts/verify-automation-health.ts` — 상태 점검 스크립트

**목적:** 현재 on-chain Automation 상태가 manifest와 일치하는지 한 번에 검증.

**출력 항목:**
```
[CHECK] Upkeep dailyQuotaRebalance (id: 2529...) — active: ✅, funded: 0.1 LINK, forwarder: 0xf69E...
[CHECK] Upkeep executeTimeout (id: 3396...) — active: ✅, funded: 0.1 LINK, forwarder: 0x9022...
[CHECK] Upkeep checkAndUpgradeFeeStage (id: 7101...) — active: ✅, funded: 0.1 LINK, forwarder: 0x70BC...
[CHECK] TavernRegistry KEEPER_ROLE holders: 0xf69E..., 0x9022..., 0x70BC..., deployer ✅
[CHECK] TavernEscrow KEEPER_ROLE holders: 0xf69E..., 0x9022..., 0x70BC..., deployer ✅
[CHECK] Stale KEEPER_ROLE holders: none ✅
[CHECK] Manifest matches on-chain: ✅
```

**검사 항목:**
1. 각 upkeep active 여부
2. 각 upkeep LINK 잔고
3. 각 forwarder의 KEEPER_ROLE (Registry + Escrow)
4. stale KEEPER_ROLE 보유자 존재 여부
5. manifest의 forwarder 목록 vs on-chain forwarder 일치 여부

---

## 2. package.json 스크립트 추가/수정

```json
{
  "verify:automation": "npx hardhat run scripts/verify-automation-health.ts --network baseSepolia",
  "cleanup:automation": "npx hardhat run scripts/cleanup-legacy-automation.ts --network baseSepolia",
  "cleanup:automation:execute": "npx hardhat run scripts/cleanup-legacy-automation.ts --network baseSepolia -- --execute"
}
```

---

## 3. 검증 체크리스트 (Cowork 검토용)

- [ ] register-automation.ts: on-chain active 체크 후 skip/재등록 분기
- [ ] register-automation.ts: 등록 후 forwarder에 KEEPER_ROLE 자동 부여
- [ ] register-automation.ts: manifest backup 후 저장
- [ ] 02_setup_automation.ts: 기존 manifest 보호 (upkeepId 존재 시 거부)
- [ ] 02_setup_automation.ts: --force 옵션 지원
- [ ] cleanup-legacy-automation.ts: 이벤트 스캔 기반 stale 자동 감지
- [ ] cleanup-legacy-automation.ts: --dry-run 기본, --execute 옵션
- [ ] verify-automation-health.ts: 6개 검사 항목 모두 출력
- [ ] package.json: 3개 스크립트 추가
- [ ] 기존 코드 구조/스타일 유지 (buildTxOverrides, resolveForwarder 등 재사용)
