# Claw Tavern — Cowork 총괄 지시서

> **Cowork 역할:** 이 폴더의 파일 관리·작업 조율·결과물 검토 책임자.
> 코드 직접 작성은 하지 않는다. Codex에게 작업을 지시하고 결과물을 검토한다.
> Codex와 같은 폴더를 공유하며 협업한다.

---

## 프로젝트 한 줄 요약

**Claw Tavern ($TVRN)** — Base(Coinbase L2) 위에서 OpenClaw AI 에이전트들이
퀘스트를 수행하고 USDC·ETH·$TVRN으로 보상받는 탈중앙화 에이전트 마켓플레이스.
판타지 RPG 여관 테마. 핵심 엔진: OpenClaw 프레임워크.

---

## 현재 폴더 파일 현황

```
claw-tavern/
│
├── [지시서 — 이 파일부터 읽기]
│   ├── HANDOFF_COWORK.md          ← 지금 읽는 파일 (Cowork 총괄 지시서)
│   └── HANDOFF_CODEX.md           ← Codex에게 넘기는 작업 명세서
│
├── [설계 원본]
│   └── MASTER_ROADMAP.md          ✅ 최신 (2,148줄) — 모든 설계 결정의 최종본
│
├── [컨트랙트]
│   ├── TavernToken.sol            🔶 업데이트 필요 ($TVRN ERC20 — 잠금 로직 미반영)
│   ├── TavernRegistry.sol         🔶 업데이트 필요 (3일 롤링 쿼터·히스테리시스 미반영)
│   └── TavernEscrow.sol           ❌ 없음 — 가장 먼저 신규 작성 필요
│
├── [Codex 구현 명령문]
│   ├── CODEX_INSTRUCTIONS.md      🔶 구버전 (상태머신·환불 로직 교체 필요)
│   ├── CODEX_AGENT_WORKER.md      🔶 구버전 (submitEvaluation 연동 미반영)
│   ├── CODEX_GOVERNANCE.md        🔶 구버전 (GTM·파운딩 에이전트 미반영)
│   └── CODEX_DASHBOARD.md         🔶 구버전 (평가 UI·보상전환 상태 미반영)
│
└── [프론트엔드 — 완료, 수정 불필요]
    ├── claw-tavern-website.html    ✅ 완료
    └── claw-tavern-dashboard.html  ✅ 완료
```

---

## Codex에게 작업 지시하는 방법

Codex에게 `HANDOFF_CODEX.md` 파일을 주고, 아래 순서대로 섹션을 지정해서 지시한다.

```
"HANDOFF_CODEX.md의 [작업 1]을 읽고 TavernEscrow.sol을 작성해서 같은 폴더에 저장해줘"
"HANDOFF_CODEX.md의 [작업 2]를 읽고 TavernRegistry.sol과 TavernToken.sol을 수정해줘"
"HANDOFF_CODEX.md의 [작업 3]을 읽고 CODEX 패키지 4개를 업데이트해줘"
```

---

## 작업 순서 및 완료 후 검토 체크리스트

### [작업 1] TavernEscrow.sol 신규 작성 — 최우선 🔴

Phase 1의 핵심 컨트랙트. 이게 없으면 아무것도 안 돌아간다.

**완료 후 Cowork 검토 항목:**
```
□ QuestState enum에 Refunded·Rejected 없음 확인
□ 보상 총액이 어떤 경우에도 예치금 100% 초과 안 함
  - TimedOut: 45% + 45% = 90% (나머지 10% 운영풀)
  - 미열람+1점: 38% + 38% = 76%
  - 열람+2점이하: 18% + 18% = 36%
□ Oracle _getCheckedPrice(): updatedAt > block.timestamp - 1 hours 확인
□ Oracle: answeredInRound >= roundId 확인
□ Oracle: price > 0 확인
□ $TVRN 30일 잠금(tvrnUnlockAt) 설정 확인
□ Cancelled(Funded 이전)만 USDC·ETH 직접 환불 — 나머지는 전부 보상전환
□ submitEvaluation() — 5축 점수 배열, $TVRN 성실도 보상(감소 곡선), 상태 전이
□ 동일 에이전트 평가 월 3회 상한 로직
□ 72시간 무응답 → AutoApproved 처리
```

---

### [작업 2] TavernRegistry.sol + TavernToken.sol 업데이트 🟠

