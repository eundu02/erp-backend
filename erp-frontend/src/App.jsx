import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Suppliers from './pages/Suppliers';
import Inventory from './pages/Inventory';
import StockMovements from './pages/StockMovements';
import Sales from './pages/Sales';
import PurchaseOrders from './pages/PurchaseOrders';
import Receipts from './pages/Receipts';
import Recommendations from './pages/Recommendations';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<Products />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="stock-movements" element={<StockMovements />} />
        <Route path="sales" element={<Sales />} />
        <Route path="purchase-orders" element={<PurchaseOrders />} />
        <Route path="receipts" element={<Receipts />} />
        <Route path="recommendations" element={<Recommendations />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
