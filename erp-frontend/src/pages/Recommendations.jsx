import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, App, Badge, Button, Card, Col, Descriptions, Drawer, Empty, Flex, Input, InputNumber, Modal, Row,
  Space, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import {
  CalculatorOutlined, CheckCircleFilled, CloseOutlined, ExclamationCircleFilled, FileAddOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import { DecisionEvaluationPanel, PreviousDecisions } from '../components/DecisionReview';
import BacktestPanel from '../components/BacktestPanel';
import { CURRENT_USER } from '../config';
import { fmtDateTime, fmtNum } from '../utils';

const STRATEGIES = ['P50', 'P70', 'P90'];
const STRATEGY_DESC = { P50: '중앙값 수요 — 재고 최소화', P70: '균형', P90: '보수적 — 품절 위험 최소화' };
const qtyOf = (rec, s) => rec[`recommended_qty_${s.toLowerCase()}`];
const demandOf = (rec, s) => rec[`demand_${s.toLowerCase()}`];
const fmtDec = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));

// ── 계산 근거 태그 ─────────────────────────────────────────────
function LeadTimeTag({ lt }) {
  if (!lt) return null;
  if (lt.source === 'actual_supplier_avg') {
    return (
      <Tooltip title={`공급업체 확정 입고 ${lt.actual_samples}건의 평균 실제 납기 ${fmtDec(lt.actual_avg_days)}일 (반올림 적용, 계획 납기 ${lt.planned_days}일)`}>
        <Tag color="blue">실적 납기 {lt.applied_days}일</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>n={lt.actual_samples}</Typography.Text>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={`공급업체 실적 표본 ${lt.actual_samples}건 < ${lt.min_samples_required}건 → 계획 납기 사용`}>
      <Tag>계획 납기 {lt.applied_days}일</Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>n={lt.actual_samples}</Typography.Text>
    </Tooltip>
  );
}

function HistoryTag({ detail }) {
  if (!detail) return null;
  return detail.insufficient_history ? (
    <Tooltip title={`사용 가능 ${detail.available_days}일 < 필요 ${detail.required_days}일 (보호기간×2, 최소 14일)`}>
      <Tag color="warning" icon={<ExclamationCircleFilled />}>이력 부족 {detail.available_days}/{detail.required_days}일</Tag>
    </Tooltip>
  ) : (
    <Tag color="success" icon={<CheckCircleFilled />}>이력 충분 {detail.available_days}일</Tag>
  );
}

function DecisionTag({ rec, onPo }) {
  if (!rec.decision_id) return <Badge status="default" text="미판단" />;
  if (rec.decision_status === 'confirmed') {
    return <Tag color="green">확정 · {rec.selected_strategy === 'custom' ? '직접' : rec.selected_strategy} {fmtNum(rec.final_qty)}</Tag>;
  }
  if (rec.decision_status === 'converted_to_po') {
    return (
      <Tag color="geekblue" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); onPo(); }}>
        발주 전환 · {fmtNum(rec.final_qty)} ↗
      </Tag>
    );
  }
  if (rec.decision_status === 'rejected') return <Tag color="default">반려</Tag>;
  return <Tag>{rec.decision_status}</Tag>;
}

// ── 최근 일별 수요 막대 (단일 시리즈, hover 툴팁) ─────────────────
function DailyDemandBars({ detail }) {
  const values = detail.daily_demand;
  const max = Math.max(1, ...values);
  const H = 72;
  return (
    <div>
      <Flex align="flex-end" style={{ height: H, borderBottom: '1px solid #e5e7eb' }}>
        {values.map((v, i) => {
          const date = dayjs(detail.available_start).add(i, 'day');
          return (
            <Tooltip key={i} title={`${date.format('M/D (dd)')} · ${fmtNum(v)}개`}>
              <Flex justify="center" align="flex-end" style={{ flex: 1, height: '100%' }}>
                <div style={{ width: 'min(14px, 70%)', height: `${(v / max) * 100}%`, background: '#2a78d6', borderRadius: '3px 3px 0 0' }} />
              </Flex>
            </Tooltip>
          );
        })}
      </Flex>
      <Flex justify="space-between" style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
        <span>{dayjs(detail.available_start).format('M/D')}</span>
        <span>일평균 {fmtDec(detail.mean_daily_demand)}개 · 최대 {fmtNum(max)}개</span>
        <span>{dayjs(detail.history_window.end).format('M/D')}</span>
      </Flex>
    </div>
  );
}

