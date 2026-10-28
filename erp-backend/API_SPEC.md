# REST API 명세 — 재고·발주 ERP

기준: 13개 테이블 확정안 (2026-10-08). 모든 응답은 JSON.
인증은 v1 범위에서 미구현 (app_users.role 기반 권한 분기도 추후 작업).

## 구현 상태 표기
- ✅ 구현 완료
- ⬜ 미구현 (추후 주차에 구현 예정 — 지금은 설계만)

---

## 1. 상품 (products) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/products | 목록 조회 (쿼리: `?is_active=true`, `?supplier_id=1`) |
| GET | /api/products/:id | 단건 조회 |
| POST | /api/products | 생성 |
| PUT | /api/products/:id | 수정 |
| DELETE | /api/products/:id | 하드 삭제 (재고·판매·발주 이력이 있는 상품은 FK 제약으로 409 에러 — 실제 운영에서는 `PUT`으로 `is_active=false` 처리 권장) |

**POST/PUT 바디**: `sku, product_name, unit, supplier_id?, planned_lead_time_days, minimum_order_qty?, order_multiple?, safety_stock_qty?, review_period_days, default_strategy?, is_active?`

## 2. 공급업체 (suppliers) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/suppliers | 목록 조회 |
| GET | /api/suppliers/:id | 단건 조회 |
| POST | /api/suppliers | 생성 |
| PUT | /api/suppliers/:id | 수정 |
| DELETE | /api/suppliers/:id | 삭제 |

**POST/PUT 바디**: `supplier_name, contact_name?, phone?, email?, address?, is_active?`
- PUT은 바디에 있는 항목만 바꾼다. 선택 항목(담당자·연락처·이메일·주소)은 `null` 또는 빈 문자열로 비울 수 있고, `supplier_name`은 비울 수 없다(400).

---

## 재고 변동 원칙 (3~6장 공통)

- 재고(`inventory_balances.on_hand_qty`)가 바뀌는 시점은 **판매 확정**(차감)과 **입고 확정**(증가) 두 곳뿐. 발주 확정·전표 생성 시에는 재고 변화 없음.
- 재고 변경과 `stock_movements` 기록은 항상 하나의 트랜잭션. 한 품목이라도 실패하면 전표 전체 롤백.
- `stock_movements`는 수정·삭제하지 않는다. 취소는 반대 부호 행을 새로 추가.
- 재고가 음수가 되는 판매 확정은 409로 거부 (애플리케이션 검증 + DB CHECK).
- 수동 재고 조정(`movement_type='adjustment'`)은 v1 범위에서 API 미제공.
- `created_by` 등 사용자 ID는 인증 구현 전까지 바디로 받는다 (`sql/seed_dev.sql`의 user_id=1 사용).
- 전표 번호(`sale_no`, `po_no`, `receipt_no`)는 생략 시 자동 생성: `SO|PO|RC-YYYYMMDD-00001`.

## 3. 재고 조회 (inventory_balances / stock_movements) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/inventory | 전 상품 현재고 목록 (쿼리: `?is_active=true`, `?below_safety_stock=true`) |
| GET | /api/inventory/:product_id | 단일 상품 현재고 |
| GET | /api/stock-movements | 재고 변동 이력, 최신순 (쿼리: `?product_id=1`, `?movement_type=sale`, `?limit=100` (최대 1000)) |

**재고 응답 필드**: `product_id, sku, product_name, unit, supplier_id, is_active, safety_stock_qty, on_hand_qty, outstanding_po_qty(확정·부분입고 발주의 미입고 잔량 합), below_safety_stock, updated_at`

