import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/routes/staff/app-shell';
import { HomePlaceholder } from '@/routes/staff/home-placeholder';
import { LoginPage } from '@/routes/staff/login';
import { MenuPage } from '@/routes/staff/menu-page';
import { OrderDetailPage } from '@/routes/staff/order-detail-page';
import { OrdersPage } from '@/routes/staff/orders-page';
import { SelectTenantPage } from '@/routes/staff/select-tenant';
import { SetupPage } from '@/routes/staff/setup';
import { TablesPage } from '@/routes/staff/tables-page';
import { TablesQrPage } from '@/routes/staff/tables-qr-page';
import { UsersPage } from '@/routes/staff/users-page';
import { LandingPage } from '@/routes/public/landing';
import { SignupPage } from '@/routes/public/signup';
import { ProtectedRoute } from '@/features/auth/protected-route';

/**
 * Gate 3 (login, tenant selection, users) + Gate 4 (tables, QR sheet) +
 * Gate 5 (menu catalog) + Gate 6 (orders) routes, plus self-service
 * onboarding (docs/IMPLEMENTATION_STATUS.md "Onboarding" section: `/`
 * landing, `/signup`, `/app/setup`). `/t/*` `/o/*` (public QR ordering)
 * don't exist yet — that's Gate 11. `/app/counter` (the fuller table-grid
 * + menu-picker order-taking floor view) is a later polish pass — Gate 6's
 * `/app/orders` covers list/create/detail/transition/cancel/reopen, which
 * is everything that gate's task brief asked for. Kitchen/Billing/
 * Payments/Public Ordering remain unbuilt (blocked pending Gate 7).
 */
export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/app/login" element={<LoginPage />} />
      <Route path="/app/select-tenant" element={<SelectTenantPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<HomePlaceholder />} />
          <Route path="settings/users" element={<UsersPage />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="tables/qr" element={<TablesQrPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
        </Route>
        {/* Outside AppShell (no nav/logout chrome) — a focused first-run
            screen, not a dashboard tab (task instruction section 13). */}
        <Route path="/app/setup" element={<SetupPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/app/login" replace />} />
    </Routes>
  );
}
