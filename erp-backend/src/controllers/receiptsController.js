const pool = require('../db/pool');
const withTransaction = require('../db/transaction');
const httpError = require('../utils/httpError');
const { requirePositiveInt, requireNonEmptyArray } = require('../utils/validate');
const { nextIdAndNo } = require('../services/docNo');
const { applyStockChange } = require('../services/stock');

const RECEIVABLE_PO_STATUSES = ['confirmed', 'partially_received'];

async function fetchReceipt(db, receiptId) {
  const { rows } = await db.query(
    `SELECT r.*, o.po_no
       FROM receipts r
       JOIN purchase_orders o ON o.purchase_order_id = r.purchase_order_id
      WHERE r.receipt_id = $1`,
    [receiptId]
  );
  if (rows.length === 0) return null;
  const { rows: items } = await db.query(
    `SELECT ri.*, poi.product_id, poi.ordered_qty, poi.received_qty AS po_received_qty,
            p.sku, p.product_name, p.unit
       FROM receipt_items ri
       JOIN purchase_order_items poi ON poi.po_item_id = ri.po_item_id
       JOIN products p ON p.product_id = poi.product_id
      WHERE ri.receipt_id = $1
      ORDER BY ri.receipt_item_id`,
    [receiptId]
  );
  return { ...rows[0], items };
}

