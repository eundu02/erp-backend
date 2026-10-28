import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Breadcrumb, Flex, Grid, Layout, Menu, Tag, Typography } from 'antd';
import {
  AppstoreOutlined,
  BulbOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  HistoryOutlined,
  InboxOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  SolutionOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { CURRENT_USER } from '../config';

const { Sider, Header, Content } = Layout;

const MENU = [
  { key: '/', icon: <DashboardOutlined />, label: '대시보드' },
  {
    key: 'master', icon: <AppstoreOutlined />, label: '기준정보',
    children: [
      { key: '/products', label: '상품 관리' },
      { key: '/suppliers', label: '공급업체 관리' },
    ],
  },
  {
    key: 'stock', icon: <DatabaseOutlined />, label: '재고관리',
    children: [
      { key: '/inventory', label: '재고 현황' },
      { key: '/stock-movements', label: '재고 변동 이력' },
    ],
  },
  { key: '/sales', icon: <ShopOutlined />, label: '판매 관리' },
  { key: '/recommendations', icon: <BulbOutlined />, label: '발주 추천' },
  {
    key: 'purchase', icon: <ShoppingCartOutlined />, label: '구매관리',
    children: [
      { key: '/purchase-orders', label: '발주 관리' },
      { key: '/receipts', label: '입고 관리' },
    ],
  },
];

// 경로 → [상위 메뉴, 화면명] (브레드크럼용)
const TITLES = {
  '/': ['홈', '대시보드'],
  '/products': ['기준정보', '상품 관리'],
  '/suppliers': ['기준정보', '공급업체 관리'],
  '/inventory': ['재고관리', '재고 현황'],
  '/stock-movements': ['재고관리', '재고 변동 이력'],
  '/sales': ['판매', '판매 관리'],
  '/purchase-orders': ['구매관리', '발주 관리'],
  '/receipts': ['구매관리', '입고 관리'],
  '/recommendations': ['구매관리', '발주 추천'],
};

const PARENT_OF = { '/products': 'master', '/suppliers': 'master', '/inventory': 'stock', '/stock-movements': 'stock', '/purchase-orders': 'purchase', '/receipts': 'purchase' };

export default function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState(['master', 'stock', 'purchase']);
  const [section, page] = TITLES[pathname] ?? ['', ''];
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        breakpoint="lg"
        collapsedWidth={mobile ? 0 : 80}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <Flex
          align="center"
          gap={10}
          style={{ height: 64, padding: collapsed ? '0 24px' : '0 20px', cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
          <InboxOutlined style={{ fontSize: 22, color: '#60a5fa' }} />
          {!collapsed && (
            <Typography.Text strong style={{ color: '#fff', fontSize: 16, whiteSpace: 'nowrap' }}>
              재고·발주 ERP
            </Typography.Text>
          )}
        </Flex>
        <Menu
          theme="dark"
          mode="inline"
          items={MENU}
          selectedKeys={[pathname]}
          openKeys={collapsed ? undefined : openKeys}
          onOpenChange={setOpenKeys}
          onClick={({ key }) => { navigate(key); if (mobile) setCollapsed(true); }}
          defaultOpenKeys={[PARENT_OF[pathname]].filter(Boolean)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            padding: mobile ? '0 16px 0 56px' : '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, zIndex: 10,
          }}
        >
          <Breadcrumb items={[{ title: <SolutionOutlined /> }, { title: section }, { title: page }]} />
          <Flex align="center" gap={8}>
            {!mobile && <Tag color="blue">{CURRENT_USER.role}</Tag>}
            <Avatar size="small" icon={<UserOutlined />} style={{ background: '#1d4ed8' }} />
            <Typography.Text>{CURRENT_USER.full_name}</Typography.Text>
          </Flex>
        </Header>
        <Content style={{ padding: mobile ? 12 : 24 }}>
          <Outlet />
        </Content>
        <Layout.Footer style={{ textAlign: 'center', color: '#94a3b8', padding: '12px 24px' }}>
          재고·발주 ERP v1 · <HistoryOutlined /> 판매 확정·입고 확정 시점에만 재고가 변동됩니다
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
