# 작업 8 — 프론트엔드 온체인 연동 (Codex 지시서)

> **목표:** 기존 대시보드 명세(`CODEX_DASHBOARD.md`)를 실제 Base Sepolia 컨트랙트와 연결하는 단일 HTML 파일(`claw-tavern-app.html`)을 생성한다.
> wagmi/viem CDN 기반, 지갑 연결 → 퀘스트 CRUD → 대시보드 실시간 조회를 한 파일에 구현한다.

---

## 0. 배포 정보 (하드코딩)

```
네트워크: Base Sepolia (chainId 84532)
RPC: https://sepolia.base.org

TavernToken:    0x3b63deb3632b2484bAb6069281f08642ab112b16
TavernRegistry: 0x7749473E36a8d6E741d9E581106E81CacAb7832a
TavernEscrow:   0x243fB879fBE521c5c227Da9EF731968413755131
USDC:           0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

---

## 1. 기술 스택 & 제약

| 항목 | 선택 | 이유 |
|------|------|------|
| 번들러 | 없음 — 단일 HTML | Boss가 바로 열 수 있어야 함 |
| 체인 라이브러리 | ethers.js v6 CDN (`https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js`) | CDN 사용 가능, ABI 인코딩 내장 |
| UI | Tailwind CDN + 인라인 JS | 컴포넌트 프레임워크 없이 DOM 직접 조작 |
| 지갑 | `window.ethereum` (MetaMask / Coinbase Wallet) | EIP-1193 표준 |
| 테마 | 판타지 RPG 여관 — 다크 배경(#1a1a2e), 골드 강조(#d4a017), 보라 헤더(#6c3483) | 기존 PDF 테마와 통일 |

---

## 2. 파일 구조

단일 파일: `claw-tavern-app.html`

내부 구성:
```
<head>
  - Tailwind CDN
  - ethers.js CDN
  - 커스텀 CSS (RPG 테마)
</head>
<body>
  [Header] 로고 + 지갑 연결 버튼 + 네트워크 표시
  [Tab Nav] Quest Board | My Quests | Dashboard | Token
  [Tab: Quest Board] 오픈 퀘스트 목록 + 새 퀘스트 생성 폼
  [Tab: My Quests] 내가 생성/수락한 퀘스트 관리
  [Tab: Dashboard] KPI 위젯 + 퀘스트 상태 카드
  [Tab: Token] $TVRN 잔고, 잠금 상태, USDC 잔고
</body>
<script>
  - ABI 정의 (필요한 함수만)
  - 지갑 연결 로직
  - 컨트랙트 인스턴스 생성
  - 각 탭 렌더링 함수
  - 이벤트 리스너
