import { Table, Tooltip } from 'antd';
import StatusTag from './StatusTag';
import { fmtDateTime, fmtNum } from '../utils';

// 재고 변동 이력(원장) 테이블. showProduct=false면 상품 컬럼을 숨긴다(단일 상품 상세용).
// compact=true면 연결 전표·사유 컬럼을 숨긴다(대시보드처럼 좁은 카드용).
export default function MovementTable({ data, loading, showProduct = true, compact = false, pagination, size = 'middle' }) {
  const columns = [
    { title: '일시', dataIndex: 'created_at', width: 150, render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(v)}</span> },
    {
      title: '유형', dataIndex: 'movement_type', width: 80,
      render: (v, r) => (
        <>
          <StatusTag kind="movement" value={v} />
          {r.quantity_change > 0 && v === 'sale' && <Tooltip title="판매 취소에 의한 반대 부호 기록">↩</Tooltip>}
        </>
      ),
    },
    ...(showProduct
      ? [
        { title: 'SKU', dataIndex: 'sku', width: 100 },
        { title: '상품명', dataIndex: 'product_name', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
      ]
      : []),
    {
      title: '변동 수량', dataIndex: 'quantity_change', width: 100, align: 'right',
      render: (v) => <span className={v > 0 ? 'qty-plus' : 'qty-minus'}>{v > 0 ? '+' : ''}{fmtNum(v)}</span>,
    },
    ...(compact ? [] : [{
      title: '연결 전표', width: 130,
      render: (_, r) => (r.sale_item_id ? `판매상세 #${r.sale_item_id}` : r.receipt_item_id ? `입고상세 #${r.receipt_item_id}` : '-'),
    },
    { title: '사유', dataIndex: 'reason', render: (v) => v || '-' },
    ]),
  ];

  return (
    <Table
      rowKey="movement_id"
      columns={columns}
      dataSource={data}
      loading={loading}
      size={size}
      pagination={pagination ?? { pageSize: 20 }}
      scroll={{ x: 'max-content' }}
    />
  );
}
