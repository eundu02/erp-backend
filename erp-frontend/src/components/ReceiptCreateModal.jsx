import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, DatePicker, Descriptions, Form, InputNumber, Modal, Select, Table } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import { CURRENT_USER } from '../config';
import { describeError, fmtNum } from '../utils';
import StatusTag from './StatusTag';

// 발주서 기준 입고 등록 (부분 입고). purchaseOrderId를 넘기면 해당 발주로 고정, 없으면 발주 선택부터.
export default function ReceiptCreateModal({ open, purchaseOrderId, onClose, onCreated }) {
  const { message } = App.useApp();
  const [poId, setPoId] = useState(purchaseOrderId ?? null);
  const [qty, setQty] = useState({}); // po_item_id -> 이번 입고 수량
  const [receiptDate, setReceiptDate] = useState(dayjs());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPoId(purchaseOrderId ?? null);
      setReceiptDate(dayjs());
    }
  }, [open, purchaseOrderId]);

  // 입고 가능한 발주서 (확정 + 부분입고)
  const receivable = useApi(
    () => (open && !purchaseOrderId
      ? Promise.all([
        api.get('/purchase-orders', { status: 'confirmed' }),
        api.get('/purchase-orders', { status: 'partially_received' }),
      ]).then(([a, b]) => [...a, ...b].sort((x, y) => y.purchase_order_id - x.purchase_order_id))
      : Promise.resolve([])),
    [open, purchaseOrderId],
    []
  );

  const po = useApi(() => (open && poId ? api.get(`/purchase-orders/${poId}`) : Promise.resolve(null)), [open, poId], null);

  // 발주서를 고르면 잔량 전체를 기본값으로 채운다 (실무에서 가장 흔한 "전량 입고" 케이스)
  useEffect(() => {
    if (po.data) {
      setQty(Object.fromEntries(po.data.items.map((i) => [i.po_item_id, i.remaining_qty])));
    }
  }, [po.data]);

  const items = useMemo(() => po.data?.items ?? [], [po.data]);
  const lines = items.filter((i) => (qty[i.po_item_id] ?? 0) > 0);
  const itemName = (id) => items.find((i) => i.po_item_id === id)?.product_name;

  const submit = async (confirmNow) => {
    if (!lines.length) {
      message.warning('입고 수량을 1개 이상 입력하세요.');
      return;
    }
    setSaving(true);
    try {
      const receipt = await api.post('/receipts', {
        purchase_order_id: poId,
        receipt_date: receiptDate.format('YYYY-MM-DD'),
        items: lines.map((i) => ({ po_item_id: i.po_item_id, received_qty: qty[i.po_item_id] })),
      });
      if (confirmNow) {
        await api.post(`/receipts/${receipt.receipt_id}/confirm`, { confirmed_by: CURRENT_USER.user_id });
        message.success(`입고전표 ${receipt.receipt_no}를 등록하고 확정했습니다. 재고가 증가했습니다.`);
      } else {
        message.success(`입고전표 ${receipt.receipt_no}를 작성중 상태로 저장했습니다.`);
      }
      onCreated();
    } catch (err) {
      message.error(describeError(err, { poItemName: itemName }), 6);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="입고 등록"
      open={open}
      onCancel={onClose}
      width={820}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>취소</Button>,
        <Button key="draft" disabled={!poId} loading={saving} onClick={() => submit(false)}>작성중 저장</Button>,
        <Button key="confirm" type="primary" disabled={!poId} loading={saving} onClick={() => submit(true)}>저장 후 입고 확정</Button>,
      ]}
    >
      <Form layout="vertical">
        {!purchaseOrderId && (
          <Form.Item label="발주서" required>
            <Select
              showSearch
              placeholder="입고할 발주서 선택 (발주확정·부분입고 상태)"
              value={poId}
              onChange={setPoId}
              loading={receivable.loading}
              optionFilterProp="label"
              options={receivable.data.map((o) => ({
                value: o.purchase_order_id,
                label: `${o.po_no} · ${o.supplier_name} (입고 ${fmtNum(o.total_received_qty)}/${fmtNum(o.total_ordered_qty)})`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item label="입고일" required>
          <DatePicker value={receiptDate} onChange={(d) => setReceiptDate(d ?? dayjs())} allowClear={false} />
        </Form.Item>
      </Form>

      {po.data && (
        <>
          <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="발주번호">{po.data.po_no}</Descriptions.Item>
            <Descriptions.Item label="공급업체">{po.data.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="상태"><StatusTag kind="po" value={po.data.status} /></Descriptions.Item>
          </Descriptions>
          <Table
            rowKey="po_item_id"
            size="small"
            pagination={false}
            loading={po.loading}
            dataSource={items}
            columns={[
              { title: 'SKU', dataIndex: 'sku', width: 100 },
              { title: '상품명', dataIndex: 'product_name' },
              { title: '발주', dataIndex: 'ordered_qty', align: 'right', width: 70, render: fmtNum },
              { title: '기입고', dataIndex: 'received_qty', align: 'right', width: 70, render: fmtNum },
              { title: '잔량', dataIndex: 'remaining_qty', align: 'right', width: 70, render: fmtNum },
              {
                title: '이번 입고', width: 120,
                render: (_, r) => (
                  <InputNumber
                    min={0}
                    max={r.remaining_qty}
                    disabled={r.remaining_qty === 0}
                    value={qty[r.po_item_id]}
                    onChange={(v) => setQty((q) => ({ ...q, [r.po_item_id]: v ?? 0 }))}
                    style={{ width: '100%' }}
                  />
                ),
              },
            ]}
          />
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message="부분 입고가 가능합니다. 이번에 들어온 수량만 입력하세요 (0이면 제외). 입고 확정 시점에 재고가 증가하고 발주 상태가 갱신됩니다."
          />
        </>
      )}
    </Modal>
  );
}
