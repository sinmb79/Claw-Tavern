# 작업 11-B — TavernStaking Base Sepolia 라이브 배포 (Codex 지시서)

> **목표:** 로컬 검증 완료된 TavernStaking을 Base Sepolia에 배포하고, 기존 TavernToken·TavernRegistry와 연결한다.

---

## 0. 전제

- Task 11 코드 구현 + 로컬 검증 완료
- `deploy/03_deploy_staking.ts`가 Base Sepolia(84532) 분기를 지원함
- 기존 배포 주소는 `deployments/baseSepolia.json`에 있음

---

## 1. 실행 순서

### 1-A. Base Sepolia 배포

```bash
npx hardhat run deploy/03_deploy_staking.ts --network baseSepolia
```

이 스크립트가 수행하는 작업:
1. `baseSepolia.json`에서 TavernToken, TavernRegistry 주소 로드
2. TavernStaking 배포 (constructor: tvrnToken, registry)
3. TavernToken에서 BURNER_ROLE → TavernStaking 부여
4. TavernRegistry에서 setStakingContract(TavernStaking) 호출
5. `baseSepolia.json`에 tavernStaking 주소 추가 + 매니페스트 갱신

### 1-B. 컨트랙트 검증 (Basescan)

```bash
npx hardhat run scripts/verify-contracts.ts --network baseSepolia
```

또는 수동:
```bash
npx hardhat verify --network baseSepolia <STAKING_ADDRESS> <TAVERN_TOKEN_ADDRESS> <TAVERN_REGISTRY_ADDRESS>
```

### 1-C. 온체인 상태 확인

배포 후 다음을 확인:

1. `TavernStaking.tvrnToken()` == `0x3b63deb3632b2484bAb6069281f08642ab112b16`
2. `TavernStaking.registry()` == `0x7749473E36a8d6E741d9E581106E81CacAb7832a`
3. `TavernStaking.STAKE_AMOUNT()` == 100e18
4. `TavernStaking.UNSTAKE_COOLDOWN()` == 604800 (7 days)
5. `TavernStaking.SLASH_BPS()` == 5000
6. `TavernToken.hasRole(BURNER_ROLE, stakingAddress)` == true
7. `TavernRegistry.stakingContract()` == stakingAddress

확인 방법: Basescan Read Contract 또는 hardhat console.

---

## 2. 매니페스트 업데이트

배포 스크립트가 `baseSepolia.json`을 자동 갱신하지만, 다음을 확인:

- `addresses.tavernStaking` 필드 추가됨
- `constructorArgs.tavernStaking` 필드 추가됨
- `roleGrants`에 BURNER_ROLE 기록 추가됨

---

## 3. HANDOFF_RESUME.md 업데이트

Task 11 상태를 갱신:

```
| Task 11 | Completed and verified | TavernStaking deployed to Base Sepolia, BURNER_ROLE granted, stakingContract configured |
```

Verified Contract Addresses 테이블에 추가:
```
| TavernStaking | <배포된 주소> |
```

---

## 4. 검증 체크리스트 (Cowork 검토용)

- [ ] TavernStaking Base Sepolia 배포 성공 (tx hash 기록)
- [ ] Basescan 검증 완료 (소스코드 공개)
- [ ] BURNER_ROLE 부여 확인 (on-chain)
- [ ] stakingContract 설정 확인 (on-chain)
- [ ] STAKE_AMOUNT / COOLDOWN / SLASH_BPS 상수 확인
- [ ] baseSepolia.json에 tavernStaking 주소 기록
- [ ] HANDOFF_RESUME.md Task 11 갱신 + 주소 테이블 추가
