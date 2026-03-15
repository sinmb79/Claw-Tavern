# 작업 10 — 브라우저 QA + Minor Fix (Codex 지시서)

> **목표:** `claw-tavern-app.html`의 코드 리뷰에서 발견된 4개 시각 이슈를 수정하고, HTML 문법 최종 확인.

---

## 0. 배경

Task 8 리뷰(15-item checklist) 결과 기능은 전부 PASS.
아래 4건은 시각/UX minor — 코드만 수정, 컨트랙트 변경 없음.

---

## 1. 수정 사항 (4건)

### 1-A. 배지 색상: Funded ↔ Accepted 스왑

**현재 (잘못됨):**
```css
.state-funded  → gold 계열 (rgba(216,169,51,...))
.state-accepted → blue 계열 (rgba(95,160,255,...))
```

**올바른 매핑 (명세 기준):**
```css
.state-funded   → blue  (rgba(95,160,255,...) 계열)
.state-accepted → gold  (rgba(216,169,51,...) 계열)
```

작업: `.state-funded`와 `.state-accepted`의 `background`, `color`, `border-color` 값을 서로 교환.

### 1-B. Cancelled 배지: 취소선 추가

`.state-cancelled` 클래스에 `text-decoration: line-through` 추가.

```css
.state-cancelled {
  background: rgba(103, 114, 127, 0.18);
  color: #d4dce7;
  border-color: rgba(103, 114, 127, 0.35);
  text-decoration: line-through;
}
```

### 1-C. Disputed 배지: 점멸 애니메이션 추가

`@keyframes` 정의 후 `.state-disputed`에 적용:

```css
@keyframes dispute-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.state-disputed {
  /* 기존 색상 유지 */
  animation: dispute-blink 1.2s ease-in-out infinite;
}
```

### 1-D. 트랜잭션 전 확인 모달 추가

**현재:** `performWrite()`가 바로 tx 전송 → 지갑 컨펌에만 의존.
**수정:** `performWrite()` 호출 전, 앱 레벨 확인 모달을 표시.

구현 방식:

1. `tx-overlay` 옆에 `confirm-modal` div 추가:
```html
<div id="confirm-modal" class="fixed inset-0 z-45 hidden items-center justify-center bg-black/55 px-4">
  <div class="panel max-w-lg rounded-[28px] p-6 text-center">
    <p class="heading-font text-xl font-semibold">Confirm Transaction</p>
    <p id="confirm-modal-text" class="mt-3 text-sm leading-6 text-[var(--muted)]"></p>
    <div id="confirm-modal-details" class="mt-4 panel-soft rounded-2xl p-4 text-left text-sm"></div>
    <div class="mt-5 flex justify-center gap-3">
      <button id="confirm-modal-ok" class="action-button primary rounded-full px-5 py-3 text-sm font-semibold">Confirm</button>
      <button id="confirm-modal-cancel" class="action-button ghost rounded-full px-5 py-3 text-sm font-semibold">Cancel</button>
    </div>
  </div>
</div>
```

2. JS에 `askConfirmation(label, details)` 함수 추가:
```javascript
function askConfirmation(label, details) {
  return new Promise((resolve) => {
    const modal = $("confirm-modal");
    $("confirm-modal-text").textContent = label;
    $("confirm-modal-details").innerHTML = details || "";
    modal.classList.remove("hidden");
    modal.classList.add("flex");

    function cleanup() {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      $("confirm-modal-ok").removeEventListener("click", onOk);
      $("confirm-modal-cancel").removeEventListener("click", onCancel);
    }

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    $("confirm-modal-ok").addEventListener("click", onOk);
    $("confirm-modal-cancel").addEventListener("click", onCancel);
  });
}
```

3. 모든 write 호출 지점에서 `askConfirmation()` 호출 후 `false`이면 `return`:

적용 대상 함수:
- `createQuestAndFund` — "Create and fund quest? Currency: {X}, Amount: {Y}"
- `fundCreatedQuest` — "Fund quest #{id}?"
- `acceptQuest` — "Accept quest #{id}?"
- `cancelQuest` — "Cancel quest #{id}?"
- `recordHeartbeat` — "Record heartbeat for quest #{id}?"
- `submitResult` — "Submit result for quest #{id}?"
- `markResultViewed` — "Mark result viewed for quest #{id}?"
- `submitEvaluation` — "Submit evaluation for quest #{id}? Scores: [x,x,x,x,x]"

패턴 예시:
```javascript
async function acceptQuest(questId) {
  const ok = await askConfirmation(
    `Accept quest #${questId}?`,
    `<p>Function: <strong>acceptQuest(${questId})</strong></p>`
  );
  if (!ok) return;

  await ensureBaseSepolia();
  // ... 기존 로직
}
```

---

## 2. 수정하지 않을 것

- ABI, 컨트랙트 주소, 기능 로직 → 변경 없음
- InProgress 배지 색상 → 현재 wine/pink 유지 (Accepted와 구분되므로 괜찮음)
- 30초 자동 리프레시 → 유지

---

## 3. 파일

수정 대상: `claw-tavern-app.html` (1개 파일만)

---

## 4. 검증 체크리스트 (Cowork 검토용)

- [ ] `.state-funded` = blue 계열, `.state-accepted` = gold 계열 확인
- [ ] `.state-cancelled`에 `text-decoration: line-through` 적용
- [ ] `.state-disputed`에 점멸 애니메이션 (`dispute-blink`) 적용
- [ ] `confirm-modal` HTML 존재 + z-index가 tx-overlay(z-40)보다 높음 (z-45)
- [ ] `askConfirmation()` 함수 존재 + Promise 반환
- [ ] 8개 write 함수 모두 `askConfirmation()` 호출 후 `false` → early return
- [ ] `node --check`로 문법 에러 없음 확인
- [ ] HANDOFF_RESUME.md에 Task 10 반영
