import { useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, DatePicker, Descriptions, Drawer, Flex, Form, Input, InputNumber, Modal,
  Popconfirm, Segmented, Select, Space, Table, Typography,
} from 'antd';
import { CheckOutlined, MinusCircleOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import StatusTag from '../components/StatusTag';
import DeleteDraftButton from '../components/DeleteDraftButton';
import { CURRENT_USER } from '../config';
import { describeError, fmtDate, fmtDateTime, fmtNum, fmtPrice } from '../utils';

function SaleCreateModal({ open, onClose, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const inventory = useApi(() => (open ? api.get('/inventory', { is_active: true }) : Promise.resolve([])), [open], []);
  const stockOf = useMemo(() => Object.fromEntries(inventory.data.map((r) => [r.product_id, r])), [inventory.data]);

  const submit = async (confirmNow) => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const sale = await api.post('/sales', {
        created_by: CURRENT_USER.user_id,
        sale_date: values.sale_date.format('YYYY-MM-DD'),
        items: values.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_price: it.unit_price ?? null })),
      });
      if (confirmNow) {
        try {
          await api.post(`/sales/${sale.sale_id}/confirm`, { confirmed_by: CURRENT_USER.user_id });
          message.success(`판매전표 ${sale.sale_no}를 등록하고 확정했습니다.`);
        } catch (err) {
          message.warning(`${sale.sale_no}는 작성중으로 저장됐지만 확정하지 못했습니다: ${describeError(err, { nameOf: (id) => stockOf[id]?.product_name })}`, 6);
        }
      } else {
        message.success(`판매전표 ${sale.sale_no}를 작성중 상태로 저장했습니다.`);
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
      title="판매전표 등록"
      open={open}
      onCancel={onClose}
      width={760}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>취소</Button>,
        <Button key="draft" loading={saving} onClick={() => submit(false)}>작성중 저장</Button>,
        <Button key="confirm" type="primary" loading={saving} onClick={() => submit(true)}>저장 후 확정</Button>,
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ sale_date: dayjs(), items: [{}] }}
      >
        <Form.Item name="sale_date" label="판매일" rules={[{ required: true }]}>
          <DatePicker style={{ width: 200 }} />
        </Form.Item>
        <Typography.Text strong>판매 품목</Typography.Text>
        <Form.List
          name="items"
          rules={[{ validator: async (_, items) => { if (!items?.length) throw new Error('품목을 1개 이상 입력하세요.'); } }]}
        >
          {(fields, { add, remove }, { errors }) => (
            <div style={{ marginTop: 8 }}>
              {fields.map((field) => (
                <Flex key={field.key} gap={8} align="baseline">
                  <Form.Item
                    name={[field.name, 'product_id']}
                    rules={[{ required: true, message: '상품 선택' }]}
                    style={{ flex: 1 }}
                  >
                    <Select
                      showSearch
                      placeholder="상품"
                      optionFilterProp="label"
                      options={inventory.data.map((r) => ({
                        value: r.product_id,
                        label: `${r.sku} · ${r.product_name} (재고 ${fmtNum(r.on_hand_qty)})`,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'quantity']}
                    rules={[{ required: true, message: '수량' }]}
                  >
                    <InputNumber min={1} placeholder="수량" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'unit_price']}>
                    <InputNumber min={0} placeholder="단가(선택)" style={{ width: 130 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(field.name)} style={{ color: '#94a3b8' }} />
                </Flex>
              ))}
              <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} block>품목 추가</Button>
              <Form.ErrorList errors={errors} />
            </div>
          )}
        </Form.List>
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="작성중 저장은 재고를 차감하지 않습니다. 확정하는 순간 재고가 차감되며, 한 품목이라도 재고가 부족하면 전표 전체가 확정되지 않습니다."
        />
      </Form>
    </Modal>
  );
}