// ── 전략 비교 카드 ───────────────────────────────────────────
function StrategyCard({ rec, strategy, selected, isDefault, onSelect, disabled }) {
  const st = rec.calculation_detail.strategies[strategy.toLowerCase()];
  return (
    <Card
      size="small"
      hoverable={!disabled}
      onClick={disabled ? undefined : onSelect}
      style={{
        borderColor: selected ? '#1d4ed8' : undefined,
        boxShadow: selected ? '0 0 0 1px #1d4ed8' : undefined,
        cursor: disabled ? 'default' : 'pointer',
        height: '100%',
      }}
      title={(
        <Flex justify="space-between" align="center">
          <span>{strategy}</span>
          {isDefault && <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>기본 전략</Tag>}
        </Flex>
      )}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{STRATEGY_DESC[strategy]}</Typography.Text>
      <div style={{ fontSize: 30, fontWeight: 600, margin: '8px 0 4px' }}>
        {fmtNum(st.recommended_qty)}
        <span style={{ fontSize: 14, fontWeight: 400, color: '#6b7280' }}> 개 발주</span>
      </div>
      <Descriptions size="small" column={1} colon={false} styles={{ label: { color: '#6b7280', width: 110 } }}>
        <Descriptions.Item label="보호기간 수요">{fmtDec(demandOf(rec, strategy))}</Descriptions.Item>
        <Descriptions.Item label="목표재고">{fmtDec(st.target_stock)}</Descriptions.Item>
        <Descriptions.Item label="목표 − 재고위치">{fmtDec(st.raw_qty)}</Descriptions.Item>
        <Descriptions.Item label="MOQ·배수 반영">{st.raw_qty > 0 ? `${fmtNum(st.after_moq)} → ${fmtNum(st.recommended_qty)}` : '발주 불필요'}</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}

// ── 상세 + 판단 입력 Drawer ───────────────────────────────────
function RecommendationDrawer({ rec, onClose, onDecided }) {
  const { message } = App.useApp();
  const [strategy, setStrategy] = useState(rec?.default_strategy ?? 'P50');
  const [finalQty, setFinalQty] = useState(rec ? qtyOf(rec, rec.default_strategy) : 0);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!rec) return null;
  const d = rec.calculation_detail;
  const lt = d.lead_time;
  const decided = !!rec.decision_id && rec.decision_status !== 'rejected';
  const systemQty = strategy === 'custom' ? qtyOf(rec, rec.default_strategy) : qtyOf(rec, strategy);
  const modified = finalQty !== systemQty;

  const pick = (s) => {
    setStrategy(s);
    if (s !== 'custom') setFinalQty(qtyOf(rec, s));
  };

  const submit = async (status) => {
    if (status === 'confirmed' && (finalQty === null || finalQty === undefined)) {
      message.warning('최종 발주 수량을 입력하세요.');
      return;
    }
    if (status === 'confirmed' && modified && !reason.trim()) {
      message.warning('추천 수량과 다르게 입력했다면 수정 사유를 입력해야 합니다.');
      return;
    }
    setSaving(true);
    try {
      await api.post('/decisions', {
        recommendation_id: rec.recommendation_id,
        selected_strategy: strategy,
        final_qty: status === 'confirmed' ? finalQty : undefined,
        modification_reason: reason.trim() || undefined,
        decision_status: status,
        decided_by: CURRENT_USER.user_id,
      });
      message.success(status === 'confirmed' ? '판단을 확정했습니다. 목록에서 선택해 발주서로 전환할 수 있습니다.' : '추천을 반려했습니다.');
      onDecided();
    } catch (err) {
      message.error(err.message, 6);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={`${rec.product_name} (${rec.sku}) — 발주 추천`}
      open
      onClose={onClose}
      width={880}
      extra={<Typography.Text type="secondary">계산 {fmtDateTime(rec.calculated_at)}</Typography.Text>}
    >
      {d.insufficient_history && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`판매 이력이 부족합니다 (사용 가능 ${d.available_days}일 < 필요 ${d.required_days}일). 추천값의 신뢰도가 낮으니 판단 시 참고하세요.`}
        />
      )}

      <Typography.Title level={5} style={{ marginTop: 0 }}>전략별 추천 비교</Typography.Title>
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {STRATEGIES.map((s) => (
          <Col span={8} key={s}>
            <StrategyCard
              rec={rec}
              strategy={s}
              selected={!decided && strategy === s}
              isDefault={rec.default_strategy === s}
              onSelect={() => pick(s)}
              disabled={decided}
            />
          </Col>
        ))}
      </Row>

      <Typography.Title level={5}>계산 근거</Typography.Title>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="적용 납기" span={2}>
          <Space wrap>
            <LeadTimeTag lt={lt} />
            {lt.source === 'actual_supplier_avg'
              ? <span>공급업체 확정 입고 {lt.actual_samples}건 평균 {fmtDec(lt.actual_avg_days)}일 (범위 {lt.actual_min_days}~{lt.actual_max_days}일) → 반올림 {lt.applied_days}일 · 계획 납기 {lt.planned_days}일</span>
              : <span>실적 표본 {lt.actual_samples}건 &lt; {lt.min_samples_required}건 → 계획 납기 {lt.planned_days}일 사용{lt.actual_avg_days !== null && ` (참고: 실적 평균 ${fmtDec(lt.actual_avg_days)}일)`}</span>}
            {lt.excluded_samples > 0 && <Tag color="error">비정상 표본 {lt.excluded_samples}건 제외</Tag>}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="보호기간">{d.protection_period_days}일 = 납기 {rec.applied_lead_time_days} + 검토주기 {rec.review_period_days_snapshot}</Descriptions.Item>
        <Descriptions.Item label="판매 이력"><HistoryTag detail={d} /></Descriptions.Item>
        <Descriptions.Item label="재고 위치">{fmtNum(d.inventory_position)} = 현재고 {fmtNum(rec.on_hand_qty_snapshot)} + 미입고 {fmtNum(rec.outstanding_po_qty_snapshot)}</Descriptions.Item>
        <Descriptions.Item label="안전재고">{fmtNum(rec.safety_stock_qty_snapshot)}</Descriptions.Item>
        <Descriptions.Item label="최소주문량 · 배수">{fmtNum(d.minimum_order_qty)} · ×{fmtNum(d.order_multiple)}</Descriptions.Item>
        <Descriptions.Item label="수요 예측">
          <Tooltip title={`seed ${d.bootstrap.seed} · ${d.bootstrap.quantile_method}`}>
            부트스트랩 {fmtNum(d.bootstrap.iterations)}회 <InfoCircleOutlined style={{ color: '#94a3b8' }} />
          </Tooltip>
        </Descriptions.Item>
      </Descriptions>
      <Card size="small" title={`일별 확정 판매 (${dayjs(d.available_start).format('M/D')} ~ ${dayjs(d.history_window.end).format('M/D')}, ${d.available_days}일)`} style={{ marginBottom: 20 }}>
        <DailyDemandBars detail={d} />
      </Card>

      <PreviousDecisions productId={rec.product_id} excludeRecommendationId={rec.recommendation_id} />

      <Typography.Title level={5}>관리자 판단</Typography.Title>
      {decided ? (
        <Alert
          type={rec.decision_status === 'converted_to_po' ? 'info' : 'success'}
          showIcon
          message={rec.decision_status === 'converted_to_po'
            ? `발주서로 전환됨 — ${rec.selected_strategy} 기준 최종 ${fmtNum(rec.final_qty)}개 (발주서 #${rec.purchase_order_id})`
            : `판단 확정 — ${rec.selected_strategy === 'custom' ? '직접 입력' : rec.selected_strategy} 기준 최종 ${fmtNum(rec.final_qty)}개. 목록에서 선택해 발주서로 전환하세요.`}
        />
      ) : (
        <Card size="small">
          <Flex gap={16} wrap align="flex-start">
            <div>
              <div style={{ marginBottom: 6 }}><Typography.Text type="secondary">선택 전략</Typography.Text></div>
              <Space.Compact>
                {[...STRATEGIES, 'custom'].map((s) => (
                  <Button key={s} type={strategy === s ? 'primary' : 'default'} onClick={() => pick(s)}>
                    {s === 'custom' ? '직접 입력' : s}
                  </Button>
                ))}
              </Space.Compact>
            </div>
            <div>
              <div style={{ marginBottom: 6 }}><Typography.Text type="secondary">최종 발주 수량</Typography.Text></div>
              <InputNumber min={0} value={finalQty} onChange={setFinalQty} style={{ width: 140 }} suffix="개" />
            </div>
            <div style={{ paddingTop: 30 }}>
              <Typography.Text type="secondary">
                시스템 추천 {fmtNum(systemQty)}개{strategy === 'custom' && ` (기본 전략 ${rec.default_strategy} 기준)`}
                {modified && <Typography.Text type="warning"> · 추천과 {finalQty - systemQty > 0 ? '+' : ''}{fmtNum(finalQty - systemQty)}</Typography.Text>}
              </Typography.Text>
            </div>
          </Flex>
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 6 }}>
              <Typography.Text type={modified ? undefined : 'secondary'}>
                {modified && <span style={{ color: '#dc2626' }}>* </span>}수정 사유 {modified ? '(추천과 다르므로 필수)' : '(선택)'}
              </Typography.Text>
            </div>
            <Input.TextArea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 다음 주 프로모션으로 수요 증가 예상, 공급업체 휴무로 선발주 등"
              status={modified && !reason.trim() ? 'warning' : undefined}
              maxLength={500}
              showCount
            />
          </div>
          <Flex justify="flex-end" gap={8} style={{ marginTop: 16 }}>
            <Button icon={<CloseOutlined />} loading={saving} onClick={() => submit('rejected')}>반려</Button>
            <Button type="primary" icon={<CheckCircleFilled />} loading={saving} onClick={() => submit('confirmed')}>판단 확정</Button>
          </Flex>
        </Card>
      )}
    </Drawer>
  );
}

