const pool = require('../db/pool');
const withTransaction = require('../db/transaction');

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.is_active !== undefined) {
    values.push(req.query.is_active === 'true');
    conditions.push(`is_active = $${values.length}`);
  }
  if (req.query.supplier_id !== undefined) {
    values.push(req.query.supplier_id);
    conditions.push(`supplier_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM products ${where} ORDER BY product_id`,
    values
  );
  res.json(rows);
}

async function getOne(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM products WHERE product_id = $1',
    [req.params.id]
  );
  if (rows.length === 0) throw httpError(404, '상품을 찾을 수 없습니다.');
  res.json(rows[0]);
}

async function create(req, res) {
  const {
    sku, product_name, unit, supplier_id,
    planned_lead_time_days, minimum_order_qty, order_multiple,
    safety_stock_qty, review_period_days, default_strategy, is_active,
  } = req.body;

  // DB의 NOT NULL/CHECK가 최종 방어선이지만, 흔한 실수는 여기서 먼저 400으로 걸러준다.
  const required = { sku, product_name, unit, planned_lead_time_days, review_period_days };
  for (const [key, value] of Object.entries(required)) {
    if (value === undefined || value === null || value === '') {
      throw httpError(400, `${key}는 필수입니다.`);
    }
  }

  // 상품과 초기 재고 행(0)을 한 트랜잭션으로 만든다 — 둘 중 하나만 생기는 일이 없도록.
  const product = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO products
         (sku, product_name, unit, supplier_id, planned_lead_time_days,
          minimum_order_qty, order_multiple, safety_stock_qty, review_period_days,
          default_strategy, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6,1), COALESCE($7,1), COALESCE($8,0), $9,
               COALESCE($10,'P50'), COALESCE($11, true))
       RETURNING *`,
      [sku, product_name, unit, supplier_id ?? null, planned_lead_time_days,
        minimum_order_qty, order_multiple, safety_stock_qty, review_period_days,
        default_strategy, is_active]
    );
    // 재고 조회 API가 바로 동작하도록 inventory_balances에 0으로 초기 행을 만든다.
    await client.query(
      'INSERT INTO inventory_balances (product_id, on_hand_qty) VALUES ($1, 0)',
      [rows[0].product_id]
    );
    return rows[0];
  });

  res.status(201).json(product);
}

async function update(req, res) {
  // supplier_id는 의도적으로 NULL로 지우는 것도 허용해야 하므로(공급업체 미지정),
  // COALESCE로는 "바디에 키가 없을 때"와 "명시적으로 null을 보낼 때"를 구분할 수 없다.
  // 그래서 기존 행을 먼저 읽어와 바디에 있는 키만 덮어쓰는 방식(PATCH 의미)을 쓴다.
  const { rows: existingRows } = await pool.query(
    'SELECT * FROM products WHERE product_id = $1',
    [req.params.id]
  );
  if (existingRows.length === 0) throw httpError(404, '상품을 찾을 수 없습니다.');
  const current = existingRows[0];

  const merged = {
    sku: 'sku' in req.body ? req.body.sku : current.sku,
    product_name: 'product_name' in req.body ? req.body.product_name : current.product_name,
    unit: 'unit' in req.body ? req.body.unit : current.unit,
    supplier_id: 'supplier_id' in req.body ? req.body.supplier_id : current.supplier_id,
    planned_lead_time_days: 'planned_lead_time_days' in req.body ? req.body.planned_lead_time_days : current.planned_lead_time_days,
    minimum_order_qty: 'minimum_order_qty' in req.body ? req.body.minimum_order_qty : current.minimum_order_qty,
    order_multiple: 'order_multiple' in req.body ? req.body.order_multiple : current.order_multiple,
    safety_stock_qty: 'safety_stock_qty' in req.body ? req.body.safety_stock_qty : current.safety_stock_qty,
    review_period_days: 'review_period_days' in req.body ? req.body.review_period_days : current.review_period_days,
    default_strategy: 'default_strategy' in req.body ? req.body.default_strategy : current.default_strategy,
    is_active: 'is_active' in req.body ? req.body.is_active : current.is_active,
  };

  const { rows } = await pool.query(
    `UPDATE products SET
       sku = $1, product_name = $2, unit = $3, supplier_id = $4,
       planned_lead_time_days = $5, minimum_order_qty = $6, order_multiple = $7,
       safety_stock_qty = $8, review_period_days = $9, default_strategy = $10,
       is_active = $11, updated_at = now()
     WHERE product_id = $12
     RETURNING *`,
    [merged.sku, merged.product_name, merged.unit, merged.supplier_id,
      merged.planned_lead_time_days, merged.minimum_order_qty, merged.order_multiple,
      merged.safety_stock_qty, merged.review_period_days, merged.default_strategy,
      merged.is_active, req.params.id]
  );
  res.json(rows[0]);
}

async function remove(req, res) {
  const { rows } = await pool.query(
    'DELETE FROM products WHERE product_id = $1 RETURNING product_id',
    [req.params.id]
  );
  if (rows.length === 0) throw httpError(404, '상품을 찾을 수 없습니다.');
  res.status(204).send();
}

module.exports = { list, getOne, create, update, remove };
