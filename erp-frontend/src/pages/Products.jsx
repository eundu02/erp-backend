import { useMemo, useState } from 'react';
import {
  App, Button, Card, Col, Divider, Flex, Form, Input, InputNumber, Modal, Popconfirm, Row, Segmented,
  Select, Space, Switch, Table, Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import { fmtNum } from '../utils';

const UNITS = ['EA', 'BOX', 'PACK', 'SET', 'KG', 'L'];
const NEW_PRODUCT_DEFAULTS = {
  unit: 'EA', minimum_order_qty: 1, order_multiple: 1, safety_stock_qty: 0,
  planned_lead_time_days: 7, review_period_days: 7, default_strategy: 'P50', is_active: true,
};

export default function Products() {
  const { message } = App.useApp();
  const { data, loading, reload } = useApi(
    () => Promise.all([api.get('/products'), api.get('/suppliers')]).then(([products, suppliers]) => ({ products, suppliers })),
    [],
    { products: [], suppliers: [] }
  );
  const [keyword, setKeyword] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const supplierName = useMemo(
    () => Object.fromEntries(data.suppliers.map((s) => [s.supplier_id, s.supplier_name])),
    [data.suppliers]
  );

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return data.products.filter((p) => {
      if (activeFilter === 'active' && !p.is_active) return false;
      if (activeFilter === 'inactive' && p.is_active) return false;
      return !k || p.sku.toLowerCase().includes(k) || p.product_name.toLowerCase().includes(k);
    });
  }, [data.products, keyword, activeFilter]);

  const openForm = (record) => {
    setEditing(record ?? {});
  };

  const save = async () => {
    const values = await form.validateFields();
    values.supplier_id = values.supplier_id ?? null;
    setSaving(true);
    try {
      if (editing.product_id) {
        await api.put(`/products/${editing.product_id}`, values);
        message.success('상품 정보를 수정했습니다.');
      } else {
        await api.post('/products', values);
        message.success('상품을 등록했습니다.');
      }
      setEditing(null);
      reload();
    } catch (err) {
      message.error(err.status === 409 ? `${err.message} — ${err.detail ?? ''}` : err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (record, checked) => {
    try {
      await api.put(`/products/${record.product_id}`, { is_active: checked });
      reload();
    } catch (err) {
      message.error(err.message);
    }
  };

  const remove = async (record) => {
    try {
      await api.del(`/products/${record.product_id}`);
      message.success('삭제했습니다.');
      reload();
    } catch (err) {
      message.error(err.status === 409
        ? '재고·판매·발주 이력이 있는 상품은 삭제할 수 없습니다. 대신 미사용으로 전환하세요.'
        : err.message);
    }
  };

  const columns = [
    { title: 'SKU', dataIndex: 'sku', width: 100, sorter: (a, b) => a.sku.localeCompare(b.sku) },
    { title: '상품명', dataIndex: 'product_name', render: (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
    { title: '단위', dataIndex: 'unit', width: 70 },
    {
      title: '공급업체', dataIndex: 'supplier_id', width: 120,
      render: (v) => (v ? supplierName[v] ?? `#${v}` : <Tag color="warning">미지정</Tag>),
    },
    { title: '계획 납기', dataIndex: 'planned_lead_time_days', width: 85, align: 'right', render: (v) => `${v}일` },
    { title: '검토 주기', dataIndex: 'review_period_days', width: 85, align: 'right', render: (v) => `${v}일` },
    { title: '최소주문량', dataIndex: 'minimum_order_qty', width: 95, align: 'right', render: fmtNum },
    { title: '주문배수', dataIndex: 'order_multiple', width: 85, align: 'right', render: fmtNum },
    { title: '안전재고', dataIndex: 'safety_stock_qty', width: 85, align: 'right', render: fmtNum },
    { title: '기본전략', dataIndex: 'default_strategy', width: 85, align: 'center', render: (v) => <Tag color="geekblue">{v}</Tag> },
    {
      title: '사용', dataIndex: 'is_active', width: 70, align: 'center',
      render: (v, r) => <Switch size="small" checked={v} onChange={(c) => toggleActive(r, c)} />,
    },
    {
      title: '관리', width: 110,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => openForm(r)}>수정</Button>
          <Popconfirm title="이 상품을 삭제할까요?" description="이력이 있으면 삭제되지 않습니다." onConfirm={() => remove(r)} okText="삭제" cancelText="취소">
            <Button size="small" type="link" danger>삭제</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="상품 관리"
        description="상품 기준정보와 발주 조건(납기·최소주문량·주문배수·안전재고)을 관리합니다."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>상품 등록</Button>}
      />
      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="SKU 또는 상품명 검색"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Segmented
            value={activeFilter}
            onChange={setActiveFilter}
            options={[{ label: '전체', value: 'all' }, { label: '사용', value: 'active' }, { label: '미사용', value: 'inactive' }]}
          />
        </Flex>
        <Table rowKey="product_id" columns={columns} dataSource={rows} loading={loading} size="middle" scroll={{ x: 'max-content' }} />
      </Card>

      <Modal
        title={editing?.product_id ? '상품 수정' : '상품 등록'}
        open={editing !== null}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        okText="저장"
        cancelText="취소"
        width={640}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editing?.product_id ? editing : NEW_PRODUCT_DEFAULTS}
        >
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="sku" label="SKU" rules={[{ required: true, message: 'SKU를 입력하세요.' }]}>
                <Input maxLength={50} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="product_name" label="상품명" rules={[{ required: true, message: '상품명을 입력하세요.' }]}>
                <Input maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="unit" label="단위" rules={[{ required: true }]}>
                <Select options={UNITS.map((u) => ({ value: u, label: u }))} />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name="supplier_id" label="공급업체" extra="미지정 상품은 발주 추천 계산에서 제외됩니다.">
                <Select
                  allowClear
                  placeholder="공급업체 선택"
                  options={data.suppliers.map((s) => ({ value: s.supplier_id, label: s.supplier_name }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left" plain>발주 조건</Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="planned_lead_time_days" label="계획 납기(일)" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="review_period_days" label="발주 검토 주기(일)" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="safety_stock_qty" label="안전재고">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="minimum_order_qty" label="최소 주문량">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="order_multiple" label="주문 배수">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="default_strategy" label="기본 추천 전략">
                <Select options={['P50', 'P70', 'P90'].map((v) => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="is_active" label="사용 여부" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
