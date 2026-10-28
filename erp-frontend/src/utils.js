import dayjs from 'dayjs';

export const fmtNum = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('ko-KR'));
export const fmtDate = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '-');
export const fmtDateTime = (d) => (d ? dayjs(d).format('YYYY-MM-DD HH:mm') : '-');
export const fmtPrice = (p) => (p === null || p === undefined ? '-' : `${Number(p).toLocaleString('ko-KR')}원`);

// 서버 에러의 detail(재고 부족, 입고 잔량 초과 등)을 사람이 읽을 수 있는 문장으로 바꾼다.
// nameOf(product_id) / poItemName(po_item_id)로 ID 대신 상품명을 보여줄 수 있다.
export function describeError(err, { nameOf, poItemName } = {}) {
  const d = err.detail;
  if (d && typeof d === 'object') {
    if ('available_qty' in d) {
      const name = nameOf?.(d.product_id) ?? `상품 #${d.product_id}`;
      return `${err.message} ${name}: 현재고 ${fmtNum(d.available_qty)}, 요청 ${fmtNum(d.requested_qty)}`;
    }
    if ('remaining_qty' in d) {
      const name = poItemName?.(d.po_item_id) ?? `발주품목 #${d.po_item_id}`;
      return `${err.message} ${name}: 잔량 ${fmtNum(d.remaining_qty)}, 요청 ${fmtNum(d.requested_qty)}`;
    }
  }
  if (typeof d === 'string' && err.status === 409) return `${err.message} (${d})`;
  return err.message;
}
