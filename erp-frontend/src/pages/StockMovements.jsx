import { useState } from 'react';
import { Alert, Card, Flex, Select } from 'antd';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import PageHeader from '../components/PageHeader';
import MovementTable from '../components/MovementTable';
import { statusOptions } from '../components/StatusTag';

export default function StockMovements() {
  const [productId, setProductId] = useState();
  const [type, setType] = useState();
  const products = useApi(() => api.get('/products'), [], []);
  const { data = [], loading } = useApi(
    () => api.get('/stock-movements', { product_id: productId, movement_type: type, limit: 1000 }),
    [productId, type],
    []
  );

  return (
    <>
      <PageHeader title="재고 변동 이력" description="모든 재고 증감의 원장(append-only)입니다. 확정된 이력은 수정·삭제되지 않습니다." />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="재고는 판매 확정(−)과 입고 확정(+) 시점에만 변동되며, 판매 취소는 반대 부호(+) 행이 새로 추가됩니다."
      />
      <Card>
        <Flex gap={12} wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            showSearch
            placeholder="상품 선택"
            style={{ width: 280 }}
            value={productId}
            onChange={setProductId}
            optionFilterProp="label"
            options={products.data.map((p) => ({ value: p.product_id, label: `${p.sku} · ${p.product_name}` }))}
          />
          <Select
            allowClear
            placeholder="변동 유형"
            style={{ width: 160 }}
            value={type}
            onChange={setType}
            options={statusOptions('movement').filter((o) => o.value !== 'adjustment')}
          />
        </Flex>
        <MovementTable data={data} loading={loading} />
      </Card>
    </>
  );
}
