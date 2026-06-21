import { ReactNode, useEffect } from 'react'
import { Check, ChevronRight, LoaderCircle, X } from 'lucide-react'

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" aria-label="Carol Sol">
      <div className={`grid h-10 w-10 place-items-center rounded-full border font-display text-sm font-semibold tracking-[-.08em] ${light ? 'border-white/20 text-champagne' : 'border-champagne/30 text-champagne'}`}>CS</div>
      {!compact && <div className="leading-none"><div className={`font-display text-[22px] font-semibold tracking-[.16em] ${light ? 'text-white' : 'text-ink'}`}>CAROL SOL</div><div className={`mt-1 text-[7px] font-semibold tracking-[.33em] ${light ? 'text-white/50' : 'text-stone-400'}`}>MEGA HAIR PREMIUM</div></div>}
    </div>
  )
}

export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>{eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}<h1 className="section-title">{title}</h1>{subtitle && <p className="muted mt-2 max-w-2xl">{subtitle}</p>}</div>
      {action}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'gold' | 'green' | 'amber' | 'rose' | 'black' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600', gold: 'bg-champagne/15 text-[#8d6929]', green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700', black: 'bg-ink text-white'
  }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold ${tones[tone]}`}>{children}</span>
}

export function Avatar({ src, name, size = 'md' }: { src?: string; name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-9 w-9 text-xs', md: 'h-11 w-11 text-sm', lg: 'h-16 w-16 text-lg' }
  return src ? <img src={src} alt={name} className={`${sizes[size]} shrink-0 rounded-full object-cover ring-2 ring-white`} /> : <div className={`${sizes[size]} grid shrink-0 place-items-center rounded-full bg-warm font-bold text-champagne`}>{name.split(' ').map(n => n[0]).slice(0, 2).join('')}</div>
}

export function StatCard({ label, value, trend, icon, tone = 'light' }: { label: string; value: string; trend?: string; icon?: ReactNode; tone?: 'light' | 'dark' | 'gold' }) {
  const styles = tone === 'dark' ? 'hair-gradient text-white border-transparent' : tone === 'gold' ? 'bg-[#cda75c] text-white border-transparent' : 'bg-white text-ink border-black/[.06]'
  return <div className={`rounded-[22px] border p-5 shadow-card ${styles}`}><div className="mb-4 flex items-center justify-between"><span className={`text-xs font-semibold ${tone === 'light' ? 'text-stone-500' : 'text-white/65'}`}>{label}</span>{icon && <span className={tone === 'light' ? 'text-champagne' : 'text-white/80'}>{icon}</span>}</div><div className="font-display text-3xl font-semibold">{value}</div>{trend && <div className={`mt-1.5 text-[11px] font-semibold ${tone === 'light' ? 'text-emerald-600' : 'text-white/65'}`}>{trend}</div>}</div>
}

export function SectionHeading({ title, link, onClick }: { title: string; link?: string; onClick?: () => void }) {
  return <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>{link && <button onClick={onClick} className="flex items-center gap-1 text-xs font-bold text-champagne">{link}<ChevronRight size={14} /></button>}</div>
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!open) return null
  return <div className="fixed inset-0 z-[80] grid items-end bg-black/40 p-0 backdrop-blur-sm sm:place-items-center sm:p-5" onMouseDown={e => e.target === e.currentTarget && onClose()}><div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-[30px] bg-cream p-6 shadow-2xl animate-fade-up sm:rounded-[30px]"><div className="mb-5 flex items-center justify-between">{title && <h2 className="font-display text-2xl font-semibold">{title}</h2>}<button onClick={onClose} aria-label="Fechar" className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-white text-stone-500"><X size={18} /></button></div>{children}</div></div>
}

export function Toast({ message, show }: { message: string; show: boolean }) {
  return <div className={`fixed left-1/2 top-5 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white shadow-2xl transition ${show ? 'translate-y-0 opacity-100' : '-translate-y-4 pointer-events-none opacity-0'}`}><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500"><Check size={14} /></span>{message}</div>
}

export function LoadingState() {
  return <div className="grid min-h-[320px] place-items-center"><div className="text-center"><LoaderCircle className="mx-auto animate-spin text-champagne" /><div className="mt-3 text-sm text-stone-500">Preparando sua experiência…</div></div></div>
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="surface grid min-h-[260px] place-items-center p-8 text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-warm font-display text-2xl text-champagne">L</div><h3 className="font-display text-2xl font-semibold">{title}</h3><p className="muted mx-auto mt-2 max-w-sm">{text}</p>{action && <div className="mt-5">{action}</div>}</div></div>
}