**완료 후 Cowork 검토 항목:**
```
TavernRegistry.sol:
□ yearMultiplier = [5, 4, 3, 2, 1] 확인 (구버전 [10,7,5,3,1] 흔적 없음)
□ rollingScores[6][3] 슬롯 구조, rollingDay % 3 순환 확인
□ 히스테리시스: diff < 200bps(2%)면 QuotaRebalanced emit 없이 return 확인
□ masterExpiryPrimary / masterExpirySecondary 타임스탬프 추가 확인
□ isMasterFounder / isMasterSuccessor 플래그 확인

TavernToken.sol:
□ tvrnUnlockAt mapping(address => uint256) 추가 확인
□ _beforeTokenTransfer(): 잠금 중 전송 차단 로직 확인
□ 잠금 중에도 스테이킹·투표는 허용(별도 플래그 또는 호출자 체크) 확인
```

---

### [작업 3] CODEX 패키지 4개 업데이트 🟡

**완료 후 Cowork 검토 항목:**
```
공통:
□ "USDC 환불", "Rejected", "Refunded", "[10, 7, 5, 3, 1]" 문구 전부 제거 확인
□ 상태머신이 MASTER_ROADMAP.md와 일치하는지 확인

CODEX_INSTRUCTIONS.md:
□ TavernEscrow.sol 기준 함수 목록 반영
□ Price Oracle Staleness Check 명시

CODEX_AGENT_WORKER.md:
□ submitEvaluation() 호출 로직 추가
□ recordResultViewed() 연동

CODEX_GOVERNANCE.md:
□ GTM Launch Strategy 섹션 반영
□ 파운딩 에이전트 특전 명시

CODEX_DASHBOARD.md:
□ 평가 5축 UI 컴포넌트 스펙
□ Compensated 상태 표시
□ firstAttemptSuccessRate KPI 위젯
```

---

### [작업 4] Base Sepolia 테스트넷 배포 🔵

작업 1~3 완료 후 진행.

```
배포 순서: TavernToken → TavernRegistry → TavernEscrow
Chainlink Automation 연동:
  - 매일 07:00 KST: dailyQuotaRebalance()
  - 타임아웃 감시: executeTimeout()
  - 수수료 단계 전환: checkFeeStage()

검증 항목:
  - 48시간 타임아웃 → 자동 보상전환 작동
  - Price Oracle Staleness Check 작동 (1시간 이상 stale 시 revert)
  - $TVRN 30일 잠금 작동 (전송 차단, 스테이킹은 허용)
  - 히스테리시스: 2% 미만 변동 시 QuotaRebalanced 미발생
```

---

### [작업 5] 백서(Whitepaper) 초안 🔵

작업 4(테스트넷 검증) 완료 후 작성.
투자자·에이전트 개발자 대상 외부 공개용.
MASTER_ROADMAP.md 기반으로 작성.

---

## 핵심 설계 결정사항 요약 (판단 기준)

### 보상전환 비율 (환불 없음 — 전부 $TVRN+크레딧)
| 상황 | $TVRN 비율 | 크레딧 비율 | 운영풀 |
|------|-----------|-----------|------|
| TimedOut (48h 초과) | 45% × ×1.1 | 45% × ×1.2 | 10% |
| 미열람 + 평가 평균 1점 | 38% × ×0.9 | 38% × ×1.2 | 24% |
| 열람 후 평가 평균 2점 이하 | 18% × ×0.9 | 18% × ×1.2 | 64% |
| Funded 이전 취소(Cancelled) | — | — | USDC·ETH 100% 직접 환불 |

### 수수료 단계
| 단계 | 조건 | 수수료 |
|------|------|------|
| 0단계 | 의뢰인 < 1,000 OR 에이전트 < 200 | 0% |
| 1단계 | 의뢰인 ≥ 1,000 AND 에이전트 ≥ 200 | 1% |
| 2단계 | 의뢰인 ≥ 5,000 AND 에이전트 ≥ 500 | 2% |
| 3단계 | 의뢰인 ≥ 10,000 AND 에이전트 ≥ 1,000 | 3% |

### 마스터 에이전트
- 창시자 정: 5년 한시, yearMultiplier = [5, 4, 3, 2, 1]
- 창시자 부: 5년 6개월 한시, 동일 배율
- 후임: 2년 고정 임기, ×3 고정, 2년마다 대회 교체

### GTM (초기 3개월)
- 공식 지원 카테고리: 코딩·자동화 / 리서치·요약 / 번역·콘텐츠
- 파운딩 에이전트 10~20명만 선별 등록
- 첫 시도 성공률 75% 달성 확인 후 카테고리 순차 개방

---

## 설계 원본 참고

모든 결정사항의 최종본은 `MASTER_ROADMAP.md`에 있다.
Codex 결과물이 MASTER_ROADMAP.md와 충돌할 경우, MASTER_ROADMAP.md가 우선이다.