</script>
```

---

## 3. ABI (필요한 함수/이벤트만 포함)

### TavernEscrow ABI

```javascript
const ESCROW_ABI = [
  // 읽기
  "function quests(uint256) view returns (uint256 questId, address client, address agent, address currency, uint256 depositAmount, uint8 state, uint256 createdAt, uint256 fundedAt, uint256 acceptedAt, uint256 submittedAt, uint256 resultViewedAt, uint256 evaluatedAt, bool compensated, uint256 tvrnUnlockTime)",
  "function questCount() view returns (uint256)",
  "function currentFeeStage() view returns (uint8)",

  // 쓰기 — 의뢰인
  "function createQuest(address currency, uint256 depositAmount, bytes32 briefHash, string briefUri) returns (uint256)",
  "function fundQuestUSDC(uint256 questId)",
  "function fundQuestETH(uint256 questId) payable",
  "function cancelQuest(uint256 questId)",
  "function recordResultViewed(uint256 questId)",
  "function submitEvaluation(uint256 questId, uint8[5] scores, string comment, string[] tags)",

  // 쓰기 — 에이전트
  "function acceptQuest(uint256 questId)",
  "function recordHeartbeat(uint256 questId)",
  "function submitResult(uint256 questId, bytes32 resultHash, string resultUri)",

  // 이벤트
  "event QuestCreated(uint256 indexed questId, address indexed client)",
  "event QuestFunded(uint256 indexed questId, address currency, uint256 amount)",
  "event QuestAccepted(uint256 indexed questId, address indexed agent)",
  "event QuestSubmitted(uint256 indexed questId)",
  "event QuestEvaluated(uint256 indexed questId, uint8[5] scores)",
  "event QuestAutoApproved(uint256 indexed questId)",
  "event QuestCompensated(uint256 indexed questId)",
  "event QuestTimedOut(uint256 indexed questId)"
];
```

### TavernToken ABI

```javascript
const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function lockExpiry(address) view returns (uint256)"
];
```

### TavernRegistry ABI

```javascript
const REGISTRY_ABI = [
  "function jobQuota(uint256) view returns (uint256)",
  "function agents(address) view returns (bytes32 agentId, uint8 jobType, uint256 reputationScore, bool active)",
  "function totalActiveAgents() view returns (uint256)"
];
```

### USDC ABI

```javascript
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];
```

> **주의:** 위 ABI는 human-readable 형식이며, 실제 컨트랙트 ABI와 일치해야 한다. 컴파일된 `artifacts/` 폴더의 ABI와 교차 검증할 것. 불일치 시 artifacts 기준으로 수정.

---

## 4. 기능 상세

### 4-A. 지갑 연결

1. "Connect Wallet" 버튼 클릭 → `eth_requestAccounts`
2. 연결 후 헤더에 축약 주소 표시 (`0x1234...5678`)
3. chainId 확인 → 84532가 아니면 `wallet_switchEthereumChain` 요청
4. 네트워크 미등록 시 `wallet_addEthereumChain` (name: "Base Sepolia", rpc: "https://sepolia.base.org", blockExplorer: "https://sepolia.basescan.org")
5. 계정/네트워크 변경 이벤트 리스닝 (`accountsChanged`, `chainChanged`)

### 4-B. Quest Board 탭

**새 퀘스트 생성 폼:**
- 통화 선택: USDC / ETH (라디오)
- 예치 금액 입력
- Brief 내용 입력 (텍스트에어리어) → keccak256 해시 계산 → briefHash
- briefUri: `ipfs://placeholder` (Phase 1에서는 수동 입력 허용)
- "Create Quest" 버튼 → `createQuest()` 호출
- USDC 선택 시: approve 필요 여부 확인 → allowance < amount이면 approve 먼저 → fundQuestUSDC
- ETH 선택 시: fundQuestETH (msg.value)

**퀘스트 목록:**
- `questCount()` 조회 → 최근 20개 역순 표시
- 각 카드에: questId, client 축약 주소, 통화, 금액, 상태 배지, 생성일
- 상태별 배지 색상:
  - Created: 회색
  - Funded: 파랑
  - Accepted/InProgress: 골드
  - Submitted: 보라
  - Evaluated/AutoApproved: 초록
  - Compensated: 주황 ("보상전환 완료")
  - TimedOut: 빨강
  - Cancelled: 회색 취소선
  - Disputed: 빨강 점멸

### 4-C. My Quests 탭

**의뢰인 뷰 (내가 client인 퀘스트):**
- 상태별 필터 드롭다운
- Submitted 상태 → "평가하기" 버튼 → 평가 모달:
  - 5축 별점 (1-5), CODEX_DASHBOARD.md 명세 준수
  - 코멘트 입력 (선택)
  - 태그 입력 (선택, 콤마 구분)
  - 보상 안내 문구 표시 (1/3/5 TVRN 기준)
  - "결과 열람" 버튼 → `recordResultViewed()` 호출 후 결과 URI 링크
  - "평가 제출" → `submitEvaluation()` 호출

**에이전트 뷰 (내가 agent인 퀘스트):**
- Funded 상태 → "수락" 버튼 → `acceptQuest()`
- Accepted/InProgress → "결과 제출" 폼:
  - 결과 내용 입력 → keccak256 → resultHash
  - resultUri 입력
  - `submitResult()` 호출

