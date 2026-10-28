// 재고 변동의 유일한 진입점.
// 재고가 바뀌는 시점은 판매 확정(취소 시 반대 부호 포함)과 입고 확정뿐이므로 'sale'/'receipt'만 허용한다.
// (스키마에는 'adjustment'도 있지만 v1에서는 수동 재고 조정을 지원하지 않음)
// inventory_balances(현재고)와 stock_movements(원장)를 항상 같은 트랜잭션 안에서 함께 바꾼다.
// 반드시 withTransaction 안의 client로 호출할 것.
const httpError = require('../utils/httpError');

const MOVEMENT_TYPES = new Set(['sale', 'receipt']);

/**
 * @param {import('pg').PoolClient} client
 * @param {object} p
 * @param {number} p.productId
 * @param {number} p.quantityChange  양수=증가, 음수=감소 (0 불가)
 * @param {'sale'|'receipt'} p.movementType
 * @param {number} [p.saleItemId]     movementType='sale'일 때 필수
 * @param {number} [p.receiptItemId]  movementType='receipt'일 때 필수
 * @param {string} [p.reason]         취소(반대 부호) 행의 사유 등
 * @param {number} [p.userId]
 * @returns {Promise<{movement: object, onHandQty: number}>}
 */
async function applyStockChange(client, p) {
  const {
    productId, quantityChange, movementType,
    saleItemId = null, receiptItemId = null, reason = null, userId = null,
  } = p;

  // 스키마 주석의 "movement_type에 맞는 참조만 값이 있어야 한다" 규칙을 여기서 강제한다.
  if (!MOVEMENT_TYPES.has(movementType)) throw new Error(`잘못된 movement_type: ${movementType}`);
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    throw new Error('quantityChange는 0이 아닌 정수여야 합니다.');
  }
  if (movementType === 'sale' && (saleItemId == null || receiptItemId != null)) {
    throw new Error("movement_type='sale'에는 sale_item_id만 지정해야 합니다.");
  }
  if (movementType === 'receipt' && (receiptItemId == null || saleItemId != null)) {
    throw new Error("movement_type='receipt'에는 receipt_item_id만 지정해야 합니다.");
  }

  let onHandQty;
  if (quantityChange > 0) {
    // 증가: 잔액 행이 없을 수도 있으므로 upsert
    const { rows } = await client.query(
      `INSERT INTO inventory_balances (product_id, on_hand_qty, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (product_id) DO UPDATE
         SET on_hand_qty = inventory_balances.on_hand_qty + EXCLUDED.on_hand_qty,
             updated_at = now()
       RETURNING on_hand_qty`,
      [productId, quantityChange]
    );
    onHandQty = rows[0].on_hand_qty;
  } else {
    // 감소: 조건부 UPDATE 한 번으로 "재고 확인 + 차감"을 원자적으로 처리 (동시 판매 확정에도 음수 재고 불가)
    const { rows } = await client.query(
      `UPDATE inventory_balances
          SET on_hand_qty = on_hand_qty + $2, updated_at = now()
        WHERE product_id = $1 AND on_hand_qty + $2 >= 0
        RETURNING on_hand_qty`,
      [productId, quantityChange]
    );
    if (rows.length === 0) {
      const { rows: cur } = await client.query(
        'SELECT on_hand_qty FROM inventory_balances WHERE product_id = $1',
        [productId]
      );
      const available = cur.length ? cur[0].on_hand_qty : 0;
      throw httpError(409, '재고가 부족합니다.', {
        product_id: productId, available_qty: available, requested_qty: -quantityChange,
      });
    }
    onHandQty = rows[0].on_hand_qty;
  }

  const { rows: mv } = await client.query(
    `INSERT INTO stock_movements
       (product_id, movement_type, quantity_change, sale_item_id, receipt_item_id, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [productId, movementType, quantityChange, saleItemId, receiptItemId, reason, userId]
  );

  return { movement: mv[0], onHandQty };
}

module.exports = { applyStockChange };
