import { Card, Col, Empty, List, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import { fmtDate, fmtNum } from '../utils';

const fmtSigned = (n) => `${n > 0 ? '+' : ''}${fmtNum(n)}`;
const strategyLabel = (s) => (s === 'custom' ? '직접 입력' : s);

// 사후 평가 결과 태그: 보호기간이 끝난 판단만 판정한다.
export function EvaluationTag({ decision }) {
  const ev = decision.evaluation;
  if (ev.status === 'pending') {
    return (
      <Tooltip title={`보호기간(${fmtDate(decision.start_date)} ~ ${fmtDate(decision.end_date)})이 끝나면 실제 판매량으로 평가합니다.`}>
        <Tag icon={<ClockCircleOutlined />}>평가 대기 · {decision.days_until_evaluable}일 후</Tag>
      </Tooltip>
    );
  }
  const map = {
    manager: ['geekblue', '관리자 수정이 더 정확'],
    system: ['green', '시스템 추천이 더 정확'],
    tie: ['default', '오차 동일'],
    same: ['default', '추천 그대로 수용'],
  };
  const [color, label] = map[ev.closer];
  return <Tag color={color}>{label}</Tag>;
}

function EvaluationDetail({ decision }) {
  const ev = decision.evaluation;
  if (ev.status !== 'evaluated') return null;
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      실제 수요 {fmtNum(ev.actual_demand)} → 사후 적정 발주량 {fmtNum(ev.hindsight_qty)}
      {ev.modified && ` · 오차: 시스템 ${fmtNum(ev.system_error)} / 관리자 ${fmtNum(ev.manager_error)}`}
    </Typography.Text>
  );
}

