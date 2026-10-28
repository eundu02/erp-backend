-- ============================================================
-- 재고·발주 ERP 시스템 — PostgreSQL 스키마 (13개 테이블 확정안)
-- 기준 문서: Claude Docs "재고·발주 ERP — 13개 테이블 컬럼 확정안" (2026-10-08)
-- ============================================================

BEGIN;

-- 1. app_users — 사용자
CREATE TABLE app_users (
    user_id        serial PRIMARY KEY,
    username        varchar(50)  NOT NULL UNIQUE,
    password_hash   varchar(255) NOT NULL,
    full_name       varchar(50)  NOT NULL,
    role            varchar(20)  NOT NULL CHECK (role IN ('admin','manager','staff')),
    is_active       boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now()
);
-- 결정: role 컬럼은 스키마에 남기되, v1에서는 권한별 화면·API 제어를 구현하지 않고
-- 로그인한 모든 사용자를 사실상 manager 권한으로 취급한다.

-- 2. suppliers — 공급업체
CREATE TABLE suppliers (
    supplier_id     serial PRIMARY KEY,
    supplier_name   varchar(100) NOT NULL,
    contact_name    varchar(50),
    phone           varchar(30),
    email           varchar(100),
    address         varchar(200),
    is_active       boolean      NOT NULL DEFAULT true,
    created_at      timestamptz  NOT NULL DEFAULT now()
);

-- 3. products — 상품 (공급업체·납기·주문 조건 단순화 필드 포함)
CREATE TABLE products (
    product_id              serial PRIMARY KEY,
    sku                      varchar(50)  NOT NULL UNIQUE,
    product_name             varchar(100) NOT NULL,
    unit                     varchar(20)  NOT NULL,                 -- EA, BOX 등
    supplier_id              integer      REFERENCES suppliers(supplier_id),  -- NULL 허용 (결정)
    planned_lead_time_days   integer      NOT NULL CHECK (planned_lead_time_days >= 0),
    minimum_order_qty        integer      NOT NULL DEFAULT 1 CHECK (minimum_order_qty >= 1),
    order_multiple           integer      NOT NULL DEFAULT 1 CHECK (order_multiple >= 1),
    safety_stock_qty         integer      NOT NULL DEFAULT 0 CHECK (safety_stock_qty >= 0),
    review_period_days       integer      NOT NULL CHECK (review_period_days >= 0),
    default_strategy         varchar(10)  NOT NULL DEFAULT 'P50' CHECK (default_strategy IN ('P50','P70','P90')),
    is_active                boolean      NOT NULL DEFAULT true,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now()
);
-- 결정: supplier_id는 NULL 허용. 발주 추천 계산 시 supplier_id가 NULL인 상품은
-- 애플리케이션에서 계산 대상 제외 + 안내 처리.

