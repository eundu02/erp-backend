// 관리자 판단 사후 평가 (DB 접근 없는 순수 함수).
//
// 추천 계산일부터 보호기간이 끝날 때까지의 실제 확정 판매량(실제 수요)을 알았다면 발주했어야 할 수량을
// '사후 적정 발주량'으로 두고, 시스템 추천 수량과 관리자 최종 수량 중 어느 쪽이 더 가까웠는지 판정한다.
//
//   사후 적정 발주량 Q* = max(0, ⌈실제 수요 + 안전재고 − 계산 당시 재고 위치⌉)
//   시스템 오차 = |시스템 추천 수량 − Q*|,  관리자 오차 = |관리자 최종 수량 − Q*|
//
// Q*에는 최소주문량·주문배수를 적용하지 않는다(수요 자체에 대한 정확도를 보기 위함).

/**
 * @param {object} d
 * @param {boolean} d.evaluable          보호기간이 모두 지났는지 (종료일 < 오늘)
 * @param {number|null} d.actualDemand   보호기간 동안의 실제 확정 판매량 (evaluable일 때만)
 * @param {number} d.safetyStock         계산 당시 안전재고
 * @param {number} d.inventoryPosition   계산 당시 재고 위치 (현재고 + 미입고)
 * @param {number} d.systemQty           판단 시점의 시스템 추천 수량 (선택 전략 기준)
 * @param {number} d.finalQty            관리자 최종 수량
 */
function evaluateDecision({ evaluable, actualDemand, safetyStock, inventoryPosition, systemQty, finalQty }) {
  const modified = finalQty !== systemQty;
  if (!evaluable) return { status: 'pending', modified };

  const hindsightQty = Math.max(0, Math.ceil(actualDemand + safetyStock - inventoryPosition));
  const systemError = Math.abs(systemQty - hindsightQty);
  const managerError = Math.abs(finalQty - hindsightQty);
  let closer = 'same'; // 수정하지 않은 판단 (시스템 = 관리자)
  if (modified) closer = managerError < systemError ? 'manager' : systemError < managerError ? 'system' : 'tie';

  return {
    status: 'evaluated', modified, actual_demand: actualDemand, hindsight_qty: hindsightQty,
    system_error: systemError, manager_error: managerError, closer,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

// 평가된 판단들의 요약 (수정한 판단에서 누가 더 가까웠는지, 평균 절대 오차)
function summarize(items) {
  const evaluated = items.filter((i) => i.evaluation.status === 'evaluated');
  const modified = evaluated.filter((i) => i.evaluation.modified);
  const mean = (arr, key) => (arr.length ? round2(arr.reduce((a, i) => a + i.evaluation[key], 0) / arr.length) : null);
  return {
    total: items.length,
    evaluated: evaluated.length,
    pending: items.length - evaluated.length,
    modified_evaluated: modified.length,
    manager_closer: modified.filter((i) => i.evaluation.closer === 'manager').length,
    system_closer: modified.filter((i) => i.evaluation.closer === 'system').length,
    tie: modified.filter((i) => i.evaluation.closer === 'tie').length,
    // 수정한 판단만 놓고 본 평균 절대 오차 (같은 판단에서 시스템 vs 관리자)
    mae_system_on_modified: mean(modified, 'system_error'),
    mae_manager_on_modified: mean(modified, 'manager_error'),
    // 평가된 전체 판단에서의 평균 절대 오차 (수정 안 한 판단은 둘이 같음)
    mae_system_all: mean(evaluated, 'system_error'),
    mae_final_all: mean(evaluated, 'manager_error'),
  };
}

module.exports = { evaluateDecision, summarize };