## 4. 판매 (sales / sale_items) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/sales | 판매전표 목록 (쿼리: `?status=draft`, `?from=2026-10-01`, `?to=2026-10-31`) |
| GET | /api/sales/:id | 판매전표 단건 (상세 items 포함) |
| POST | /api/sales | 판매전표(헤더+상세) 생성 (status=draft) |
| POST | /api/sales/:id/confirm | 판매 확정 → inventory_balances 차감 + stock_movements(sale, 음수) 기록 (트랜잭션) |
| DELETE | /api/sales/:id | 작성중(draft) 판매전표 삭제. 확정·취소된 전표는 409 (확정 전표는 취소 사용) |
| POST | /api/sales/:id/cancel | 판매 취소 → confirmed였다면 반대 부호(+) 이력 추가로 재고 복원, draft면 상태만 변경 |

**POST 바디**: `created_by, sale_no?, sale_date?(기본 오늘), items: [{ product_id, quantity, unit_price? }]`
**confirm 바디(선택)**: `confirmed_by?` — stock_movements.created_by (기본: 전표 created_by)
**cancel 바디(선택)**: `reason?`(기본 "판매 취소"), `canceled_by?`

상태 전이: `draft → confirmed → canceled`, `draft → canceled`. 재고 부족 시 409 + `detail: { product_id, available_qty, requested_qty }`.

## 5. 발주 (purchase_orders / purchase_order_items) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/purchase-orders | 발주서 목록 (쿼리: `?status=confirmed`, `?supplier_id=1`) |
| GET | /api/purchase-orders/:id | 발주서 단건 (items에 `remaining_qty` 포함) |
| POST | /api/purchase-orders | 발주서 생성 (status=draft) |
| POST | /api/purchase-orders/:id/confirm | 발주 확정 (재고 변화 없음) |
| DELETE | /api/purchase-orders/:id | 작성중 발주서 삭제. 발주 추천에서 전환된 발주서면 연결된 판단 이력을 `confirmed`로 되돌려 재전환 가능 |
| POST | /api/purchase-orders/:id/cancel | 발주 취소 (draft/confirmed, 입고 전에만) |

**POST 바디**: `supplier_id, created_by, po_no?, order_date?, expected_receipt_date?, items: [{ product_id, ordered_qty, unit_price?, recommendation_decision_id? }]`
- 상품에 지정된 공급업체가 발주처와 다르면 400 (공급업체 미지정 상품은 허용).
- 확정 시 `order_date` = 확정일, `expected_receipt_date`가 비어 있으면 확정일 + 품목 중 최대 `planned_lead_time_days`.

상태 전이: `draft → confirmed → partially_received → completed` (입고 확정이 자동 갱신), `draft|confirmed → canceled`.

## 6. 입고 (receipts / receipt_items) ✅

| Method | Path | 설명 |
|---|---|---|
| GET | /api/receipts | 입고전표 목록 (쿼리: `?status=draft`, `?purchase_order_id=1`) |
| GET | /api/receipts/:id | 입고전표 단건 (items 포함) |
| POST | /api/receipts | 입고전표 생성 (부분 입고 지원) |
| DELETE | /api/receipts/:id | 작성중 입고전표 삭제. 확정된 입고는 409 |
| POST | /api/receipts/:id/confirm | 입고 확정 → inventory_balances 증가 + stock_movements(receipt, 양수) + po_items.received_qty 누적 + 발주 상태 갱신 (트랜잭션) |

**POST 바디**: `purchase_order_id, receipt_no?, receipt_date?(기본 오늘), items: [{ po_item_id, received_qty }]`
**confirm 바디(선택)**: `confirmed_by?`
- 발주가 confirmed/partially_received일 때만 생성·확정 가능. 같은 po_item_id 중복 불가.
- 입고일이 발주일(`order_date`)보다 빠르면 400 (실제 납기 실적이 음수가 되는 것을 방지).
- 잔량(`ordered_qty - received_qty`) 초과는 생성 시 400, 확정 시 재검증 409 (같은 발주에 draft 입고가 여러 장일 수 있으므로). 확정은 발주서 행 잠금으로 직렬화.

## 7. 발주 추천 (replenishment_recommendations) ✅

