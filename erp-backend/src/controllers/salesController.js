const pool = require('../db/pool');
const withTransaction = require('../db/transaction');
const httpError = require('../utils/httpError');
const { requirePositiveInt, requireNonEmptyArray } = require('../utils/validate');
const { nextIdAndNo } = require('../services/docNo');
const { applyStockChange } = require('../services/stock');

async function fetchSale(db, saleId) {
  const { rows } = await db.query('SELECT * FROM sales WHERE sale_id = $1', [saleId]);
  if (rows.length === 0) return null;
  const { rows: items } = await db.query(
    `SELECT si.*, p.sku, p.product_name, p.unit
       FROM sale_items si
       JOIN products p ON p.product_id = si.product_id
      WHERE si.sale_id = $1
      ORDER BY si.sale_item_id`,
    [saleId]
  );
  return { ...rows[0], items };
}

async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.status !== undefined) {
    values.push(req.query.status);
    conditions.push(`s.status = $${values.length}`);
  }
  if (req.query.from !== undefined) {
    values.push(req.query.from);
    conditions.push(`s.sale_date >= $${values.length}`);
  }
  if (req.query.to !== undefined) {
    values.push(req.query.to);
    conditions.push(`s.sale_date <= $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT s.*,
            COUNT(si.sale_item_id)::int AS item_count,
            COALESCE(SUM(si.quantity), 0)::int AS total_qty
       FROM sales s
       LEFT JOIN sale_items si ON si.sale_id = s.sale_id
       ${where}
      GROUP BY s.sale_id
      ORDER BY s.sale_id DESC`,
    values
  );
  res.json(rows);
}

async function getOne(req, res) {
  const sale = await fetchSale(pool, req.params.id);
  if (!sale) throw httpError(404, '판매전표를 찾을 수 없습니다.');
  res.json(sale);
}

// 판매전표 생성 (status=draft). 재고는 아직 건드리지 않는다 — 차감은 confirm 시점.
async function create(req, res) {
  const { sale_no, sale_date, created_by, items } = req.body;

  requirePositiveInt(created_by, 'created_by');
  requireNonEmptyArray(items, 'items');
  items.forEach((it, i) => {
    requirePositiveInt(it.product_id, `items[${i}].product_id`);
    requirePositiveInt(it.quantity, `items[${i}].quantity`);
  });

  const saleId = await withTransaction(async (client) => {
    const { id, no } = await nextIdAndNo(client, 'sales', 'sale_id', 'SO');
    await client.query(
      `INSERT INTO sales (sale_id, sale_no, sale_date, created_by)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4)`,
      [id, sale_no || no, sale_date ?? null, created_by]
    );
    for (const it of items) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [id, it.product_id, it.quantity, it.unit_price ?? null]
      );
    }
    return id;
  });

  res.status(201).json(await fetchSale(pool, saleId));
}

// 판매 확정: draft → confirmed. 상세 행마다 재고 차감 + stock_movements(sale, 음수) 기록.
// 한 품목이라도 재고가 부족하면 전체 롤백 (409).
async function confirm(req, res) {
  const saleId = req.params.id;

  await withTransaction(async (client) => {
    // FOR UPDATE: 같은 전표를 동시에 두 번 확정하는 것을 막는다.
    const { rows } = await client.query('SELECT * FROM sales WHERE sale_id = $1 FOR UPDATE', [saleId]);
    if (rows.length === 0) throw httpError(404, '판매전표를 찾을 수 없습니다.');
    const sale = rows[0];
    if (sale.status !== 'draft') {
      throw httpError(409, `draft 상태의 판매전표만 확정할 수 있습니다. (현재: ${sale.status})`);
    }

    // product_id 순서로 처리 → 여러 판매 확정이 동시에 돌 때 잔액 행 락 순서가 같아 데드락 방지
    const { rows: items } = await client.query(
      'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY product_id, sale_item_id',
      [saleId]
    );
    if (items.length === 0) throw httpError(409, '상세 항목이 없는 판매전표는 확정할 수 없습니다.');

    for (const it of items) {
      await applyStockChange(client, {
        productId: it.product_id,
        quantityChange: -it.quantity,
        movementType: 'sale',
        saleItemId: it.sale_item_id,
        userId: req.body?.confirmed_by ?? sale.created_by,
      });
    }

    await client.query(
      "UPDATE sales SET status = 'confirmed', confirmed_at = now() WHERE sale_id = $1",
      [saleId]
    );
  });

  res.json(await fetchSale(pool, saleId));
}

// 판매 취소:
//  - draft     → canceled (재고 변동 없음)
//  - confirmed → canceled + 반대 부호(+) stock_movements 추가로 재고 복원 (원장은 수정·삭제하지 않음)
async function cancel(req, res) {
  const saleId = req.params.id;
  const reason = req.body?.reason ? String(req.body.reason).trim() : '판매 취소';

  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE sale_id = $1 FOR UPDATE', [saleId]);
    if (rows.length === 0) throw httpError(404, '판매전표를 찾을 수 없습니다.');
    const sale = rows[0];
    if (sale.status === 'canceled') throw httpError(409, '이미 취소된 판매전표입니다.');

    if (sale.status === 'confirmed') {
      const { rows: items } = await client.query(
        'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY product_id, sale_item_id',
        [saleId]
      );
      for (const it of items) {
        await applyStockChange(client, {
          productId: it.product_id,
          quantityChange: it.quantity,
          movementType: 'sale',
          saleItemId: it.sale_item_id,
          reason,
          userId: req.body?.canceled_by ?? sale.created_by,
        });
      }
    }

    await client.query("UPDATE sales SET status = 'canceled' WHERE sale_id = $1", [saleId]);
  });

  res.json(await fetchSale(pool, saleId));
}

// 작성중 판매전표 삭제. 확정·취소된 전표는 이력 보존을 위해 삭제하지 않는다(확정 전표는 취소를 사용).
async function remove(req, res) {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM sales WHERE sale_id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) throw httpError(404, '판매전표를 찾을 수 없습니다.');
    if (rows[0].status !== 'draft') {
      throw httpError(409, `작성중 전표만 삭제할 수 있습니다. (현재: ${rows[0].status}) 확정된 전표는 취소를 사용하세요.`);
    }
    await client.query('DELETE FROM sales WHERE sale_id = $1', [req.params.id]); // sale_items는 CASCADE
  });
  res.status(204).send();
}

module.exports = { list, getOne, create, confirm, cancel, remove };
