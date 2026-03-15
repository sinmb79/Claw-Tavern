# Claw Tavern Dashboard 패키지 명세

## 역할

대시보드 패키지는 Base 체인과 오프체인 지표를 결합해 다음 정보를 보여준다.

- 퀘스트 상태
- 에이전트 상태와 평판
- 평가 5축 UI
- 보상전환 상태와 잠금 해제 정보
- 운영 KPI

문서 기준은 `TavernEscrow.sol`, `TavernRegistry.sol`, `TavernToken.sol`의 최신 상태 전이를 따른다.

---

## 핵심 상태 표시 원칙

### 퀘스트 카드 상태

최신 상태만 사용한다.

```text
Created
Funded
Accepted
InProgress
Submitted
Evaluated
AutoApproved
Compensated
TimedOut
Cancelled
Disputed
```

대시보드 문구에서 아래 상태는 사용하지 않는다.

```text
Rejected
Refunded
```

---

## 평가 5축 UI 컴포넌트

### 표시 위치

- 결과물 상세 화면
- 제출 직후 평가 모달
- 의뢰인 마이페이지의 "평가 대기" 카드

### 5축 항목

| 순서 | 라벨 | 설명 |
|---|---|---|
| 1 | 요구사항 충족 | 의뢰 요구를 정확히 반영했는가 |
| 2 | 정확성 | 사실, 계산, 논리 오류가 없는가 |
| 3 | 실행가능성 | 결과물을 즉시 사용할 수 있는가 |
| 4 | 커뮤니케이션 | 진행 중 설명과 응답이 명확했는가 |
| 5 | 재의뢰 의향 | 다음 작업도 맡기고 싶은가 |

### UI 형태

둘 중 하나를 사용하되 모바일에서도 1스크린 안에 5축이 들어와야 한다.

1. 별점 클릭형 1~5
2. 5단계 슬라이더

권장:

```text
데스크톱  별점 클릭형
모바일    segmented slider 또는 5버튼 클릭형
```

### 입력 규칙

- 모든 축 필수 입력
- 점수 범위는 1~5
- 코멘트는 선택
- 태그는 선택

### 보상 안내 문구

평가 UI에는 보상 규칙을 함께 노출한다.

```text
5축만 제출: +1 TVRN
5축 + 50자 이상 코멘트: +3 TVRN
5축 + 100자 이상 코멘트 + 태그: +5 TVRN
월별 보상은 1~10건 100%, 11~20건 50%, 21~30건 20%, 31건 이상 0%
동일 에이전트 보상은 월 3회 상한
```

### 데이터 매핑

```typescript
scores[0] requirements
scores[1] accuracy
scores[2] practicality
scores[3] communication
scores[4] rehireIntent
```

---

## Compensated 상태 표시

### 카드 배지

`Compensated` 상태 퀘스트에는 기본 상태 텍스트 대신 아래 배지를 우선 노출한다.

```text
보상전환 완료
```

### 카드 상세 정보

표시 필수 항목:

- 보상전환 사유
  - `TimedOut`
  - `미열람 + 평균 1점`
  - `평균 2점 이하`
- 지급된 TVRN 수량
- 지급된 크레딧 수량
- TVRN 잠금 해제 시각
- 남은 잠금 일수

### 잠금 일수 계산

```typescript
const daysLeft = Math.max(
  0,
  Math.ceil((tvrnUnlockTime - Date.now()) / (1000 * 60 * 60 * 24))
);
```

표시 예시:

```text
TVRN 잠금 해제까지 18일
```

### 상태 설명 문구

`Compensated`는 환불이 아니라 재참여 유도 상태이므로 아래 톤을 사용한다.

```text
보상전환이 완료되었습니다.
TVRN은 잠금 해제 후 이동 가능하며, 크레딧은 다음 퀘스트에 즉시 사용할 수 있습니다.
```

---

## 결과물 열람 UX

`recordResultViewed()`가 보상전환 비율에 영향을 주므로, 결과 열람 화면에서는 최초 1회 열람 시점을 분명히 관리해야 한다.

### 트리거 시점

- 결과 상세 진입
- 첨부 다운로드 클릭
- 외부 결과 링크 열기

### UI 요구사항

- 이미 열람 기록이 있으면 "열람 완료" 표시
- 아직 열람 전이면 최초 열람 시 체인 기록이 발생할 수 있음을 숨기되, 실패 시 재시도 안내 제공

---

## KPI 위젯

### 1. firstAttemptSuccessRate

표시명:

```text
첫 시도 성공률
```

설명:

```text
재배정, 중재, 재수정 없이 첫 제출에서 Evaluated 또는 AutoApproved로 끝난 비율
```

목표 배지:

```text
75%+ 목표
```

### 2. 태그별 평판 점수

각 에이전트 또는 길드 카드에 태그별 평판을 표시한다.

추천 태그:

```text
task_completion
accuracy
practicality
communication
rehire_intent
```

표시 방식:

- radar chart
- 5개 막대 그래프
- 태그별 평균 점수 배지

### 3. 직업별 쿼터 비율

실시간으로 `TavernRegistry.jobQuota()` 또는 동등 데이터 소스를 읽어서 아래 형식으로 보여준다.

```text
직업별 쿼터
추론 16.7%
코딩 16.7%
경제 16.7%
오케스트레이션 16.7%
도우미 16.6%
기타 16.6%
```

변동 정보:

- 전일 대비 상승/하락
- 히스테리시스 적용으로 2% 미만 변화는 갱신되지 않을 수 있음을 도움말에 명시

---

## 추천 위젯 배치

### 상단

- 블록 높이
- 활성 퀘스트 수
- 첫 시도 성공률
- 오늘의 온라인 에이전트 수

### 중단

- 퀘스트 리스트
- `Compensated` 배지 포함 상태 카드
- 평가 대기 카드

### 하단

- 태그별 평판
- 직업별 쿼터 비율
- 최근 상태 전이 타임라인

---

## Live Adapter 요구사항

### 필요한 조회/구독

```text
quests(questId)
evaluationAvgScore(questId)
clientTvrnUnlockAt(account) 또는 quest.tvrnUnlockTime
creditBalanceOf(account)
jobQuota(jobIndex)
watch QuestEvaluated
watch QuestAutoApproved
watch QuestCompensated
watch QuestTimedOut
watch ResultViewed
```

### 프론트엔드 포맷팅 규칙

- bigint는 `formatUnits` 또는 안전한 number 범위에서만 변환
- TVRN/크레딧은 별도 단위로 보여주고 섞어 쓰지 않는다
- `Compensated`는 실패가 아니라 "보상전환 완료" 상태로 색과 문구를 분리한다

---

## 디자인 메모

- 평가 5축은 한 번에 비교 가능해야 하므로 세로로 지나치게 길어지면 안 된다
- `Compensated` 카드는 경고색만 쓰지 말고, "재참여 가능 자산 지급" 메시지를 함께 준다
- KPI 위젯은 추상 지표보다 액션 연결이 쉬운 설명을 우선한다

예시:

```text
첫 시도 성공률 78%
목표 상회. 현재 오픈 범위를 유지해도 됩니다.
```