| Method | Path | 설명 |
|---|---|---|
| POST | /api/recommendations/calculate | 상품(들)에 대해 규칙 기반 P50/P70/P90 추천 계산·스냅샷 저장 |
| GET | /api/recommendations | 추천 스냅샷 목록, 최신순 (쿼리: `?product_id=1`, `?latest=true`(상품별 최신 1건), `?limit=100`(최대 1000)). 각 행에 최신 판단(`decision_id, selected_strategy, final_qty, decision_status, purchase_order_id`) 포함 |

**calculate 바디(선택)**: `{ product_ids?: number[] }` — 생략 시 사용 중인 전 상품
**응답**: `{ created: [추천 스냅샷], not_forecastable: [{ product_id, sku, status: '예측 불가', reason, safety_stock_qty, on_hand_qty, outstanding_po_qty }], skipped: [{ product_id, sku, reason }] }`

**계산 규칙**
- 재고 위치 = 현재고 + 미입고 발주량(확정·부분입고 발주의 잔량)
- 보호기간 = 적용 납기 + `review_period_days`
- **적용 납기**: 상품 공급업체의 확정 입고(`receipts.status='confirmed'`) 실적이 **3건 이상**이면 평균 실제 납기(`receipt_date − 연결된 purchase_orders.order_date`, 반올림)를 사용, 3건 미만이면 `planned_lead_time_days`로 폴백
  - 입고 1건 = 표본 1개(부분 입고도 각각 1건). 입고일이 발주일보다 빠른 비정상 표본은 평균에서 제외하고 건수만 기록
  - `calculation_detail.lead_time`: `{ source: 'actual_supplier_avg' | 'planned', applied_days, planned_days, supplier_id, actual_samples, actual_avg_days, actual_min_days, actual_max_days, excluded_samples, min_samples_required: 3, rounding: 'round' }`
- 수요 분위수: 어제까지 **max(28일, 보호기간 × 2)일**(상한 365일)의 **확정 판매**(`sales.status='confirmed'`, `sale_date` 기준)를 일별 집계(판매 없는 날 0) → 보호기간 일수만큼 복원추출해 합산하는 부트스트랩 1000회 → 합계 분포의 P50/P70/P90 (선형 보간)
  - 상품의 최초 확정 판매일이 기간 안이면 그날부터만 사용 (출시 전 날짜를 0으로 채우지 않음)
  - 사용 가능 일수 < max(보호기간 × 2, 14일)이면 계산은 하되 `calculation_detail.insufficient_history = true`
  - 조회 기간을 이력 충분 기준과 같은 길이로 잡으므로, 판매 이력이 실제로 쌓여 있으면 보호기간이 긴 상품도 '이력 충분'이 된다. 부족 판정은 출시가 최근이라 이력이 짧은 경우에만 생긴다. 실제 조회 기간은 `calculation_detail.history_window`(`start`, `end`, `days`)에 기록
  - 기간 내 확정 판매가 0건이면 계산 생략 → 스냅샷 저장 없이 `not_forecastable`로 안전재고만 안내
- 목표재고 = 수요 분위수 + `safety_stock_qty`, 권장 발주량 = max(0, 목표재고 − 재고 위치)
- 권장량이 양수면 정수 올림 → `minimum_order_qty` 미만이면 최소 주문량 → `order_multiple`의 배수로 올림 (0이면 0 유지)
- 제외: 공급업체 미지정 상품, 미사용 상품 (`skipped`)
- `calculation_detail`(재현용): 집계 기간, 사용 가능·필요 일수, `insufficient_history`, 일별 수요 배열, 평균, 보호기간, 재고 위치, MOQ·배수, 부트스트랩 `{ iterations, seed, quantile_method }`, 전략별 `{ target_stock, raw_qty, after_moq, recommended_qty }`. 같은 일별 수요와 seed로 동일 결과 재현 가능
- `model_name='rule_based'`, `model_version='v1.1-bootstrap-lt-window'` (이전 버전 `v1-bootstrap28-lt`는 조회 기간 28일 고정)