-- 4. sales — 판매전표 헤더
CREATE TABLE sales (
    sale_id       serial PRIMARY KEY,
    sale_no       varchar(30)  NOT NULL UNIQUE,
    sale_date     date         NOT NULL,
    status        varchar(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','canceled')),
    created_by    integer      NOT NULL REFERENCES app_users(user_id),
    confirmed_at  timestamptz,                                       -- 확정 시점(재고 차감 시점)
    created_at    timestamptz  NOT NULL DEFAULT now()
);
-- 가정: customers 테이블은 제외했음. 필요 시 customer_name varchar(100) NULL 추가 가능.

-- 5. sale_items — 판매전표 상세
CREATE TABLE sale_items (
    sale_item_id  serial PRIMARY KEY,
    sale_id       integer      NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
    product_id    integer      NOT NULL REFERENCES products(product_id),
    quantity      integer      NOT NULL CHECK (quantity > 0),
    unit_price    numeric(12,2)
);
-- 결정: unit_price는 선택 필드(NULL 허용). 확정된 평가지표는 전부 수량 기반이라
-- 계산 로직에서는 사용하지 않고, 실무 관행대로 컬럼만 남겨둔다.

-- 6. purchase_orders — 구매발주서 헤더
CREATE TABLE purchase_orders (
    purchase_order_id       serial PRIMARY KEY,
    po_no                    varchar(30)  NOT NULL UNIQUE,
    supplier_id              integer      NOT NULL REFERENCES suppliers(supplier_id),
    order_date               date         NOT NULL,                  -- 발주 확정일
    expected_receipt_date    date,                                   -- 입고 예정일(적용 납기로 계산)
    status                   varchar(20)  NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','confirmed','partially_received','completed','canceled')),
    created_by               integer      NOT NULL REFERENCES app_users(user_id),
    confirmed_at             timestamptz,
    created_at               timestamptz  NOT NULL DEFAULT now()
);

-- 7. purchase_order_items — 구매발주서 상세
-- (recommendation_decisions FK는 13번 테이블 생성 후 ALTER로 추가 — 순환 참조 때문)
CREATE TABLE purchase_order_items (
    po_item_id                   serial PRIMARY KEY,
    purchase_order_id            integer      NOT NULL REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
    product_id                   integer      NOT NULL REFERENCES products(product_id),
    ordered_qty                  integer      NOT NULL CHECK (ordered_qty > 0),
    received_qty                 integer      NOT NULL DEFAULT 0
                                  CHECK (received_qty >= 0 AND received_qty <= ordered_qty),
    unit_price                   numeric(12,2),
    recommendation_decision_id   integer                               -- FK는 아래 ALTER에서 추가
);
-- 미입고 잔량 = ordered_qty - received_qty (별도 컬럼 없이 계산)

-- 8. receipts — 입고전표 헤더
CREATE TABLE receipts (
    receipt_id          serial PRIMARY KEY,
    receipt_no           varchar(30)  NOT NULL UNIQUE,
    purchase_order_id    integer      NOT NULL REFERENCES purchase_orders(purchase_order_id),
    receipt_date          date         NOT NULL,
    status                varchar(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
    confirmed_by          integer      REFERENCES app_users(user_id),
    confirmed_at          timestamptz,                                -- 확정 시점(재고 증가 시점)
    created_at            timestamptz  NOT NULL DEFAULT now()
);
-- 결정: 입고 1건은 발주서 1건에만 연결(1:1)로 유지.

-- 9. receipt_items — 입고전표 상세
CREATE TABLE receipt_items (
    receipt_item_id  serial PRIMARY KEY,
    receipt_id        integer      NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
    po_item_id         integer      NOT NULL REFERENCES purchase_order_items(po_item_id),  -- 상품은 이 FK로 간접 참조
    received_qty       integer      NOT NULL CHECK (received_qty > 0)
);
-- 입고 확정 시 이 값만큼 purchase_order_items.received_qty를 누적 증가시킨다(부분 입고 지원).

-- 10. inventory_balances — 현재고 조회용 (단일 창고, 상품당 1행)
CREATE TABLE inventory_balances (
    product_id    integer      PRIMARY KEY REFERENCES products(product_id),
    on_hand_qty    integer      NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
    updated_at     timestamptz  NOT NULL DEFAULT now()
);

-- 11. stock_movements — 재고 변동 이력(원장, append-only)
CREATE TABLE stock_movements (
    movement_id       serial PRIMARY KEY,
    product_id         integer      NOT NULL REFERENCES products(product_id),
    movement_type       varchar(20)  NOT NULL CHECK (movement_type IN ('sale','receipt','adjustment')),
    quantity_change      integer      NOT NULL CHECK (quantity_change <> 0),   -- 판매는 음수, 입고·조정 증가는 양수
    sale_item_id          integer      REFERENCES sale_items(sale_item_id),      -- movement_type='sale'일 때만 값 있음
    receipt_item_id       integer      REFERENCES receipt_items(receipt_item_id),-- movement_type='receipt'일 때만 값 있음
    reason                 text,                                                  -- adjustment일 때 애플리케이션에서 NOT NULL 체크
    created_by             integer      REFERENCES app_users(user_id),
    created_at             timestamptz  NOT NULL DEFAULT now()
);
-- 결정: 범용 reference_id/reference_type 폴리모픽 참조 대신 sale_item_id·receipt_item_id를
-- 각각 nullable FK로 분리. movement_type에 맞는 쪽만 값이 있어야 한다는 규칙은
-- 애플리케이션 검증으로 강제한다(DB CHECK로는 표현하지 않음).
-- 확정된 이력은 수정·삭제하지 않고, 취소가 필요하면 반대 부호의 행을 새로 추가한다.

-- 12. replenishment_recommendations — 발주 추천 스냅샷
CREATE TABLE replenishment_recommendations (
    recommendation_id             serial PRIMARY KEY,
    product_id                     integer      NOT NULL REFERENCES products(product_id),
    calculated_at                   timestamptz  NOT NULL DEFAULT now(),
    on_hand_qty_snapshot             integer      NOT NULL,            -- 계산 시점 현재고
    outstanding_po_qty_snapshot      integer      NOT NULL,            -- 계산 시점 미입고 발주량
    applied_lead_time_days           integer      NOT NULL,            -- 계산에 쓴 납기값(계획 납기 또는 실제 평균 납기)
    review_period_days_snapshot      integer      NOT NULL,
    safety_stock_qty_snapshot        integer      NOT NULL,
    demand_p50                        numeric(10,2) NOT NULL,          -- 보호기간 수요 예측값(분위수별)
    demand_p70                        numeric(10,2) NOT NULL,
    demand_p90                        numeric(10,2) NOT NULL,
    recommended_qty_p50               integer      NOT NULL CHECK (recommended_qty_p50 >= 0),  -- 최소주문량·주문배수 반영 후 값
    recommended_qty_p70               integer      NOT NULL CHECK (recommended_qty_p70 >= 0),
    recommended_qty_p90               integer      NOT NULL CHECK (recommended_qty_p90 >= 0),
    model_name                         varchar(30),                    -- 'rule_based' 또는 'lightgbm' 등
    model_version                      varchar(30),
    calculation_detail                  jsonb                           -- 재고 위치, 목표 재고 등 중간 계산값(재현성 확보용)
);

-- 13. recommendation_decisions — 관리자 판단 이력
CREATE TABLE recommendation_decisions (
    decision_id              serial PRIMARY KEY,
    recommendation_id         integer      NOT NULL REFERENCES replenishment_recommendations(recommendation_id),
    selected_strategy          varchar(10)  NOT NULL CHECK (selected_strategy IN ('P50','P70','P90','custom')),
    system_recommended_qty      integer      NOT NULL,                 -- 선택한 전략의 추천수량(결정 시점 값 고정)
    final_qty                   integer      NOT NULL CHECK (final_qty >= 0),  -- 최종 확정수량
    modification_reason          text         CHECK (final_qty = system_recommended_qty OR modification_reason IS NOT NULL),  -- 추천값과 다르면 사유 필수
    decision_status               varchar(20)  NOT NULL DEFAULT 'pending'
                                   CHECK (decision_status IN ('pending','confirmed','converted_to_po','rejected')),
    purchase_order_id             integer      REFERENCES purchase_orders(purchase_order_id),  -- 발주서로 전환된 뒤 연결
    decided_by                     integer      NOT NULL REFERENCES app_users(user_id),
    decided_at                      timestamptz,
    created_at                      timestamptz  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- purchase_order_items.recommendation_decision_id FK를 나중에 추가
-- (recommendation_decisions가 purchase_order_items보다 뒤에 생성되므로 순환 참조 회피)
-- ------------------------------------------------------------
ALTER TABLE purchase_order_items
    ADD CONSTRAINT fk_po_items_recommendation_decision
    FOREIGN KEY (recommendation_decision_id)
    REFERENCES recommendation_decisions(decision_id);

-- ------------------------------------------------------------
-- 인덱스 (FK 컬럼 조회 성능용 — PostgreSQL은 FK에 자동 인덱스를 만들지 않음)
-- ------------------------------------------------------------
CREATE INDEX idx_products_supplier_id ON products(supplier_id);
CREATE INDEX idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product_id ON sale_items(product_id);
CREATE INDEX idx_po_items_purchase_order_id ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_po_items_product_id ON purchase_order_items(product_id);
CREATE INDEX idx_po_items_recommendation_decision_id ON purchase_order_items(recommendation_decision_id);
CREATE INDEX idx_purchase_orders_supplier_id ON purchase_orders(supplier_id);
CREATE INDEX idx_receipts_purchase_order_id ON receipts(purchase_order_id);
CREATE INDEX idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX idx_receipt_items_po_item_id ON receipt_items(po_item_id);
CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_sale_item_id ON stock_movements(sale_item_id);
CREATE INDEX idx_stock_movements_receipt_item_id ON stock_movements(receipt_item_id);
CREATE INDEX idx_recommendations_product_id ON replenishment_recommendations(product_id);
CREATE INDEX idx_decisions_recommendation_id ON recommendation_decisions(recommendation_id);
CREATE INDEX idx_decisions_purchase_order_id ON recommendation_decisions(purchase_order_id);

COMMIT;
