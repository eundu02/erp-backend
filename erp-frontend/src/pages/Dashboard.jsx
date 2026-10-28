import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, Flex, List, Row, Statistic, Table, Tag, Typography } from 'antd';
import {
  ArrowRightOutlined, ExclamationCircleFilled, InboxOutlined, ShopOutlined, ShoppingCartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import MovementTable from '../components/MovementTable';
import DailySalesChart from '../components/DailySalesChart';
import { fmtDate, fmtNum } from '../utils';

export default function Dashboard() {
  const navigate = useNavigate();
  const { data, loading } = useApi(
    () => Promise.all([
      api.get('/inventory', { is_active: true }),
      api.get('/purchase-orders'),
      api.get('/sales', { status: 'confirmed', from: dayjs().subtract(13, 'day').format('YYYY-MM-DD') }),
      api.get('/sales', { status: 'draft' }),
      api.get('/stock-movements', { limit: 8 }),
      api.get('/recommendations', { latest: true }),
    ]).then(([inventory, pos, recentSales, draftSales, movements, recs]) => ({ inventory, pos, recentSales, draftSales, movements, recs })),
    [],
    { inventory: [], pos: [], recentSales: [], draftSales: [], movements: [], recs: [] }
  );

  const kpi = useMemo(() => {
    const openPos = data.pos.filter((p) => ['confirmed', 'partially_received'].includes(p.status));
    return {
      shortage: data.inventory.filter((r) => r.below_safety_stock),
      openPos,
      outstanding: data.inventory.reduce((a, r) => a + r.outstanding_po_qty, 0),
      draftPos: data.pos.filter((p) => p.status === 'draft').length,
      // 상품별 최신 추천 중 아직 판단하지 않은(또는 반려된) 건, 그중 기본 전략 권장량이 있는 건
      recPending: data.recs.filter((r) => !r.decision_id || r.decision_status === 'rejected'),
      recConfirmed: data.recs.filter((r) => r.decision_status === 'confirmed').length,
      overdue: openPos.filter((p) => p.expected_receipt_date && dayjs(p.expected_receipt_date).isBefore(dayjs(), 'day')).length,
    };
  }, [data]);
  const recNeedOrder = kpi.recPending.filter((r) => r[`recommended_qty_${r.default_strategy.toLowerCase()}`] > 0).length;
  const tileCol = { xs: 12, md: 8, lg: { flex: '20%' } };

  const tile = (title, value, suffix, onClick, extra) => (
    <Card hoverable onClick={onClick} loading={loading}>
      <Statistic title={title} value={value} suffix={suffix} />
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </Card>
  );

  return (
    <>
      <PageHeader
        title="대시보드"
        description={`${dayjs().format('YYYY년 M월 D일 dddd')} 기준 재고·발주 현황`}
        extra={[
          <Button key="s" icon={<ShopOutlined />} onClick={() => navigate('/sales')}>판매 등록</Button>,
          <Button key="p" icon={<ShoppingCartOutlined />} onClick={() => navigate('/purchase-orders')}>발주 등록</Button>,
          <Button key="r" type="primary" icon={<InboxOutlined />} onClick={() => navigate('/receipts')}>입고 등록</Button>,
        ]}
      />

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col {...tileCol}>
          {tile('안전재고 미달 품목', kpi.shortage.length, `/ ${data.inventory.length}개`, () => navigate('/inventory'),
            kpi.shortage.length > 0
              ? <Typography.Text type="danger"><ExclamationCircleFilled /> 발주 검토 필요</Typography.Text>
              : <Typography.Text type="secondary">모든 품목 정상</Typography.Text>)}
        </Col>
        <Col {...tileCol}>
          {tile('진행 중 발주서', kpi.openPos.length, '건', () => navigate('/purchase-orders'),
            kpi.overdue > 0
              ? <Typography.Text type="warning"><ExclamationCircleFilled /> 입고 예정일 경과 {kpi.overdue}건</Typography.Text>
              : <Typography.Text type="secondary">작성중 {kpi.draftPos}건</Typography.Text>)}
        </Col>
        <Col {...tileCol}>
          {tile('미입고 발주 수량', fmtNum(kpi.outstanding), '개', () => navigate('/inventory'),
            <Typography.Text type="secondary">확정·부분입고 발주 잔량 합계</Typography.Text>)}
        </Col>
        <Col {...tileCol}>
          {tile('발주 추천 판단 대기', kpi.recPending.length, '건', () => navigate('/recommendations'),
            data.recs.length === 0
              ? <Typography.Text type="secondary">아직 추천 계산 전</Typography.Text>
              : recNeedOrder > 0
                ? <Typography.Text type="warning"><ExclamationCircleFilled /> 발주 권장 {recNeedOrder}건{kpi.recConfirmed > 0 && ` · 전환 대기 ${kpi.recConfirmed}`}</Typography.Text>
                : <Typography.Text type="secondary">{kpi.recConfirmed > 0 ? `발주 전환 대기 ${kpi.recConfirmed}건` : '판단할 추천 없음'}</Typography.Text>)}
        </Col>
        <Col {...tileCol}>
          {tile('미확정 판매전표', data.draftSales.length, '건', () => navigate('/sales'),
            <Typography.Text type="secondary">확정 전에는 재고 미차감</Typography.Text>)}
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} xl={14}>
          <Card title="일별 판매 수량" loading={loading} style={{ height: '100%' }}>
            <DailySalesChart sales={data.recentSales} />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            title={<><ExclamationCircleFilled style={{ color: '#dc2626' }} /> 안전재고 미달 품목</>}
            extra={<Button type="link" onClick={() => navigate('/inventory')}>전체 <ArrowRightOutlined /></Button>}
            loading={loading}
            style={{ height: '100%' }}
          >
            {kpi.shortage.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="안전재고 미달 품목이 없습니다." />
            ) : (
              <Table
                rowKey="product_id"
                size="small"
                pagination={false}
                scroll={{ x: 'max-content', y: 220 }}
                dataSource={[...kpi.shortage].sort((a, b) => a.on_hand_qty / (a.safety_stock_qty || 1) - b.on_hand_qty / (b.safety_stock_qty || 1))}
                columns={[
                  { title: '상품', render: (_, r) => <>{r.product_name}<br /><Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.sku}</Typography.Text></> },
                  { title: '현재고', dataIndex: 'on_hand_qty', align: 'right', render: (v) => <Typography.Text type="danger" strong>{fmtNum(v)}</Typography.Text> },
                  { title: '안전재고', dataIndex: 'safety_stock_qty', align: 'right', render: fmtNum },
                  { title: '미입고', dataIndex: 'outstanding_po_qty', align: 'right', render: (v) => (v ? `+${fmtNum(v)}` : <Tag color="error">발주 없음</Tag>) },
                ]}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card
            title="입고 대기 발주서"
            extra={<Button type="link" onClick={() => navigate('/purchase-orders')}>전체 <ArrowRightOutlined /></Button>}
            loading={loading}
          >
            <List
              dataSource={[...kpi.openPos].sort((a, b) => (a.expected_receipt_date ?? '').localeCompare(b.expected_receipt_date ?? ''))}
              locale={{ emptyText: '입고 대기 중인 발주서가 없습니다.' }}
              renderItem={(p) => {
                const overdue = p.expected_receipt_date && dayjs(p.expected_receipt_date).isBefore(dayjs(), 'day');
                return (
                  <List.Item extra={<StatusTag kind="po" value={p.status} />}>
                    <List.Item.Meta
                      title={<>{p.po_no} · {p.supplier_name}</>}
                      description={
                        <Flex gap={12}>
                          <span>입고예정 {fmtDate(p.expected_receipt_date)}{overdue && <Typography.Text type="warning"> (경과)</Typography.Text>}</span>
                          <span>입고 {fmtNum(p.total_received_qty)}/{fmtNum(p.total_ordered_qty)}</span>
                        </Flex>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <Card
            title="최근 재고 변동"
            extra={<Button type="link" onClick={() => navigate('/stock-movements')}>전체 <ArrowRightOutlined /></Button>}
            loading={loading}
          >
            <MovementTable data={data.movements} size="small" pagination={false} compact />
          </Card>
        </Col>
      </Row>
    </>
  );
}
