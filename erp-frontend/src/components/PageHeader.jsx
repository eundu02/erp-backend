import { Flex, Typography } from 'antd';

export default function PageHeader({ title, description, extra }) {
  return (
    <Flex justify="space-between" align="flex-end" style={{ marginBottom: 16 }} wrap gap={12}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>{title}</Typography.Title>
        {description && (
          <Typography.Text type="secondary">{description}</Typography.Text>
        )}
      </div>
      {extra && <Flex gap={8}>{extra}</Flex>}
    </Flex>
  );
}
