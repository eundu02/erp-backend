import { useMemo, useState } from 'react';
import {
  Badge, Card, Col, Descriptions, Drawer, Flex, Input, Progress, Row, Statistic, Switch, Table, Tag, Typography,
} from 'antd';
import { SearchOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import MovementTable from '../components/MovementTable';
import { fmtDateTime, fmtNum } from '../utils';

function StockLevel({ onHand, safety }) {
  if (safety <= 0) return null;
  const pct = Math.min(100, Math.round((onHand / (safety * 2)) * 100));
  return (
    <Progress
      percent={pct}
      size="small"
      showInfo={false}
      strokeColor={onHand < safety ? '#ef4444' : onHand < safety * 1.5 ? '#f59e0b' : '#22c55e'}
      style={{ width: 90, margin: 0 }}
    />
  );
}

export default function Inventory() {
  const { data = [], loading } = useApi(() => api.get('/inventory'), [], []);
  const [keyword, setKeyword] = useState('');
  const [onlyShortage, setOnlyShortage] = useState(false);
  const [selected, setSelected] = useState(null);
  const movements = useApi(
    () => (selected ? api.get('/stock-movements', { product_id: selected.product_id, limit: 200 }) : Promise.resolve([])),
    [selected?.product_id],
    []
  );

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return data.filter((r) => {
      if (onlyShortage && !r.below_safety_stock) return false;
      return !k || r.sku.toLowerCase().includes(k) || r.product_name.toLowerCase().includes(k);
    });
  }, [data, keyword, onlyShortage]);

  const totals = useMemo(() => ({
    items: data.filter((r) => r.is_active).length,
    onHand: data.reduce((a, r) => a + r.on_hand_qty, 0),
    outstanding: data.reduce((a, r) => a + r.outstanding_po_qty, 0),
    shortage: data.filter((r) => r.is_active && r.below_safety_stock).length,
  }), [data]);

  const columns = [
    { title: 'SKU', dataIndex: 'sku', width: 110, sorter: (a, b) => a.sku.localeCompare(b.sku) },
    {
      title: '상품명', dataIndex: 'product_name',
      render: (v, r) => (
        <>
          {v} {!r.is_active && <Tag>미사용</Tag>}
        </>
      ),
    },
    { title: '단위', dataIndex: 'unit', width: 70 },
    {
      title: '현재고', dataIndex: 'on_hand_qty', width: 100, align: 'right',
      sorter: (a, b) => a.on_hand_qty - b.on_hand_qty,
      render: (v) => <Typography.Text strong>{fmtNum(v)}</Typography.Text>,
    },
    { title: '안전재고', dataIndex: 'safety_stock_qty', width: 90, align: 'right', render: fmtNum },
    {
      title: '재고 수준', width: 110,
      render: (_, r) => <StockLevel onHand={r.on_hand_qty} safety={r.safety_stock_qty} />,
    },
    {
      title: '미입고 발주', dataIndex: 'outstanding_po_qty', width: 110, align: 'right',
      render: (v) => (v > 0 ? <Typography.Text type="secondary">+{fmtNum(v)}</Typography.Text> : '-'),
    },
    {
      title: '재고 위치', width: 100, align: 'right',
      render: (_, r) => fmtNum(r.on_hand_qty + r.outstanding_po_qty),
    },
    {
      title: '상태', dataIndex: 'below_safety_stock', width: 100, align: 'center',
      filters: [{ text: '안전재고 미달', value: true }, { text: '정상', value: false }],
      onFilter: (value, r) => r.below_safety_stock === value,
      render: (v) => (v ? <Badge status="error" text="미달" /> : <Badge status="success" text="정상" />),
    },
    { title: '최종 변동', dataIndex: 'updated_at', width: 150, render: fmtDateTime },
  ];

  return (
    <>
      <PageHeader title="재고 현황" description="상품별 현재고와 미입고 발주량을 조회합니다. 행을 클릭하면 변동 이력을 볼 수 있습니다." />
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Card><Statistic title="관리 품목 (사용)" value={totals.items} suffix="개" /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="총 현재고" value={totals.onHand} /></Card></Col>
        <Col xs={12} md={6}><Card><Statistic title="미입고 발주 수량" value={totals.outstanding} /></Card></Col>
        <Col xs={12} md={6}>
          <Card>
            <Statistic
              title="안전재고 미달"
              value={totals.shortage}
              suffix="개"
              valueStyle={{ color: totals.shortage ? '#dc2626' : undefined }}
              prefix={totals.shortage ? <WarningOutlined /> : null}
            />
          </Card>
        </Col>
      </Row>
      <Card>
        <Flex gap={16} align="center" wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="SKU 또는 상품명 검색"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Flex gap={8} align="center">
            <Switch checked={onlyShortage} onChange={setOnlyShortage} />
            <span>안전재고 미달만 보기</span>
          </Flex>
        </Flex>
        <Table
          rowKey="product_id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          rowClassName="clickable-row"
          onRow={(r) => ({ onClick: () => setSelected(r) })}
          scroll={{ x: 1100 }}
        />
      </Card>

      <Drawer
        title={selected ? `${selected.product_name} (${selected.sku})` : ''}
        open={!!selected}
        onClose={() => setSelected(null)}
        width={760}
      >
        {selected && (
          <>
            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="현재고">{fmtNum(selected.on_hand_qty)} {selected.unit}</Descriptions.Item>
              <Descriptions.Item label="안전재고">{fmtNum(selected.safety_stock_qty)}</Descriptions.Item>
              <Descriptions.Item label="미입고 발주">{fmtNum(selected.outstanding_po_qty)}</Descriptions.Item>
              <Descriptions.Item label="재고 위치">{fmtNum(selected.on_hand_qty + selected.outstanding_po_qty)}</Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>재고 변동 이력</Typography.Title>
            <MovementTable data={movements.data} loading={movements.loading} showProduct={false} size="small" pagination={{ pageSize: 10 }} />
          </>
        )}
      </Drawer>
    </>
  );
}