// 직전 계산의 예측 불가·제외 안내는 서버에 저장되지 않으므로 브라우저(localStorage)에 보관해
// 새로고침이나 메뉴 이동 뒤에도 보이게 한다. 저장소를 쓸 수 없는 환경이면 조용히 무시한다.
const CALC_KEY = 'erp.recommendations.lastCalc';
function loadLastCalc() {
  try { return JSON.parse(localStorage.getItem(CALC_KEY)); } catch { return null; }
}
function saveLastCalc(v) {
  try { if (v) localStorage.setItem(CALC_KEY, JSON.stringify(v)); else localStorage.removeItem(CALC_KEY); } catch { /* 무시 */ }
}

// ── 메인 화면 ────────────────────────────────────────────────
export default function Recommendations() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const { data = [], loading, reload } = useApi(() => api.get('/recommendations', { latest: true }), [], []);
  const [calcResult, setCalcResultState] = useState(loadLastCalc);
  const setCalcResult = (v) => { setCalcResultState(v); saveLastCalc(v); };
  const [calculating, setCalculating] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [tab, setTab] = useState('list');
  const openRec = data.find((r) => r.recommendation_id === openId) ?? null;

  const calculate = async () => {
    setCalculating(true);
    try {
      const result = await api.post('/recommendations/calculate', {});
      setCalcResult({
        at: new Date().toISOString(),
        created_count: result.created.length,
        not_forecastable: result.not_forecastable,
        skipped: result.skipped,
      });
      setSelectedKeys([]);
      message.success(`${result.created.length}개 상품의 발주 추천을 계산했습니다.`);
      reload();
    } catch (err) {
      message.error(err.message);
    } finally {
      setCalculating(false);
    }
  };

  const selectedRecs = data.filter((r) => selectedKeys.includes(r.recommendation_id));
  const convert = () => {
    const groups = {};
    selectedRecs.forEach((r) => { (groups[r.supplier_name] ??= []).push(r); });
    modal.confirm({
      title: `선택한 ${selectedRecs.length}건을 발주서로 전환할까요?`,
      width: 520,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>공급업체별로 발주서(작성중)가 {Object.keys(groups).length}장 생성됩니다. 재고는 바뀌지 않으며, 발주 관리에서 확정하세요.</p>
          {Object.entries(groups).map(([name, rs]) => (
            <div key={name} style={{ marginBottom: 6 }}>
              <Typography.Text strong>{name}</Typography.Text>
              <div style={{ color: '#475569' }}>{rs.map((r) => `${r.product_name} ${fmtNum(r.final_qty)}개`).join(', ')}</div>
            </div>
          ))}
        </div>
      ),
      okText: '발주서 생성',
      cancelText: '취소',
      onOk: async () => {
        try {
          const res = await api.post('/decisions/convert-to-po', {
            decision_ids: selectedRecs.map((r) => r.decision_id),
            created_by: CURRENT_USER.user_id,
          });
          setSelectedKeys([]);
          reload();
          modal.success({
            title: `발주서 ${res.purchase_orders.length}장을 생성했습니다.`,
            content: res.purchase_orders.map((p) => <div key={p.purchase_order_id}>{p.po_no} · {p.supplier_name} · {p.items.length}개 품목</div>),
            okText: '발주 관리로 이동',
            onOk: () => navigate('/purchase-orders'),
          });
        } catch (err) {
          modal.error({
            title: err.message,
            content: Array.isArray(err.detail) ? <ul style={{ paddingLeft: 18 }}>{err.detail.map((t) => <li key={t}>{t}</li>)}</ul> : undefined,
          });
        }
      },
    });
  };

  const counts = useMemo(() => ({
    pending: data.filter((r) => !r.decision_id || r.decision_status === 'rejected').length,
    confirmed: data.filter((r) => r.decision_status === 'confirmed').length,
    actualLt: data.filter((r) => r.calculation_detail?.lead_time?.source === 'actual_supplier_avg').length,
    insufficient: data.filter((r) => r.calculation_detail?.insufficient_history).length,
  }), [data]);

  const strategyColumn = (s) => ({
    title: s,
    key: s,
    width: 100,
    align: 'center',
    onCell: (r) => ({ style: r.default_strategy === s ? { background: '#eff6ff' } : undefined }),
    render: (_, r) => (
      <Tooltip title={`보호기간 수요 ${fmtDec(demandOf(r, s))} + 안전재고 ${fmtNum(r.safety_stock_qty_snapshot)} − 재고 위치 ${fmtNum(r.calculation_detail.inventory_position)}`}>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{fmtNum(qtyOf(r, s))}</div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>수요 {fmtDec(demandOf(r, s))}</div>
      </Tooltip>
    ),
  });

  const columns = [
    {
      title: '상품', key: 'product', width: 180,
      render: (_, r) => (
        <>
          <div style={{ whiteSpace: 'nowrap' }}>{r.product_name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.sku} · {r.supplier_name}</Typography.Text>
        </>
      ),
    },
    {
      title: '재고 위치', key: 'pos', width: 110, align: 'right',
      render: (_, r) => (
        <Tooltip title={`현재고 ${fmtNum(r.on_hand_qty_snapshot)} + 미입고 ${fmtNum(r.outstanding_po_qty_snapshot)}`}>
          <div>{fmtNum(r.calculation_detail.inventory_position)}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>안전 {fmtNum(r.safety_stock_qty_snapshot)}</Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: '적용 납기 · 보호기간', key: 'lt', width: 160,
      render: (_, r) => (
        <>
          <LeadTimeTag lt={r.calculation_detail.lead_time} />
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>보호기간 {r.calculation_detail.protection_period_days}일</div>
        </>
      ),
    },
    {
      title: '판매 이력', key: 'hist', width: 150,
      render: (_, r) => <HistoryTag detail={r.calculation_detail} />,
    },
    {
      title: <Tooltip title="파란 배경 = 상품의 기본 전략">권장 발주량 <InfoCircleOutlined style={{ color: '#94a3b8' }} /></Tooltip>,
      children: STRATEGIES.map(strategyColumn),
    },
    {
      title: '판단', key: 'decision', width: 150,
      render: (_, r) => (!r.decision_id || r.decision_status === 'rejected' ? (
        <Space size={6}>
          {r.decision_status === 'rejected' && <Tag>반려</Tag>}
          <Button size="small" type="primary" onClick={(e) => { e.stopPropagation(); setOpenId(r.recommendation_id); }}>판단</Button>
        </Space>
      ) : <DecisionTag rec={r} onPo={() => navigate('/purchase-orders')} />),
    },
  ];

  return (
    <>
      <PageHeader
        title="발주 추천"
        description="최근 확정 판매(28일, 보호기간이 길면 그 2배)의 부트스트랩 분위수(P50/P70/P90)와 안전재고로 권장 발주량을 계산하고, 관리자 판단과 그 사후 평가를 기록합니다."
        extra={[
          <Button key="calc" icon={<CalculatorOutlined />} loading={calculating} onClick={calculate}>추천 계산 실행</Button>,
          <Button key="conv" type="primary" icon={<FileAddOutlined />} disabled={!selectedRecs.length} onClick={convert}>
            선택 발주 전환{selectedRecs.length ? ` (${selectedRecs.length})` : ''}
          </Button>,
        ]}
      />

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'list',
            label: '추천 목록',
            children: (
              <>
              {calcResult && (calcResult.not_forecastable.length > 0 || calcResult.skipped.length > 0) && (
                <Alert
                  type="info"
                  showIcon
                  closable
                  onClose={() => setCalcResult(null)}
                  style={{ marginBottom: 16 }}
                  message={`직전 계산(${fmtDateTime(calcResult.at)}): 추천 ${calcResult.created_count}건 저장, 예측 불가 ${calcResult.not_forecastable.length}건, 제외 ${calcResult.skipped.length}건`}
                  description={(
                    <Space direction="vertical" size={4}>
                      {calcResult.not_forecastable.map((x) => (
                        <div key={x.product_id}>
                          <Tag color="error">예측 불가</Tag>{x.product_name} ({x.sku}) — {x.reason}. 안전재고 <b>{fmtNum(x.safety_stock_qty)}</b>, 현재고 {fmtNum(x.on_hand_qty)}
                        </div>
                      ))}
                      {calcResult.skipped.map((x) => (
                        <div key={x.product_id}><Tag>제외</Tag>{x.product_name} ({x.sku}) — {x.reason}</div>
                      ))}
                    </Space>
                  )}
                />
              )}
        
              <Row gutter={16} style={{ marginBottom: 16 }}>
                {[
                  ['판단 대기', counts.pending, '건'],
                  ['판단 확정 (전환 대기)', counts.confirmed, '건'],
                  ['실적 납기 적용', counts.actualLt, `/ ${data.length}건`],
                  ['이력 부족', counts.insufficient, `/ ${data.length}건`],
                ].map(([label, v, suffix]) => (
                  <Col xs={12} lg={6} key={label}>
                    <Card size="small">
                      <Typography.Text type="secondary">{label}</Typography.Text>
                      <div style={{ fontSize: 24, fontWeight: 600 }}>{v} <span style={{ fontSize: 14, fontWeight: 400, color: '#6b7280' }}>{suffix}</span></div>
                    </Card>
                  </Col>
                ))}
              </Row>
        
              <Card>
                {!loading && data.length === 0 ? (
                  <Empty description="아직 계산된 추천이 없습니다. [추천 계산 실행]을 눌러주세요." />
                ) : (
                  <Table
                    rowKey="recommendation_id"
                    columns={columns}
                    dataSource={data}
                    loading={loading}
                    size="middle"
                    bordered
                    pagination={false}
                    scroll={{ x: 'max-content' }}
                    rowClassName="clickable-row"
                    onRow={(r) => ({ onClick: () => setOpenId(r.recommendation_id) })}
                    rowSelection={{
                      selectedRowKeys: selectedKeys,
                      onChange: setSelectedKeys,
                      getCheckboxProps: (r) => ({ disabled: r.decision_status !== 'confirmed' || r.final_qty <= 0, onClick: (e) => e.stopPropagation() }),
                      columnTitle: <Tooltip title="판단 확정 건만 발주 전환 가능">전환</Tooltip>,
                    }}
                  />
                )}
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
                  상품별 최신 추천만 표시됩니다. 판단 확정 → 체크 → [선택 발주 전환] 순서로 진행하면 공급업체별 발주서(작성중)가 생성됩니다.
                </Typography.Text>
              </Card>
              </>
            ),
          },
          { key: 'evaluation', label: '판단 사후 평가', children: <DecisionEvaluationPanel /> },
          { key: 'backtest', label: '백테스트', children: <BacktestPanel /> },
        ]}
      />

      {openRec && (
        <RecommendationDrawer
          key={openRec.recommendation_id}
          rec={openRec}
          onClose={() => setOpenId(null)}
          onDecided={() => { setOpenId(null); reload(); }}
        />
      )}
    </>
  );
}
