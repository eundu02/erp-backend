import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Flex, Form, InputNumber, Modal, Popconfirm,
  Progress, Segmented, Select, Space, Table, Typography,
} from 'antd';
import { CheckOutlined, InboxOutlined, MinusCircleOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import ReceiptCreateModal from '../components/ReceiptCreateModal';
import DeleteDraftButton from '../components/DeleteDraftButton';
import { CURRENT_USER } from '../config';
import { fmtDate, fmtDateTime, fmtNum, fmtPrice } from '../utils';

function ReceiveProgress({ received, ordered }) {
  const pct = ordered ? Math.round((received / ordered) * 100) : 0;
  return (
    <Flex align="center" gap={8}>
      <Progress percent={pct} size="small" showInfo={false} style={{ width: 90, margin: 0 }} status={pct === 100 ? 'success' : 'active'} />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtNum(received)}/{fmtNum(ordered)}</Typography.Text>
    </Flex>
  );
}

function PoCreateModal({ open, onClose, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const supplierId = Form.useWatch('supplier_id', form);
  const master = useApi(
    () => (open ? Promise.all([api.get('/suppliers'), api.get('/inventory', { is_active: true }), api.get('/products', { is_active: true })]) : Promise.resolve([[], [], []])),
    [open],
    [[], [], []]
  );
  const [suppliers, inventory, products] = master.data;
  const stockOf = useMemo(() => Object.fromEntries(inventory.map((r) => [r.product_id, r])), [inventory]);
  const productOf = useMemo(() => Object.fromEntries(products.map((p) => [p.product_id, p])), [products]);

  // 발주처가 지정된 상품 + 공급업체 미지정 상품만 선택 가능 (백엔드 검증과 동일한 규칙)
  const productOptions = products
    .filter((p) => supplierId && (p.supplier_id === supplierId || p.supplier_id === null))
    .map((p) => {
      const s = stockOf[p.product_id];
      return {
        value: p.product_id,
        label: `${p.sku} · ${p.product_name} (재고 ${fmtNum(s?.on_hand_qty)} / 안전 ${fmtNum(p.safety_stock_qty)})`,
      };
    });

  const submit = async (confirmNow) => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const po = await api.post('/purchase-orders', {
        supplier_id: values.supplier_id,
        created_by: CURRENT_USER.user_id,
        expected_receipt_date: values.expected_receipt_date?.format('YYYY-MM-DD') ?? null,
        items: values.items.map((it) => ({ product_id: it.product_id, ordered_qty: it.ordered_qty, unit_price: it.unit_price ?? null })),
      });
      if (confirmNow) {
        await api.post(`/purchase-orders/${po.purchase_order_id}/confirm`);
        message.success(`발주서 ${po.po_no}를 등록하고 확정했습니다.`);
      } else {
        message.success(`발주서 ${po.po_no}를 작성중 상태로 저장했습니다.`);
      }
      onCreated();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="발주서 등록"
      open={open}
      onCancel={onClose}
      width={820}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>취소</Button>,
        <Button key="draft" loading={saving} onClick={() => submit(false)}>작성중 저장</Button>,
        <Button key="confirm" type="primary" loading={saving} onClick={() => submit(true)}>저장 후 발주 확정</Button>,
      ]}
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={{ items: [{}] }}>
        <Flex gap={12}>
          <Form.Item name="supplier_id" label="공급업체" rules={[{ required: true, message: '공급업체를 선택하세요.' }]} style={{ flex: 1 }}>
            <Select
              placeholder="공급업체 선택"
              options={suppliers.filter((s) => s.is_active).map((s) => ({ value: s.supplier_id, label: s.supplier_name }))}
              onChange={() => form.setFieldValue('items', [{}])}
            />
          </Form.Item>
          <Form.Item name="expected_receipt_date" label="입고 예정일" extra="비우면 확정 시 계획 납기로 자동 계산">
            <DatePicker style={{ width: 200 }} />
          </Form.Item>
        </Flex>
        <Typography.Text strong>발주 품목</Typography.Text>
        <Form.List
          name="items"
          rules={[{ validator: async (_, items) => { if (!items?.length) throw new Error('품목을 1개 이상 입력하세요.'); } }]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ marginTop: 8 }}>
              {fields.map((field) => (
                <Flex key={field.key} gap={8} align="baseline">
                  <Form.Item name={[field.name, 'product_id']} rules={[{ required: true, message: '상품 선택' }]} style={{ flex: 1 }}>
                    <Select
                      showSearch
                      disabled={!supplierId}
                      placeholder={supplierId ? '상품' : '공급업체를 먼저 선택하세요'}
                      optionFilterProp="label"
                      options={productOptions}
                    />
                  </Form.Item>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, cur) => prev.items?.[field.name]?.product_id !== cur.items?.[field.name]?.product_id}
                  >
                    {({ getFieldValue }) => {
                      const p = productOf[getFieldValue(['items', field.name, 'product_id'])];
                      return (
                        <Form.Item
                          name={[field.name, 'ordered_qty']}
                          rules={[
                            { required: true, message: '수량' },
                            {
                              // 경고만 표시 (저장은 허용) — 최소주문량/주문배수는 추천 계산 규칙이고 백엔드가 강제하지 않음
                              warningOnly: true,
                              validator: async (_, v) => {
                                if (!p || !v) return;
                                if (v < p.minimum_order_qty) throw new Error(`최소 ${p.minimum_order_qty}`);
                                if (v % p.order_multiple !== 0) throw new Error(`${p.order_multiple}의 배수`);
                              },
                            },
                          ]}
                          tooltip={p ? `최소주문량 ${p.minimum_order_qty}, 주문배수 ${p.order_multiple}` : undefined}
                        >
                          <InputNumber min={1} placeholder={p ? `MOQ ${p.minimum_order_qty} · ×${p.order_multiple}` : '수량'} style={{ width: 150 }} />
                        </Form.Item>
                      );
                    }}
                  </Form.Item>
                  <Form.Item name={[field.name, 'unit_price']}>
                    <InputNumber min={0} placeholder="단가(선택)" style={{ width: 130 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(field.name)} style={{ color: '#94a3b8' }} />
                </Flex>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block disabled={!supplierId}>품목 추가</Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="발주 확정은 재고를 바꾸지 않습니다. 재고는 입고 확정 시점에만 증가합니다."
        />
      </Form>
    </Modal>
  );
}

