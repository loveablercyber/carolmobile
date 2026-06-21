import { ReactNode, useMemo, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Award, BarChart3, Bell, Boxes, BriefcaseBusiness, CalendarDays, ChevronDown, CircleUserRound,
  ClipboardList, CreditCard, Gift, Heart, Home, LayoutDashboard, LogOut, Megaphone, Menu, PackageOpen,
  Scissors, Search, Settings, Sparkles, Star, Tags, UserRound, Users, WalletCards, X
} from 'lucide-react'
import { notifications } from '../data/mock'
import { Avatar, Badge, Logo } from './ui'

export type Role = 'cliente' | 'profissional' | 'admin'

const roleNav = {
  cliente: [
    { label: 'Início', path: '/cliente/inicio', icon: Home }, { label: 'Descobrir', path: '/cliente/descobrir', icon: Sparkles },
    { label: 'Agenda', path: '/cliente/agenda', icon: CalendarDays }, { label: 'Benefícios', path: '/cliente/beneficios', icon: Gift },
    { label: 'Perfil', path: '/cliente/perfil', icon: CircleUserRound }
  ],
  profissional: [
    { label: 'Hoje', path: '/profissional/hoje', icon: Home }, { label: 'Agenda', path: '/profissional/agenda', icon: CalendarDays },
    { label: 'Clientes', path: '/profissional/clientes', icon: Users }, { label: 'Fichas técnicas', path: '/profissional/fichas', icon: ClipboardList },
    { label: 'Serviços', path: '/profissional/servicos', icon: Scissors }, { label: 'Comissão', path: '/profissional/comissao', icon: WalletCards },
    { label: 'Desempenho', path: '/profissional/desempenho', icon: BarChart3 }, { label: 'Perfil', path: '/profissional/perfil', icon: UserRound }
  ],
  admin: [
    { label: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard }, { label: 'Agenda', path: '/admin/agenda', icon: CalendarDays },
    { label: 'Clientes', path: '/admin/clientes', icon: Users }, { label: 'Profissionais', path: '/admin/profissionais', icon: BriefcaseBusiness },
    { label: 'Serviços e métodos', path: '/admin/servicos', icon: Scissors }, { label: 'Estoque', path: '/admin/estoque', icon: Boxes },
    { label: 'Financeiro', path: '/admin/financeiro', icon: CreditCard }, { label: 'Comissões', path: '/admin/comissoes', icon: WalletCards },
    { label: 'Marketing', path: '/admin/marketing', icon: Megaphone }, { label: 'Promoções', path: '/admin/promocoes', icon: Tags },
    { label: 'Fidelidade', path: '/admin/fidelidade', icon: Award }, { label: 'Relatórios', path: '/admin/relatorios', icon: BarChart3 },
    { label: 'Configurações', path: '/admin/configuracoes', icon: Settings }
  ]
}

