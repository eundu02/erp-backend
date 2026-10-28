import { Tag } from 'antd';

const MAPS = {
  sale: {
    draft: ['작성중', 'default'],
    confirmed: ['확정', 'green'],
    canceled: ['취소', 'red'],
  },
  po: {
    draft: ['작성중', 'default'],
    confirmed: ['발주확정', 'blue'],
    partially_received: ['부분입고', 'orange'],
    completed: ['입고완료', 'green'],
    canceled: ['취소', 'red'],
  },
  receipt: {
    draft: ['작성중', 'default'],
    confirmed: ['입고확정', 'green'],
  },
  movement: {
    sale: ['판매', 'volcano'],
    receipt: ['입고', 'geekblue'],
    adjustment: ['조정', 'purple'],
  },
};

export function statusOptions(kind) {
  return Object.entries(MAPS[kind]).map(([value, [label]]) => ({ value, label }));
}

export default function StatusTag({ kind, value }) {
  const [label, color] = MAPS[kind]?.[value] ?? [value, 'default'];
  return <Tag color={color}>{label}</Tag>;
}