async function list(req, res) {
  const conditions = [];
  const values = [];

  if (req.query.status !== undefined) {
    values.push(req.query.status);
    conditions.push(`r.status = $${values.length}`);
  }
  if (req.query.purchase_order_id !== undefined) {
    values.push(req.query.purchase_order_id);
    conditions.push(`r.purchase_order_id = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT r.*, o.po_no,
            COUNT(ri.receipt_item_id)::int AS item_count,
            COALESCE(SUM(ri.received_qty), 0)::int AS total_received_qty
       FROM receipts r
       JOIN purchase_orders o ON o.purchase_order_id = r.purchase_order_id
       LEFT JOIN receipt_items ri ON ri.receipt_id = r.receipt_id
       ${where}
      GROUP BY r.receipt_id, o.po_no
      ORDER BY r.receipt_id DESC`,
    values
  );
  res.json(rows);
}

async function getOne(req, res) {
  const receipt = await fetchReceipt(pool, req.params.id);
  if (!receipt) throw httpError(404, '입고전표를 찾을 수 없습니다.');
  res.json(receipt);
}

// 입고전표 생성 (status=draft). 부분 입고: 발주 잔량 이하의 수량만 받으면 된다.
async function create(req, res) {
  const { receipt_no, purchase_order_id, receipt_date, items } = req.body;

  requirePositiveInt(purchase_order_id, 'purchase_order_id');
  requireNonEmptyArray(items, 'items');
  items.forEach((it, i) => {
    requirePositiveInt(it.po_item_id, `items[${i}].po_item_id`);
    requirePositiveInt(it.received_qty, `items[${i}].received_qty`);
  });
  const poItemIds = items.map((it) => it.po_item_id);
  if (new Set(poItemIds).size !== poItemIds.length) {
    throw httpError(400, '같은 po_item_id가 items에 중복되어 있습니다.');
  }

  const receiptId = await withTransaction(async (client) => {
    const { rows: pos } = await client.query(
      `SELECT status, order_date, COALESCE($2::date, CURRENT_DATE)::text AS receipt_date
         FROM purchase_orders WHERE purchase_order_id = $1`,
      [purchase_order_id, receipt_date ?? null]
    );
    if (pos.length === 0) throw httpError(404, '발주서를 찾을 수 없습니다.');
    if (!RECEIVABLE_PO_STATUSES.includes(pos[0].status)) {
      throw httpError(409, `확정 또는 부분입고 상태의 발주서만 입고할 수 있습니다. (현재: ${pos[0].status})`);
    }
    // 입고일 < 발주일이면 실제 납기 실적(receipt_date − order_date)이 음수가 되므로 거부
    if (pos[0].receipt_date < pos[0].order_date) {
      throw httpError(400, `입고일(${pos[0].receipt_date})이 발주일(${pos[0].order_date})보다 빠를 수 없습니다.`);
    }

    // 1차 검증: 해당 발주서의 품목인지 + 잔량 초과 여부. (최종 검증은 확정 시점에 다시 한다 —
    // 같은 발주에 draft 입고전표가 여러 장 있을 수 있으므로)
    const { rows: poItems } = await client.query(
      `SELECT po_item_id, ordered_qty, received_qty FROM purchase_order_items
        WHERE purchase_order_id = $1 AND po_item_id = ANY($2::int[])`,
      [purchase_order_id, poItemIds]
    );
    const byId = new Map(poItems.map((r) => [r.po_item_id, r]));
    for (const it of items) {
      const poi = byId.get(it.po_item_id);
      if (!poi) throw httpError(400, `po_item_id=${it.po_item_id}는 이 발주서의 품목이 아닙니다.`);
      const remaining = poi.ordered_qty - poi.received_qty;
      if (it.received_qty > remaining) {
        throw httpError(400, `입고 수량이 미입고 잔량을 초과합니다. (po_item_id=${it.po_item_id}, 잔량=${remaining}, 요청=${it.received_qty})`);
      }
    }

    const { id, no } = await nextIdAndNo(client, 'receipts', 'receipt_id', 'RC');
    await client.query(
      `INSERT INTO receipts (receipt_id, receipt_no, purchase_order_id, receipt_date)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))`,
      [id, receipt_no || no, purchase_order_id, receipt_date ?? null]
    );
    for (const it of items) {
      await client.query(
        'INSERT INTO receipt_items (receipt_id, po_item_id, received_qty) VALUES ($1, $2, $3)',
        [id, it.po_item_id, it.received_qty]
      );
    }
    return id;
  });

  res.status(201).json(await fetchReceipt(pool, receiptId));
}

// 입고 확정: draft → confirmed.
//  1) purchase_order_items.received_qty 누적
//  2) inventory_balances 증가 + stock_movements(receipt, 양수) 기록
//  3) 발주서 상태 갱신: 전 품목 완납이면 completed, 아니면 partially_received
async function confirm(req, res) {
  const receiptId = req.params.id;
  const confirmedBy = req.body?.confirmed_by ?? null;

  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM receipts WHERE receipt_id = $1 FOR UPDATE', [receiptId]);
    if (rows.length === 0) throw httpError(404, '입고전표를 찾을 수 없습니다.');
    const receipt = rows[0];
    if (receipt.status !== 'draft') {
      throw httpError(409, `draft 상태의 입고전표만 확정할 수 있습니다. (현재: ${receipt.status})`);
    }

    // 발주서를 잠가서 같은 발주에 대한 입고 확정을 직렬화한다 (잔량 초과 입고 방지).
    const { rows: pos } = await client.query(
      'SELECT status FROM purchase_orders WHERE purchase_order_id = $1 FOR UPDATE',
      [receipt.purchase_order_id]
    );
    if (!RECEIVABLE_PO_STATUSES.includes(pos[0].status)) {
      throw httpError(409, `확정 또는 부분입고 상태의 발주서만 입고 확정할 수 있습니다. (현재: ${pos[0].status})`);
    }

    const { rows: items } = await client.query(
      `SELECT ri.*, poi.product_id
         FROM receipt_items ri
         JOIN purchase_order_items poi ON poi.po_item_id = ri.po_item_id
        WHERE ri.receipt_id = $1
        ORDER BY poi.product_id, ri.receipt_item_id`,
      [receiptId]
    );
    if (items.length === 0) throw httpError(409, '상세 항목이 없는 입고전표는 확정할 수 없습니다.');

    for (const it of items) {
      const { rowCount } = await client.query(
        `UPDATE purchase_order_items
            SET received_qty = received_qty + $2
          WHERE po_item_id = $1 AND received_qty + $2 <= ordered_qty`,
        [it.po_item_id, it.received_qty]
      );
      if (rowCount === 0) {
        const { rows: cur } = await client.query(
          'SELECT ordered_qty, received_qty FROM purchase_order_items WHERE po_item_id = $1',
          [it.po_item_id]
        );
        throw httpError(409, '입고 수량이 미입고 잔량을 초과합니다.', {
          po_item_id: it.po_item_id,
          remaining_qty: cur[0].ordered_qty - cur[0].received_qty,
          requested_qty: it.received_qty,
        });
      }

      await applyStockChange(client, {
        productId: it.product_id,
        quantityChange: it.received_qty,
        movementType: 'receipt',
        receiptItemId: it.receipt_item_id,
        userId: confirmedBy,
      });
    }

    await client.query(
      `UPDATE purchase_orders o
          SET status = CASE WHEN NOT EXISTS (
                         SELECT 1 FROM purchase_order_items poi
                          WHERE poi.purchase_order_id = o.purchase_order_id
                            AND poi.received_qty < poi.ordered_qty)
                       THEN 'completed' ELSE 'partially_received' END
        WHERE o.purchase_order_id = $1`,
      [receipt.purchase_order_id]
    );

    await client.query(
      "UPDATE receipts SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE receipt_id = $1",
      [receiptId, confirmedBy]
    );
  });

  res.json(await fetchReceipt(pool, receiptId));
}

// 작성중 입고전표 삭제 (확정된 입고는 재고·누적 입고량에 반영됐으므로 삭제 불가)
async function remove(req, res) {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM receipts WHERE receipt_id = $1 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) throw httpError(404, '입고전표를 찾을 수 없습니다.');
    if (rows[0].status !== 'draft') throw httpError(409, '확정된 입고전표는 삭제할 수 없습니다.');
    await client.query('DELETE FROM receipts WHERE receipt_id = $1', [req.params.id]); // receipt_items는 CASCADE
  });
  res.status(204).send();
}

module.exports = { list, getOne, create, confirm, remove };