### 4-D. Dashboard 탭

`CODEX_DASHBOARD.md` 명세를 정확히 따른다:

**상단 KPI:**
- 활성 퀘스트 수 (state == Funded/Accepted/InProgress/Submitted 카운트)
- 총 퀘스트 수 (`questCount()`)
- 현재 수수료 단계 (`currentFeeStage()` → 0%/1%/2%/3%)
- 내 $TVRN 잔고

**중단:**
- Compensated 퀘스트 카드 (보상전환 완료 배지 + 잠금 해제 남은 일수)
- 평가 대기 카드 (Submitted 상태, client == 나)

**하단:**
- 직업별 쿼터 비율 (jobQuota 6개 읽어서 % 표시)

### 4-E. Token 탭

- $TVRN 잔고 (`balanceOf`)
- 잠금 해제 시각 (`lockExpiry`) → 남은 일수 계산
- USDC 잔고 (`balanceOf`)
- 네트워크 정보 (chainId, 블록 번호)

---

## 5. 상태 매핑

```javascript
const STATE_NAMES = [
  "Created",      // 0
  "Funded",       // 1
  "Accepted",     // 2
  "InProgress",   // 3
  "Submitted",    // 4
  "Evaluated",    // 5
  "AutoApproved", // 6
  "Compensated",  // 7
  "TimedOut",     // 8
  "Cancelled",    // 9
  "Disputed"      // 10
];
```

> 컨트랙트의 enum 순서와 반드시 일치시킬 것. `TavernEscrow.sol`의 `QuestState` enum과 교차 검증.

---

## 6. UX 규칙

1. 모든 트랜잭션은 전송 전 "확인" 모달 표시 (함수명, 파라미터, 예상 가스)
2. 트랜잭션 pending 중 스피너 + tx hash 링크 (basescan)
3. 성공/실패 토스트 알림
4. 금액 표시: USDC는 6 decimals, ETH는 18 decimals, TVRN은 컨트랙트 decimals() 조회
5. Compensated 상태는 `CODEX_DASHBOARD.md` 톤 준수: "보상전환 완료" (경고색 아님, 재참여 유도 톤)
6. 반응형: 데스크톱 1200px+ / 태블릿 768px / 모바일 360px

---

## 7. 에러 처리

- 지갑 미설치 → 설치 안내 링크 (MetaMask / Coinbase Wallet)
- 네트워크 불일치 → 자동 전환 시도 → 실패 시 수동 안내
- 트랜잭션 실패 → revert reason 파싱 후 한국어 메시지 표시
- RPC 오류 → 재시도 + 대체 RPC 안내

---

## 8. 파일 저장 위치

```
claw-tavern/claw-tavern-app.html
```

---

## 9. 검증 체크리스트 (Cowork 검토용)

- [ ] 지갑 연결 → 주소 표시, 네트워크 자동 전환
- [ ] 새 퀘스트 생성 (USDC): approve → create → fund 3-step 정상
- [ ] 새 퀘스트 생성 (ETH): create → fund (msg.value) 정상
- [ ] 퀘스트 목록 조회: questCount → 최근 20개 로드
- [ ] 퀘스트 수락 (에이전트): acceptQuest 호출 성공
- [ ] 결과 제출: submitResult 호출 성공
- [ ] 결과 열람: recordResultViewed 호출 성공
- [ ] 평가 제출: 5축 별점 + 코멘트 + 태그 → submitEvaluation 성공
- [ ] Dashboard KPI: 활성 퀘스트 수, 수수료 단계, TVRN 잔고 표시
- [ ] Token 탭: TVRN 잔고, 잠금 해제 남은 일수, USDC 잔고 표시
- [ ] 상태 배지: 11개 상태 각각 올바른 색상
- [ ] Compensated 카드: "보상전환 완료" 톤, 잠금 해제 남은 일수
- [ ] 트랜잭션 pending/성공/실패 UX
- [ ] 컨트랙트 주소 3개 정확히 하드코딩
- [ ] 모바일 반응형 최소 360px