## 8. 관리자 판단 이력 (recommendation_decisions) ✅

| Method | Path | 설명 |
|---|---|---|
| POST | /api/decisions | 추천에 대한 관리자 선택/수정 기록 (수정 시 사유 필수) |
| POST | /api/decisions/convert-to-po | 여러 판단 이력을 공급업체별 발주서(draft)로 일괄 전환 |
| GET | /api/decisions | 판단 이력(반려 제외)과 각 판단의 사후 평가, 최신순 (쿼리: `?product_id`, `?exclude_recommendation_id`, `?limit`). 추천 상세의 '이전 판단 이력'에 사용 |
| GET | /api/decisions/evaluation | 사후 평가 요약 `{ summary, items }` (쿼리: `?product_id`) |

**사후 평가** — 관리자가 추천과 다르게 판단한 경우, 시스템 추천과 관리자 수정 중 어느 쪽이 실제 수요에 더 가까웠는가
- 보호기간 = 추천 계산일부터 `protection_period_days`일. 종료일이 오늘보다 앞서야 평가(`evaluation.status='evaluated'`), 아니면 `pending` + `days_until_evaluable`
- 실제 수요 = 보호기간 동안의 확정 판매량. 사후 적정 발주량 Q* = max(0, ⌈실제 수요 + 안전재고 − 계산 당시 재고 위치⌉) (최소주문량·배수 미적용)
- 시스템 오차 = |시스템 추천 수량 − Q*|, 관리자 오차 = |관리자 최종 수량 − Q*| → `closer`: `manager` | `system` | `tie` | `same`(수정 안 함)
- 요약: 평가/대기 건수, 수정한 판단 중 관리자·시스템이 더 가까웠던 건수, 평균 절대 오차(수정한 판단 기준 시스템 vs 관리자, 전체)
- 평가는 저장하지 않고 조회 시점에 계산한다 (테이블 구조 변경 없음, 이후 판매 취소도 반영)

**POST /api/decisions 바디**: `recommendation_id, selected_strategy(P50|P70|P90|custom), decided_by, final_qty?, modification_reason?, decision_status?(confirmed 기본 | rejected)`
- `system_recommended_qty` = 선택 전략의 추천수량 (결정 시점 값 고정). custom은 상품 기본 전략(`default_strategy`)의 추천수량을 기준으로 함
- `final_qty` 생략 시 추천수량 그대로 (custom은 필수). 추천수량과 다르면 `modification_reason` 필수 (400, DB CHECK도 동일)
- 상품의 **최신 추천에만** 판단 가능 (재계산된 뒤 옛 추천은 409)
- 같은 추천에 pending/confirmed/converted_to_po 판단이 이미 있으면 409 (rejected 뒤에는 재판단 가능)

**POST /api/decisions/convert-to-po 바디**: `{ decision_ids: number[], created_by }`
- 전부 `confirmed` 상태, `final_qty > 0`, 공급업체 지정, 상품 중복 없음이어야 함 — 하나라도 어긋나면 409 + `detail`에 사유 목록, 전체 롤백
- 상품의 `supplier_id` 기준으로 묶어 **공급업체당 발주서 1장(draft)** 생성, 품목에 `recommendation_decision_id` 연결
- 판단 이력에 `purchase_order_id` 기록, `decision_status='converted_to_po'`
- 응답: `{ purchase_orders: [발주서 상세] }`. draft라 재고·미입고 발주량에는 영향 없음 → 발주 확정은 `POST /api/purchase-orders/:id/confirm`

---

## 공통 에러 응답 형식

```json
{ "error": "메시지", "detail": "DB 에러 상세(개발 중에만)" }
```

- 400: 입력값 검증 실패
- 404: 리소스 없음
- 409: FK/CHECK/UNIQUE 제약 위반 (예: 존재하지 않는 supplier_id, 중복 sku), 상태 전이 불가(이미 확정된 전표 등), 재고 부족, 입고 잔량 초과
- 500: 기타 서버 오류
