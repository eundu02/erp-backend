import { useMemo, useState } from 'react';
import { App, Button, Card, Col, Form, Input, Modal, Popconfirm, Row, Space, Switch, Table, Tag } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import { fmtDate } from '../utils';

export default function Suppliers() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi(() => api.get('/suppliers'), [], []);
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState(null); // null: 닫힘, {}: 신규, {supplier_id..}: 수정
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const rows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return data;
    return data.filter((s) => [s.supplier_name, s.contact_name, s.phone, s.email]
      .some((v) => v?.toLowerCase().includes(k)));
  }, [data, keyword]);

  const openForm = (record) => {
    setEditing(record ?? {});
  };

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing.supplier_id) {
        await api.put(`/suppliers/${editing.supplier_id}`, values);
        message.success('공급업체 정보를 수정했습니다.');
      } else {
        await api.post('/suppliers', values);
        message.success('공급업체를 등록했습니다.');
      }
      setEditing(null);
      reload();
    } catch (err) {
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (record) => {
    try {
      await api.del(`/suppliers/${record.supplier_id}`);
      message.success('삭제했습니다.');
      reload();
    } catch (err) {
      message.error(err.status === 409
        ? '상품·발주에 연결된 공급업체는 삭제할 수 없습니다. 대신 비활성화하세요.'
        : err.message);
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'supplier_id', width: 70 },
    { title: '공급업체명', dataIndex: 'supplier_name', sorter: (a, b) => a.supplier_name.localeCompare(b.supplier_name) },
    { title: '담당자', dataIndex: 'contact_name', render: (v) => v || '-' },
    { title: '연락처', dataIndex: 'phone', render: (v) => v || '-' },
    { title: '이메일', dataIndex: 'email', render: (v) => v || '-' },
    { title: '주소', dataIndex: 'address', ellipsis: true, render: (v) => v || '-' },
    {
      title: '상태', dataIndex: 'is_active', width: 90,
      render: (v) => (v ? <Tag color="green">사용</Tag> : <Tag>미사용</Tag>),
    },
    { title: '등록일', dataIndex: 'created_at', width: 110, render: fmtDate },
    {
      title: '관리', width: 120,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => openForm(r)}>수정</Button>
          <Popconfirm title="이 공급업체를 삭제할까요?" onConfirm={() => remove(r)} okText="삭제" cancelText="취소">
            <Button size="small" type="link" danger>삭제</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="공급업체 관리"
        description="발주처(공급업체) 기준정보를 관리합니다."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>공급업체 등록</Button>}
      />
      <Card>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="공급업체명, 담당자, 연락처 검색"
          style={{ width: 320, marginBottom: 16 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Table rowKey="supplier_id" columns={columns} dataSource={rows} loading={loading} size="middle" />
      </Card>

      <Modal
        title={editing?.supplier_id ? '공급업체 수정' : '공급업체 등록'}
        open={editing !== null}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={saving}
        okText="저장"
        cancelText="취소"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={editing?.supplier_id ? editing : { is_active: true }}
        >
          <Form.Item name="supplier_name" label="공급업체명" rules={[{ required: true, message: '공급업체명을 입력하세요.' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="contact_name" label="담당자"><Input maxLength={50} /></Form.Item></Col>
            <Col span={12}><Form.Item name="phone" label="연락처"><Input maxLength={30} /></Form.Item></Col>
          </Row>
          <Form.Item name="email" label="이메일" rules={[{ type: 'email', message: '이메일 형식이 아닙니다.' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="address" label="주소"><Input maxLength={200} /></Form.Item>
          <Form.Item name="is_active" label="사용 여부" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