const identities = {
  cliente: { name: 'Juliana Mendes', detail: 'Cliente Gold', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=200&q=80' },
  profissional: { name: 'Juliana Almeida', detail: 'Especialista sênior', image: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=200&q=80' },
  admin: { name: 'Carolina Alves', detail: 'Administradora', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80' }
}

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const [mobileMenu, setMobileMenu] = useState(false)
  const [alerts, setAlerts] = useState(false)
  const navigate = useNavigate(); const location = useLocation()
  const nav = roleNav[role]; const identity = identities[role]
  const mobileNav = role === 'admin' ? nav.slice(0, 5) : role === 'profissional' ? nav.slice(0, 5) : nav
  const title = useMemo(() => nav.find(n => location.pathname.startsWith(n.path))?.label ?? 'Luxe Hair', [location.pathname, nav])

  const sidebar = (
    <aside className="flex h-full flex-col bg-ink text-white">
      <div className="px-6 pb-8 pt-7"><Logo light /></div>
      <nav className="no-scrollbar flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {nav.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} onClick={() => setMobileMenu(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-2xl px-4 py-3 text-[13px] font-semibold transition ${isActive ? 'bg-white text-ink shadow-lg' : 'text-white/55 hover:bg-white/[.07] hover:text-white'}`}><Icon size={18} /><span>{label}</span></NavLink>)}
      </nav>
      <button onClick={() => navigate('/entrar')} className="m-4 flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 text-left"><Avatar src={identity.image} name={identity.name} size="sm" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{identity.name}</span><span className="block truncate text-[10px] text-white/45">{identity.detail}</span></span><LogOut size={16} className="text-white/45" /></button>
    </aside>
  )

  return <div className="min-h-screen bg-cream">
    <div className={`fixed inset-0 z-[70] transition lg:hidden ${mobileMenu ? 'pointer-events-auto bg-black/40' : 'pointer-events-none bg-transparent'}`} onClick={() => setMobileMenu(false)}><div onClick={e => e.stopPropagation()} className={`h-full w-[286px] shadow-2xl transition-transform ${mobileMenu ? 'translate-x-0' : '-translate-x-full'}`}>{sidebar}</div></div>
    <div className="fixed inset-y-0 left-0 hidden w-[260px] lg:block">{sidebar}</div>
    <div className="lg:pl-[260px]">
      <header className="glass sticky top-0 z-40 flex h-[74px] items-center border-b border-black/[.05] px-4 sm:px-7 lg:px-10">
        <button aria-label="Abrir menu" onClick={() => setMobileMenu(true)} className="mr-3 grid h-10 w-10 place-items-center rounded-xl bg-white lg:hidden"><Menu size={20} /></button>
        <div className="lg:hidden"><Logo compact /></div><div className="hidden lg:block"><span className="text-xs font-semibold text-stone-400">Luxe Hair / </span><span className="text-xs font-bold">{title}</span></div>
        <div className="ml-auto flex items-center gap-2">
          <button className="hidden h-10 items-center gap-2 rounded-xl border border-black/[.06] bg-white px-3 text-xs text-stone-500 sm:flex"><Search size={16} />Buscar <kbd className="ml-4 rounded bg-stone-100 px-1.5 py-0.5 text-[9px]">⌘K</kbd></button>
          <div className="relative"><button onClick={() => setAlerts(!alerts)} aria-label="Notificações" className="relative grid h-10 w-10 place-items-center rounded-xl border border-black/[.06] bg-white"><Bell size={18} /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-champagne ring-2 ring-white" /></button>
            {alerts && <div className="absolute right-0 top-12 w-[min(350px,calc(100vw-24px))] rounded-[24px] border border-black/[.06] bg-white p-4 shadow-2xl"><div className="mb-3 flex items-center justify-between"><h3 className="font-display text-xl font-semibold">Notificações</h3><Badge tone="gold">2 novas</Badge></div>{notifications.map((n, i) => <div key={i} className="flex gap-3 border-t border-black/[.05] py-3 first:border-0"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.unread ? 'bg-champagne' : 'bg-stone-200'}`} /><div><div className="text-xs font-bold">{n.title}</div><div className="mt-1 text-[11px] leading-relaxed text-stone-500">{n.text}</div></div><span className="ml-auto shrink-0 text-[9px] text-stone-400">{n.time}</span></div>)}</div>}
          </div>
          <button onClick={() => navigate(`/${role}/perfil`)} className="hidden items-center gap-2 rounded-xl bg-white py-1.5 pl-1.5 pr-3 sm:flex"><Avatar src={identity.image} name={identity.name} size="sm" /><span className="text-left"><span className="block text-[11px] font-bold">{identity.name}</span><span className="block text-[9px] text-stone-400">{identity.detail}</span></span><ChevronDown size={14} /></button>
        </div>
      </header>
      <main className="safe-bottom mx-auto max-w-[1500px] p-4 sm:p-7 lg:p-10">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-50 grid border-t border-black/[.06] bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_35px_rgba(0,0,0,.06)] backdrop-blur-xl lg:hidden" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0, 1fr))` }}>
      {mobileNav.map(({ label, path, icon: Icon }) => <NavLink key={path} to={path} className={({ isActive }) => `flex min-w-0 flex-col items-center gap-1 py-2.5 text-[9px] font-bold transition ${isActive ? 'text-champagne' : 'text-stone-400'}`}><Icon size={19} /><span className="max-w-full truncate px-1">{label}</span></NavLink>)}
    </nav>
  </div>
}
