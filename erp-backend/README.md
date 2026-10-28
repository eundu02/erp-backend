# ERP Backend (9주차 — 기본 ERP + 규칙 기반 발주 추천·관리자 판단)

## 실행 방법

```bash
npm install
cp .env.example .env   # 그리고 .env 안의 PGPASSWORD를 본인 postgres 비밀번호로 수정
npm run dev             # http://localhost:4000
```

PostgreSQL에 `erp_dev` 데이터베이스가 있어야 하고, 이전에 받은 `erp_schema.sql`을
먼저 실행해 13개 테이블이 만들어져 있어야 합니다. 판매·발주 전표의 `created_by`(NOT NULL)에
쓸 개발용 사용자(user_id=1)도 넣어주세요:

```bash
psql -d erp_dev -f erp_schema.sql
psql -d erp_dev -f sql/seed_dev.sql
```

> Windows Git Bash/PowerShell의 curl로 한글이 든 JSON을 `-d` 인자로 보내면 UTF-8이 아닌 인코딩으로 전송되어
> DB에 깨진 문자(�)로 저장됩니다. 한글 데이터는 `-d @파일.json`(UTF-8 저장)이나 Postman 등으로 보내세요.

## 데모 데이터 (발표·화면 확인용)

빈 DB에서 서버를 띄운 뒤 실행하면 공급업체 3곳, 상품 9종, 30일치 판매 이력, 진행 중 발주(부분입고·예정일 경과·작성중)를
실제 API를 통해 만들어줍니다 (상품이 이미 있으면 중단). 과거 발주·입고 이력도 만들어 공급업체별 실제 납기 실적이 생깁니다
(식품 4건 평균 4.25일·사무용품 4건 평균 8일 → 실적 납기 적용, 생활용품 2건 → 계획 납기 폴백).
판매 이력은 60일치이며, 사후 평가 화면 시연을 위해 30일 전 판단 7건도 만든다.
**주의: 과거 판단은 오늘 데이터로 계산한 뒤 날짜만 되돌린 시연용이라(미래 수요를 이미 본 상태) 평가 결과를 실험 결과로 쓰면 안 된다.**
과거 발주일은 API로 지정할 수 없어 이 스크립트에서만 SQL로 `order_date`를 되돌립니다.

```bash
npm run seed:demo
```

처음 상태로 되돌리려면 모든 테이블을 비운 뒤 `sql/seed_dev.sql` → `npm run seed:demo` 순서로 다시 실행하세요.

```sql
TRUNCATE app_users, suppliers, products, sales, sale_items, purchase_orders, purchase_order_items,
  receipts, receipt_items, inventory_balances, stock_movements,
  replenishment_recommendations, recommendation_decisions RESTART IDENTITY CASCADE;
```

화면은 `../erp-frontend` 참고.

## 자동 검증

```bash
npm test
```

별도 테스트 DB(`erp_test`)를 새로 만들고 4001번 포트로 서버를 띄운 뒤 API 시나리오 4묶음(기본 ERP 51개, 발주 추천·판단 53개,
유지보수 기능 21개, 이력 조회 기간·이전 판단·사후 평가·백테스트 28개 — 총 153개 항목)을 실행하고, 끝나면 서버를 끄고 테스트 DB를 삭제한다. `.env`의 운영·시연 DB는 건드리지 않는다.
검증 스크립트는 `tests/`, 스키마 원본은 `sql/erp_schema.sql`.

## 빠른 동작 확인

```bash
curl http://localhost:4000/api/health

curl -X POST http://localhost:4000/api/suppliers \
  -H "Content-Type: application/json" \
  -d '{"supplier_name":"테스트공급사"}'

curl -X POST http://localhost:4000/api/products \
  -H "Content-Type: application/json" \
  -d '{"sku":"SKU-001","product_name":"테스트상품","unit":"EA","supplier_id":1,"planned_lead_time_days":7,"review_period_days":7}'

curl http://localhost:4000/api/products

# 발주 → 확정 → 부분 입고 → 판매 확정
curl -X POST http://localhost:4000/api/purchase-orders -H "Content-Type: application/json"   -d '{"supplier_id":1,"created_by":1,"items":[{"product_id":1,"ordered_qty":10}]}'
curl -X POST http://localhost:4000/api/purchase-orders/1/confirm
curl -X POST http://localhost:4000/api/receipts -H "Content-Type: application/json"   -d '{"purchase_order_id":1,"items":[{"po_item_id":1,"received_qty":4}]}'
curl -X POST http://localhost:4000/api/receipts/1/confirm
curl -X POST http://localhost:4000/api/sales -H "Content-Type: application/json"   -d '{"created_by":1,"items":[{"product_id":1,"quantity":3}]}'
curl -X POST http://localhost:4000/api/sales/1/confirm
curl http://localhost:4000/api/inventory/1          # on_hand_qty: 1, outstanding_po_qty: 6
curl "http://localhost:4000/api/stock-movements?product_id=1"
```

## 구조

```
src/
  server.js        서버 시작점
  app.js           express 앱 구성, 라우터 연결
  db/pool.js        PostgreSQL 연결 풀
  db/transaction.js  BEGIN~COMMIT/ROLLBACK 헬퍼
  routes/           엔드포인트 -> 컨트롤러 매핑만
  controllers/       실제 쿼리/비즈니스 로직
  services/stock.js  재고 변동의 유일한 진입점 (inventory_balances + stock_movements 동시 기록)
  services/docNo.js  전표 번호 자동 생성
  services/forecast.js 부트스트랩 분위수·권장 발주량 계산 (순수 함수, seed로 재현 가능)
  middleware/         공통 에러 핸들링, async 래퍼
  utils/              httpError, 입력값 검증
sql/seed_dev.sql     개발용 사용자 시드
```

API 전체 명세(앞으로 구현할 것 포함)는 `API_SPEC.md` 참고.