function SaleDetailDrawer({ saleId, onClose, onChanged }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const { data: sale, loading, reload } = useApi(
    () => (saleId ? api.get(`/sales/${saleId}`) : Promise.resolve(null)),
    [saleId],
    null
  );

  const nameOf = (pid) => sale?.items.find((i) => i.product_id === pid)?.product_name;

  const act = async (action) => {
    setBusy(true);
    try {
      if (action === 'confirm') {
        await api.post(`/sales/${saleId}/confirm`, { confirmed_by: CURRENT_USER.user_id });
        message.success('판매를 확정했습니다. 재고가 차감되었습니다.');
      } else {
        await api.post(`/sales/${saleId}/cancel`, { reason: cancelReason || undefined, canceled_by: CURRENT_USER.user_id });
        message.success(sale.status === 'confirmed' ? '판매를 취소했습니다. 재고가 복원되었습니다.' : '판매전표를 취소했습니다.');
      }
      reload();
      onChanged();
    } catch (err) {
      message.error(describeError(err, { nameOf }), 6);
    } finally {
      setBusy(false);
    }
  };

  const total = sale?.items.reduce((a, i) => a + (i.unit_price ? Number(i.unit_price) * i.quantity : 0), 0);

  return (
    <Drawer
      title={sale ? `판매전표 ${sale.sale_no}` : '판매전표'}
      open={!!saleId}
      onClose={onClose}
      width={720}
      loading={loading && !sale}
      extra={sale && (
        <Space>
          {sale.status === 'draft' && (
            <Popconfirm title="판매를 확정할까요?" description="확정 시 재고가 차감됩니다." onConfirm={() => act('confirm')} okText="확정" cancelText="닫기">
              <Button type="primary" icon={<CheckOutlined />} loading={busy}>판매 확정</Button>
            </Popconfirm>
          )}
          {sale.status === 'draft' && (
            <DeleteDraftButton path={`/sales/${saleId}`} onDeleted={() => { onChanged(); onClose(); }} />
          )}
          {sale.status !== 'canceled' && (
            <Popconfirm
              title="판매전표를 취소할까요?"
              description={sale.status === 'confirmed' ? (
                <div style={{ width: 260 }}>
                  <div style={{ marginBottom: 8 }}>차감된 재고가 반대 부호 이력으로 복원됩니다.</div>
                  <Input placeholder="취소 사유 (예: 고객 반품)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                </div>
              ) : '재고 변동은 없습니다.'}
              onConfirm={() => act('cancel')}
              okText="취소 처리"
              cancelText="닫기"
            >
              <Button danger icon={<StopOutlined />} loading={busy}>판매 취소</Button>
            </Popconfirm>
          )}
        </Space>
      )}
    >
      {sale && (
        <>
          <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="전표번호">{sale.sale_no}</Descriptions.Item>
            <Descriptions.Item label="상태"><StatusTag kind="sale" value={sale.status} /></Descriptions.Item>
            <Descriptions.Item label="판매일">{fmtDate(sale.sale_date)}</Descriptions.Item>
            <Descriptions.Item label="확정일시">{fmtDateTime(sale.confirmed_at)}</Descriptions.Item>
            <Descriptions.Item label="작성일시">{fmtDateTime(sale.created_at)}</Descriptions.Item>
            <Descriptions.Item label="합계 금액">{total ? fmtPrice(total) : '-'}</Descriptions.Item>
          </Descriptions>
          <Table
            rowKey="sale_item_id"
            size="small"
            pagination={false}
            dataSource={sale.items}
            columns={[
              { title: 'SKU', dataIndex: 'sku', width: 100 },
              { title: '상품명', dataIndex: 'product_name' },
              { title: '수량', dataIndex: 'quantity', align: 'right', width: 80, render: fmtNum },
              { title: '단위', dataIndex: 'unit', width: 60 },
              { title: '단가', dataIndex: 'unit_price', align: 'right', width: 110, render: fmtPrice },
              { title: '금액', align: 'right', width: 120, render: (_, r) => (r.unit_price ? fmtPrice(Number(r.unit_price) * r.quantity) : '-') },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

export default function Sales() {
  const [status, setStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const { data = [], loading, reload } = useApi(
    () => api.get('/sales', { status: status === 'all' ? undefined : status }),
    [status],
    []
  );

  const columns = [
    { title: '전표번호', dataIndex: 'sale_no', width: 170 },
    { title: '판매일', dataIndex: 'sale_date', width: 120, render: fmtDate, sorter: (a, b) => a.sale_date.localeCompare(b.sale_date) },
    { title: '상태', dataIndex: 'status', width: 90, render: (v) => <StatusTag kind="sale" value={v} /> },
    { title: '품목 수', dataIndex: 'item_count', width: 90, align: 'right' },
    { title: '총 수량', dataIndex: 'total_qty', width: 100, align: 'right', render: fmtNum },
    { title: '확정일시', dataIndex: 'confirmed_at', width: 160, render: fmtDateTime },
    { title: '작성일시', dataIndex: 'created_at', width: 160, render: fmtDateTime },
  ];

  return (
    <>
      <PageHeader
        title="판매 관리"
        description="판매전표를 작성하고 확정합니다. 확정 시점에 재고가 차감됩니다."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>판매 등록</Button>}
      />
      <Card>
        <Segmented
          style={{ marginBottom: 16 }}
          value={status}
          onChange={setStatus}
          options={[
            { label: '전체', value: 'all' },
            { label: '작성중', value: 'draft' },
            { label: '확정', value: 'confirmed' },
            { label: '취소', value: 'canceled' },
          ]}
        />
        <Table
          rowKey="sale_id"
          columns={columns}
          dataSource={data}
          loading={loading}
          size="middle"
          rowClassName="clickable-row"
          onRow={(r) => ({ onClick: () => setSelectedId(r.sale_id) })}
        />
      </Card>
      <SaleCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); reload(); }}
      />
      <SaleDetailDrawer saleId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </>
  );
}
