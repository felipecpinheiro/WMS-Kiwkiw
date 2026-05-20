/**
 * WMS Kiwkiw - App Principal
 * Define rotas e layout global da aplicação.
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';

// Pages
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import OrdersPage from './pages/Orders';
import ScannerPage from './pages/Scanner';
import InventoryPage from './pages/Inventory';
import ProductsPage from './pages/Products';
import KitsPage from './pages/Kits';
import BoxAlgorithmPage from './pages/BoxAlgorithm';
import UsersPage from './pages/Users';
import SellersPage from './pages/Sellers';
import BillingPage from './pages/Billing';
import AuditPage from './pages/Audit';
import SettingsPage from './pages/Settings';
import HandlingPage from './pages/Handling';
import SellerPortalPage from './pages/SellerPortal';

// Components
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { background: '#1f2937', color: '#fff' },
          }}
        />
        <Routes>
          {/* Rota pública */}
          <Route path="/login" element={<LoginPage />} />

          {/* Portal do Seller (layout diferente) */}
          <Route
            path="/seller/*"
            element={
              <ProtectedRoute allowedRoles={['seller', 'admin']}>
                <SellerPortalPage />
              </ProtectedRoute>
            }
          />

          {/* Interface de Bipagem (fullscreen) */}
          <Route
            path="/scan/:sessionId"
            element={
              <ProtectedRoute allowedRoles={['admin', 'master', 'operator']}>
                <ScannerPage />
              </ProtectedRoute>
            }
          />

          {/* Rotas protegidas com layout padrão */}
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={['admin', 'master', 'operator']}>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="kits" element={<KitsPage />} />
            <Route path="box-algorithm" element={<BoxAlgorithmPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="sellers" element={<SellersPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="manuseios" element={<HandlingPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