function PoDetailDrawer({ poId, onClose, onChanged }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const { data, loading, reload } = useApi(
    () => (poId ? Promise.all([api.get(`/purchase-orders/${poId}`), api.get('/receipts', { purchase_order_id: poId })]) : Promise.resolve(null)),
    [poId],
    null
  );
  const [po, receipts] = data ?? [];

  const act = async (action) => {
    setBusy(true);
    try {
      await api.post(`/purchase-orders/${poId}/${action}`);
      message.success(action === 'confirm' ? '발주를 확정했습니다.' : '발주를 취소했습니다.');
      reload();
      onChanged();
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const canReceive = po && ['confirmed', 'partially_received'].includes(po.status);
  const total = po?.items.reduce((a, i) => a + (i.unit_price ? Number(i.unit_price) * i.ordered_qty : 0), 0);

  return (
    <Drawer
      title={po ? `발주서 ${po.po_no}` : '발주서'}
      open={!!poId}
      onClose={onClose}
      width={820}
      loading={loading && !po}
      extra={po && (
        <Space>
          {po.status === 'draft' && (
            <Popconfirm title="발주를 확정할까요?" description="확정일이 발주일로 기록됩니다." onConfirm={() => act('confirm')} okText="확정" cancelText="닫기">
              <Button type="primary" icon={<CheckOutlined />} loading={busy}>발주 확정</Button>
            </Popconfirm>
          )}
          {canReceive && (
            <Button type="primary" icon={<InboxOutlined />} onClick={() => setReceiving(true)}>입고 등록</Button>
          )}
          {po.status === 'draft' && (
            <DeleteDraftButton
              path={`/purchase-orders/${poId}`}
              description={po.items.some((i) => i.recommendation_decision_id)
                ? '발주 추천에서 전환된 발주서입니다. 삭제하면 판단 이력이 ‘판단 확정’으로 돌아가 다시 전환할 수 있습니다.'
                : undefined}
              onDeleted={() => { onChanged(); onClose(); }}
            />
          )}
          {['draft', 'confirmed'].includes(po.status) && (
            <Popconfirm title="발주를 취소할까요?" onConfirm={() => act('cancel')} okText="취소 처리" cancelText="닫기">
              <Button danger icon={<StopOutlined />} loading={busy}>발주 취소</Button>
            </Popconfirm>
          )}
        </Space>
      )}
    >
      {po && (
        <>
          <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="발주번호">{po.po_no}</Descriptions.Item>
            <Descriptions.Item label="상태"><StatusTag kind="po" value={po.status} /></Descriptions.Item>
            <Descriptions.Item label="공급업체">{po.supplier_name}</Descriptions.Item>
            <Descriptions.Item label="발주일">{fmtDate(po.order_date)}</Descriptions.Item>
            <Descriptions.Item label="입고 예정일">{fmtDate(po.expected_receipt_date)}</Descriptions.Item>
            <Descriptions.Item label="확정일시">{fmtDateTime(po.confirmed_at)}</Descriptions.Item>
            <Descriptions.Item label="합계 금액" span={2}>{total ? fmtPrice(total) : '-'}</Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5}>발주 품목</Typography.Title>
          <Table
            rowKey="po_item_id"
            size="small"
            pagination={false}
            dataSource={po.items}
            style={{ marginBottom: 24 }}
            columns={[
              { title: 'SKU', dataIndex: 'sku', width: 100 },
              { title: '상품명', dataIndex: 'product_name' },
              { title: '발주', dataIndex: 'ordered_qty', align: 'right', width: 70, render: fmtNum },
              { title: '입고', dataIndex: 'received_qty', align: 'right', width: 70, render: fmtNum },
              { title: '잔량', dataIndex: 'remaining_qty', align: 'right', width: 70, render: fmtNum },
              { title: '진행률', width: 160, render: (_, r) => <ReceiveProgress received={r.received_qty} ordered={r.ordered_qty} /> },
              { title: '단가', dataIndex: 'unit_price', align: 'right', width: 100, render: fmtPrice },
            ]}
          />
          <Typography.Title level={5}>입고 내역</Typography.Title>
          <Table
            rowKey="receipt_id"
            size="small"
            pagination={false}
            dataSource={receipts}
            locale={{ emptyText: '아직 입고 내역이 없습니다.' }}
            columns={[
              { title: '입고번호', dataIndex: 'receipt_no' },
              { title: '입고일', dataIndex: 'receipt_date', render: fmtDate },
              { title: '상태', dataIndex: 'status', render: (v) => <StatusTag kind="receipt" value={v} /> },
              { title: '입고 수량', dataIndex: 'total_received_qty', align: 'right', render: fmtNum },
              { title: '확정일시', dataIndex: 'confirmed_at', render: fmtDateTime },
            ]}
          />
        </>
      )}
      <ReceiptCreateModal
        open={receiving}
        purchaseOrderId={poId}
        onClose={() => setReceiving(false)}
        onCreated={() => { setReceiving(false); reload(); onChanged(); }}
      />
    </Drawer>
  );
}

export default function PurchaseOrders() {
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const { data = [], loading, reload } = useApi(
    () => api.get('/purchase-orders', { status: status === 'all' ? undefined : status }),
    [status],
    []
  );

  const columns = [
    { title: '발주번호', dataIndex: 'po_no', width: 170 },
    { title: '공급업체', dataIndex: 'supplier_name' },
    { title: '상태', dataIndex: 'status', width: 100, render: (v) => <StatusTag kind="po" value={v} /> },
    { title: '발주일', dataIndex: 'order_date', width: 115, render: fmtDate },
    { title: '입고 예정일', dataIndex: 'expected_receipt_date', width: 115, render: fmtDate },
    { title: '품목 수', dataIndex: 'item_count', width: 80, align: 'right' },
    {
      title: '입고 진행', width: 180,
      render: (_, r) => <ReceiveProgress received={r.total_received_qty} ordered={r.total_ordered_qty} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="발주 관리"
        description="공급업체에 보낼 발주서를 작성·확정하고 입고 진행 상황을 추적합니다."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>발주 등록</Button>}
      />
      <Card>
        <Segmented
          style={{ marginBottom: 16 }}
          value={status}
          onChange={setStatus}
          options={[
            { label: '전체', value: 'all' },
            { label: '작성중', value: 'draft' },
            { label: '발주확정', value: 'confirmed' },
            { label: '부분입고', value: 'partially_received' },
            { label: '입고완료', value: 'completed' },
            { label: '취소', value: 'canceled' },
          ]}
        />
        <Table
          rowKey="purchase_order_id"
          columns={columns}
          dataSource={data}
          loading={loading}
          size="middle"
          rowClassName="clickable-row"
          onRow={(r) => ({ onClick: () => setSelectedId(r.purchase_order_id) })}
        />
      </Card>
      <PoCreateModal open={creating} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      <PoDetailDrawer poId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </>
  );
}
