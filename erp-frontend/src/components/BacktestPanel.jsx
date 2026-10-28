import { useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Flex, InputNumber, Table, Tag, Tooltip, Typography } from 'antd';
import { ExperimentOutlined, InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { fmtNum } from '../utils';

const fmtPct = (v) => (v === null || v === undefined ? '-' : `${Number(v).toFixed(1)}%`);
const fmtDec = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }));

// 백테스트 탭: 과거 기준일마다 그 시점까지의 정보만으로 수요 분위수를 다시 계산해 실제 수요와 비교 (읽기 전용)
export default function BacktestPanel() {
  const { message } = App.useApp();
  const [range, setRange] = useState([dayjs().subtract(35, 'day'), dayjs().subtract(8, 'day')]);
  const [step, setStep] = useState(3);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true);
    try {
      setResult(await api.post('/recommendations/backtest', {
        from: range[0].format('YYYY-MM-DD'),
        to: range[1].format('YYYY-MM-DD'),
        step_days: step,
      }));
    } catch (err) {
      message.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const summaryRows = result ? ['p50', 'p70', 'p90'].map((k) => ({ key: k, strategy: k.toUpperCase(), ...result.summary[k] })) : [];
  const summaryColumns = [
    { title: '전략', dataIndex: 'strategy', width: 80, render: (v) => <Tag color="geekblue">{v}</Tag> },
    { title: '사례 수', dataIndex: 'cases', width: 80, align: 'right', render: fmtNum },
    {
      title: <Tooltip title="실제 수요 ≤ 예측 분위수인 비율. 명목값(50·70·90%)에 가까울수록 예측이 잘 보정된 것">분위수 적중률 <InfoCircleOutlined style={{ color: '#94a3b8' }} /></Tooltip>,
      key: 'demand', width: 160, align: 'right',
      render: (_, r) => <>{fmtPct(r.demand_coverage_pct)} <Typography.Text type="secondary" style={{ fontSize: 12 }}>(명목 {r.nominal_pct}%)</Typography.Text></>,
    },
    {
      title: <Tooltip title="실제 수요 ≤ 목표재고(예측 + 안전재고)인 비율. 목표재고까지 채웠다면 품절이 없었을 비율(서비스 수준)">목표재고 충족률 <InfoCircleOutlined style={{ color: '#94a3b8' }} /></Tooltip>,
      dataIndex: 'target_coverage_pct', width: 140, align: 'right', render: (v) => <b>{fmtPct(v)}</b>,
    },
    { title: '평균 부족량', dataIndex: 'avg_shortage', width: 110, align: 'right', render: fmtDec },
    { title: '평균 과잉량', dataIndex: 'avg_excess', width: 110, align: 'right', render: fmtDec },
    { title: '수요 예측 평균 절대 오차', dataIndex: 'mae_demand', width: 170, align: 'right', render: fmtDec },
  ];

  const caseColumns = [
    { title: '기준일', dataIndex: 'as_of', width: 105 },
    { title: '상품', key: 'p', render: (_, c) => <span style={{ whiteSpace: 'nowrap' }}>{c.product_name}</span> },
    {
      title: '납기·보호기간', key: 'lt', width: 150,
      render: (_, c) => <>{c.lead_time_source === 'actual_supplier_avg' ? '실적' : '계획'} {c.applied_lead_time_days}일 · {c.protection_days}일</>,
    },
    { title: '이력', key: 'h', width: 90, render: (_, c) => (c.insufficient_history ? <Tag color="warning">부족 {c.available_days}일</Tag> : `${c.available_days}일`) },
    { title: 'P50', key: 'p50', width: 70, align: 'right', render: (_, c) => fmtDec(c.strategies.p50.demand) },
    { title: 'P70', key: 'p70', width: 70, align: 'right', render: (_, c) => fmtDec(c.strategies.p70.demand) },
    { title: 'P90', key: 'p90', width: 70, align: 'right', render: (_, c) => fmtDec(c.strategies.p90.demand) },
    { title: '실제 수요', dataIndex: 'actual_demand', width: 90, align: 'right', render: (v) => <b>{fmtNum(v)}</b> },
    {
      title: '목표재고 충족 (P50·P70·P90)', key: 'cov', width: 210,
      render: (_, c) => ['p50', 'p70', 'p90'].map((k) => (
        <Tag key={k} color={c.strategies[k].target_covered ? 'green' : 'red'}>{k.toUpperCase()} {c.strategies[k].target_covered ? '충족' : `부족 ${fmtDec(c.strategies[k].shortage)}`}</Tag>
      )),
    },
  ];

  return (
    <>
      <Card style={{ marginBottom: 16 }}>
        <Flex gap={16} align="center" wrap>
          <span>기준일 범위</span>
          <DatePicker.RangePicker value={range} onChange={(v) => v && setRange(v)} allowClear={false} disabledDate={(d) => d.isAfter(dayjs())} />
          <span>간격</span>
          <InputNumber min={1} max={90} value={step} onChange={(v) => setStep(v ?? 1)} suffix="일" style={{ width: 100 }} />
          <Button type="primary" icon={<ExperimentOutlined />} loading={running} onClick={run}>백테스트 실행</Button>
        </Flex>
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          각 기준일마다 그 전날까지의 확정 판매와 그 이전 입고 실적만으로 수요 분위수를 다시 계산하고(미래 정보 미사용),
          기준일부터 보호기간 동안의 실제 확정 판매량과 비교합니다. 보호기간이 아직 끝나지 않은 기준일은 제외합니다. 결과는 저장되지 않습니다.
        </Typography.Text>
      </Card>

      {result && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={`기준일 ${result.params.from} ~ ${result.params.to} (${result.params.step_days}일 간격, ${result.params.dates}개) × 상품 ${result.params.products}개 → 평가 사례 ${result.cases.length}건`}
            description={`제외: 보호기간 미경과 ${result.skipped.not_evaluable}건, 판매 이력 없음 ${result.skipped.no_history}건`}
          />
          <Card title="전략별 백테스트 결과" style={{ marginBottom: 16 }}>
            <Table rowKey="key" columns={summaryColumns} dataSource={summaryRows} pagination={false} size="middle" scroll={{ x: 'max-content' }} />
          </Card>
          <Card title={`사례별 결과 (${result.cases.length}건)`}>
            <Table
              rowKey={(c) => `${c.product_id}-${c.as_of}`}
              columns={caseColumns}
              dataSource={result.cases}
              size="small"
              pagination={{ pageSize: 15 }}
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </>
      )}
    </>
  );
}