// 추천 상세의 '이전 판단 이력': 같은 상품의 지난 판단(수정 폭·사유)과 그 결과를 보여 다음 판단에 참고하게 한다.
export function PreviousDecisions({ productId, excludeRecommendationId }) {
  const { data = [], loading } = useApi(
    () => api.get('/decisions', { product_id: productId, exclude_recommendation_id: excludeRecommendationId, limit: 5 }),
    [productId, excludeRecommendationId],
    []
  );

  const evaluatedModified = data.filter((d) => d.evaluation.status === 'evaluated' && d.evaluation.modified);
  const managerBetter = evaluatedModified.filter((d) => d.evaluation.closer === 'manager').length;

  return (
    <Card
      size="small"
      loading={loading}
      style={{ marginBottom: 20 }}
      title={<>이전 판단 이력 <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>최근 {data.length}건</Typography.Text></>}
      extra={evaluatedModified.length > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          수정한 판단 {evaluatedModified.length}건 중 관리자 수정이 더 정확 {managerBetter}건
        </Typography.Text>
      )}
    >
      {data.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="이 상품의 이전 판단이 없습니다." />
      ) : (
        <List
          size="small"
          dataSource={data}
          renderItem={(d) => {
            const delta = d.final_qty - d.system_recommended_qty;
            return (
              <List.Item style={{ display: 'block' }}>
                <Space wrap size={8} style={{ marginBottom: 2 }}>
                  <Typography.Text strong>{fmtDate(d.decided_at)}</Typography.Text>
                  <Tag>{strategyLabel(d.selected_strategy)}</Tag>
                  <span>
                    추천 {fmtNum(d.system_recommended_qty)} → 최종 <b>{fmtNum(d.final_qty)}</b>
                    {delta !== 0 && <Typography.Text type="warning"> ({fmtSigned(delta)})</Typography.Text>}
                  </span>
                  <EvaluationTag decision={d} />
                </Space>
                {d.modification_reason && (
                  <div style={{ fontSize: 13 }}>사유: {d.modification_reason}</div>
                )}
                <EvaluationDetail decision={d} />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}

// '판단 사후 평가' 탭: 관리자가 추천과 다르게 판단한 경우 시스템 추천과 관리자 수정 중 어느 쪽이 실제 수요에 더 가까웠는가.
export function DecisionEvaluationPanel() {
  const { data, loading } = useApi(() => api.get('/decisions/evaluation'), [], { summary: null, items: [] });
  const s = data.summary;

  const tile = (label, value, suffix, hint) => (
    <Col xs={12} lg={6} key={label}>
      <Card size="small" loading={loading}>
        <Typography.Text type="secondary">{label}</Typography.Text>
        <div style={{ fontSize: 24, fontWeight: 600 }}>
          {value ?? '-'} <span style={{ fontSize: 14, fontWeight: 400, color: '#6b7280' }}>{suffix}</span>
        </div>
        {hint && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{hint}</Typography.Text>}
      </Card>
    </Col>
  );

  const columns = [
    {
      title: '상품', key: 'product', width: 170,
      render: (_, d) => <><div style={{ whiteSpace: 'nowrap' }}>{d.product_name}</div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{d.sku}</Typography.Text></>,
    },
    {
      title: <Tooltip title="추천 계산일부터 보호기간이 끝나는 날까지. 이 기간의 확정 판매량이 실제 수요입니다.">보호기간 <InfoCircleOutlined style={{ color: '#94a3b8' }} /></Tooltip>, key: 'period', width: 150,
      render: (_, d) => <span style={{ whiteSpace: 'nowrap' }}>{dayjs(d.start_date).format('MM-DD')} ~ {dayjs(d.end_date).format('MM-DD')} ({d.protection_days}일)</span>,
    },
    { title: '전략', dataIndex: 'selected_strategy', width: 80, render: strategyLabel },
    { title: '시스템 추천', dataIndex: 'system_recommended_qty', width: 95, align: 'right', render: fmtNum },
    {
      title: '관리자 최종', key: 'final', width: 105, align: 'right',
      render: (_, d) => {
        const delta = d.final_qty - d.system_recommended_qty;
        return <>{fmtNum(d.final_qty)}{delta !== 0 && <Typography.Text type="warning" style={{ fontSize: 12 }}> ({fmtSigned(delta)})</Typography.Text>}</>;
      },
    },
    { title: '실제 수요', key: 'actual', width: 85, align: 'right', render: (_, d) => (d.evaluation.status === 'evaluated' ? fmtNum(d.evaluation.actual_demand) : '-') },
    {
      title: <Tooltip title="실제 수요를 알았다면 발주했어야 할 수량 = 실제 수요 + 안전재고 − 계산 당시 재고 위치 (최소주문량·배수 미적용)">사후 적정량 <InfoCircleOutlined style={{ color: '#94a3b8' }} /></Tooltip>,
      key: 'hindsight', width: 110, align: 'right',
      render: (_, d) => (d.evaluation.status === 'evaluated' ? <b>{fmtNum(d.evaluation.hindsight_qty)}</b> : '-'),
    },
    { title: '시스템 오차', key: 'se', width: 90, align: 'right', render: (_, d) => (d.evaluation.status === 'evaluated' ? fmtNum(d.evaluation.system_error) : '-') },
    { title: '관리자 오차', key: 'me', width: 90, align: 'right', render: (_, d) => (d.evaluation.status === 'evaluated' ? fmtNum(d.evaluation.manager_error) : '-') },
    { title: '판정', key: 'closer', width: 160, render: (_, d) => <EvaluationTag decision={d} /> },
    { title: '수정 사유', dataIndex: 'modification_reason', width: 200, render: (v) => v || '-' },
  ];

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {tile('평가 완료 / 대기', s ? `${s.evaluated} / ${s.pending}` : null, '건', '보호기간이 지난 판단만 평가')}
        {tile('추천과 다르게 판단한 건', s?.modified_evaluated, '건', '평가 완료된 판단 중')}
        {tile('관리자 수정이 더 정확', s ? `${s.manager_closer} : ${s.system_closer}` : null, '(관리자 : 시스템)', s?.tie ? `오차 동일 ${s.tie}건` : '수정한 판단 기준')}
        {tile('평균 절대 오차', s?.mae_system_on_modified != null ? `${fmtNum(s.mae_system_on_modified)} / ${fmtNum(s.mae_manager_on_modified)}` : null, '(시스템 / 관리자)', '수정한 판단에서 사후 적정량 대비')}
      </Row>
      <Card>
        <Table
          rowKey="decision_id"
          columns={columns}
          dataSource={data.items}
          loading={loading}
          size="middle"
          pagination={{ pageSize: 20 }}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '아직 판단 이력이 없습니다.' }}
        />
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          사후 적정량 = 보호기간(추천 계산일부터) 동안의 실제 확정 판매량 + 안전재고 − 계산 당시 재고 위치.
          시스템 추천 수량과 관리자 최종 수량 중 사후 적정량에 더 가까운 쪽을 판정합니다. 반려된 판단은 제외합니다.
        </Typography.Text>
      </Card>
    </>
  );
}
