import { useLocation, useNavigate } from "react-router-dom";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/ui";
import {
  AdminAppointmentsPage,
  AdminClientDetailPage,
  AdminClientsPage,
  AdminCommissionsPage,
  AdminCouponsPage,
  AdminDashboardPage,
  AdminInventoryPage,
  AdminPaymentsPage,
  AdminPlansPage,
  AdminPromotionsPage,
  AdminProfessionalsPage,
  AdminReportsPage,
  AdminServicesPage,
  AdminSettingsPage,
  AdminSumupPage,
} from "./AdminPortal";
import { ClientNotificationsPage } from "../client/ClientPortal";
import { WhatsAppIntegrationPage } from "../WhatsAppIntegration";

export function AdminArea() {
  const path = useLocation().pathname;
  const navigate = useNavigate();
  let page;
  if (["/admin", "/admin/", "/admin/dashboard"].includes(path))
    page = <AdminDashboardPage />;
  else if (path.match(/\/clientes\/[^/]+$/)) page = <AdminClientDetailPage />;
  else if (path.includes("/clientes")) page = <AdminClientsPage />;
  else if (path.includes("/agenda") || path.includes("/agendamentos"))
    page = <AdminAppointmentsPage />;
  else if (path.includes("/integracoes/sumup")) page = <AdminSumupPage />;
  else if (path.includes("/integracoes/whatsapp"))
    page = <WhatsAppIntegrationPage />;
  else if (path.includes("/pagamentos") || path.includes("/financeiro"))
    page = <AdminPaymentsPage />;
  else if (path.includes("/planos")) page = <AdminPlansPage />;
  else if (path.includes("/marketing/promocoes") || path.includes("/promocoes"))
    page = <AdminPromotionsPage />;
  else if (path.includes("/cupons"))
    page = <AdminCouponsPage />;
  else if (path.includes("/profissionais")) page = <AdminProfessionalsPage />;
  else if (path.includes("/servicos")) page = <AdminServicesPage />;
  else if (path.includes("/estoque")) page = <AdminInventoryPage />;
  else if (path.includes("/notificacoes")) page = <ClientNotificationsPage />;
  else if (path.includes("/comissoes")) page = <AdminCommissionsPage />;
  else if (path.includes("/relatorios")) page = <AdminReportsPage />;
  else if (path.includes("/configuracoes") || path.includes("/perfil"))
    page = <AdminSettingsPage />;
  else
    page = (
      <EmptyState
        title="Página não encontrada"
        text="Este endereço não existe na área administrativa."
        action={
          <button onClick={() => navigate("/admin/dashboard")} className="btn-primary">
            Voltar ao dashboard
          </button>
        }
      />
    );
  return <AppShell role="admin">{page}</AppShell>;
}
