const pool = require('../db/pool');
const httpError = require('../utils/httpError');

// 상품 기준 LEFT JOIN — inventory_balances 행이 없는 상품도 현재고 0으로 보여준다.
// outstanding_po_qty: 확정/부분입고 상태 발주의 미입고 잔량 합계 (발주 추천 계산에 쓰일 값)
const INVENTORY_SELECT = `
  SELECT p.product_id, p.sku, p.product_name, p.unit, p.supplier_id, p.is_active,
         p.safety_stock_qty,
         COALESCE(ib.on_hand_qty, 0) AS on_hand_qty,
         COALESCE(po.outstanding_qty, 0)::int AS outstanding_po_qty,
         COALESCE(ib.on_hand_qty, 0) < p.safety_stock_qty AS below_safety_stock,
         ib.updated_at
    FROM products p
    LEFT JOIN inventory_balances ib ON ib.product_id = p.product_id
    LEFT JOIN (
      SELECT poi.product_id, SUM(poi.ordered_qty - poi.received_qty) AS outstanding_qty
        FROM purchase_order_items poi
        JOIN purchase_orders o ON o.purchase_order_id = poi.purchase_order_id
       WHERE o.status IN ('confirmed', 'partially_received')
       GROUP BY poi.product_id
    ) po ON po.product_id = p.product_id`;

async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.is_active !== undefined) {
    values.push(req.query.is_active === 'true');
    conditions.push(`p.is_active = $${values.length}`);
  }
  if (req.query.below_safety_stock === 'true') {
    conditions.push('COALESCE(ib.on_hand_qty, 0) < p.safety_stock_qty');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`${INVENTORY_SELECT} ${where} ORDER BY p.product_id`, values);
  res.json(rows);
}

async function getOne(req, res) {
  const { rows } = await pool.query(`${INVENTORY_SELECT} WHERE p.product_id = $1`, [req.params.product_id]);
  if (rows.length === 0) throw httpError(404, '상품을 찾을 수 없습니다.');
  res.json(rows[0]);
}

// 재고 변동 이력 (원장) 조회
async function listMovements(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.product_id !== undefined) {
    values.push(req.query.product_id);
    conditions.push(`m.product_id = $${values.length}`);
  }
  if (req.query.movement_type !== undefined) {
    values.push(req.query.movement_type);
    conditions.push(`m.movement_type = $${values.length}`);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
  values.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT m.*, p.sku, p.product_name
       FROM stock_movements m
       JOIN products p ON p.product_id = m.product_id
       ${where}
      ORDER BY m.movement_id DESC
      LIMIT $${values.length}`,
    values
  );
  res.json(rows);
}

module.exports = { list, getOne, listMovements };
