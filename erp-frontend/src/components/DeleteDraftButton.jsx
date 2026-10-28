import { useState } from 'react';
import { App, Button, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { api } from '../api/client';

// 작성중(draft) 전표 삭제 버튼. 확정된 전표는 서버가 409로 거부한다(이력 보존 — 취소를 사용).
export default function DeleteDraftButton({ path, description, onDeleted }) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(path);
      message.success('작성중 전표를 삭제했습니다.');
      onDeleted();
    } catch (err) {
      message.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popconfirm
      title="작성중 전표를 삭제할까요?"
      description={description ?? '삭제한 전표는 되돌릴 수 없습니다. 재고에는 영향이 없습니다.'}
      onConfirm={remove}
      okText="삭제"
      okButtonProps={{ danger: true }}
      cancelText="닫기"
    >
      <Button icon={<DeleteOutlined />} loading={busy}>삭제</Button>
    </Popconfirm>
  );
}
