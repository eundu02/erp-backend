import { useState } from 'react';
import { App, Button, Card, Descriptions, Drawer, Popconfirm, Segmented, Space, Table } from 'antd';
import { CheckOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import ReceiptCreateModal from '../components/ReceiptCreateModal';
import DeleteDraftButton from '../components/DeleteDraftButton';
import { CURRENT_USER } from '../config';
import { describeError, fmtDate, fmtDateTime, fmtNum } from '../utils';

function ReceiptDetailDrawer({ receiptId, onClose, onChanged }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const { data: receipt, loading, reload } = useApi(
    () => (receiptId ? api.get(`/receipts/${receiptId}`) : Promise.resolve(null)),
    [receiptId],
    null
  );

  const confirm = async () => {
    setBusy(true);
    try {
      await api.post(`/receipts/${receiptId}/confirm`, { confirmed_by: CURRENT_USER.user_id });
      message.success('입고를 확정했습니다. 재고가 증가했습니다.');
      reload();
      onChanged();
    } catch (err) {
      message.error(describeError(err, { poItemName: (id) => receipt?.items.find((i) => i.po_item_id === id)?.product_name }), 6);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={receipt ? `입고전표 ${receipt.receipt_no}` : '입고전표'}
      open={!!receiptId}
      onClose={onClose}
      width={720}
      loading={loading && !receipt}
      extra={receipt?.status === 'draft' && (
        <Space>
          <DeleteDraftButton path={`/receipts/${receiptId}`} onDeleted={() => { onChanged(); onClose(); }} />
          <Popconfirm title="입고를 확정할까요?" description="확정 시 재고가 증가하고 발주 입고 수량이 누적됩니다." onConfirm={confirm} okText="확정" cancelText="닫기">
            <Button type="primary" icon={<CheckOutlined />} loading={busy}>입고 확정</Button>
          </Popconfirm>
        </Space>
      )}
    >
      {receipt && (
        <>
          <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="입고번호">{receipt.receipt_no}</Descriptions.Item>
            <Descriptions.Item label="상태"><StatusTag kind="receipt" value={receipt.status} /></Descriptions.Item>
            <Descriptions.Item label="발주번호">{receipt.po_no}</Descriptions.Item>
            <Descriptions.Item label="입고일">{fmtDate(receipt.receipt_date)}</Descriptions.Item>
            <Descriptions.Item label="확정일시">{fmtDateTime(receipt.confirmed_at)}</Descriptions.Item>
            <Descriptions.Item label="작성일시">{fmtDateTime(receipt.created_at)}</Descriptions.Item>
          </Descriptions>
          <Table
            rowKey="receipt_item_id"
            size="small"
            pagination={false}
            dataSource={receipt.items}
            columns={[
              { title: 'SKU', dataIndex: 'sku', width: 100 },
              { title: '상품명', dataIndex: 'product_name' },
              { title: '이번 입고', dataIndex: 'received_qty', align: 'right', width: 90, render: (v) => <b>{fmtNum(v)}</b> },
              { title: '발주 누적 입고', align: 'right', width: 120, render: (_, r) => `${fmtNum(r.po_received_qty)} / ${fmtNum(r.ordered_qty)}` },
              { title: '단위', dataIndex: 'unit', width: 60 },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

export default function Receipts() {
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const { data = [], loading, reload } = useApi(
    () => api.get('/receipts', { status: status === 'all' ? undefined : status }),
    [status],
    []
  );

  const columns = [
    { title: '입고번호', dataIndex: 'receipt_no', width: 170 },
    { title: '발주번호', dataIndex: 'po_no', width: 170 },
    { title: '입고일', dataIndex: 'receipt_date', width: 120, render: fmtDate },
    { title: '상태', dataIndex: 'status', width: 100, render: (v) => <StatusTag kind="receipt" value={v} /> },
    { title: '품목 수', dataIndex: 'item_count', width: 90, align: 'right' },
    { title: '입고 수량', dataIndex: 'total_received_qty', width: 100, align: 'right', render: fmtNum },
    { title: '확정일시', dataIndex: 'confirmed_at', render: fmtDateTime },
  ];

  return (
    <>
      <PageHeader
        title="입고 관리"
        description="발주서 기준으로 입고를 등록합니다. 부분 입고를 지원하며, 입고 확정 시점에 재고가 증가합니다."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>입고 등록</Button>}
      />
      <Card>
        <Segmented
          style={{ marginBottom: 16 }}
          value={status}
          onChange={setStatus}
          options={[
            { label: '전체', value: 'all' },
            { label: '작성중', value: 'draft' },
            { label: '입고확정', value: 'confirmed' },
          ]}
        />
        <Table
          rowKey="receipt_id"
          columns={columns}
          dataSource={data}
          loading={loading}
          size="middle"
          rowClassName="clickable-row"
          onRow={(r) => ({ onClick: () => setSelectedId(r.receipt_id) })}
        />
      </Card>
      <ReceiptCreateModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      <ReceiptDetailDrawer receiptId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </>
  );
}
