import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type MobileAgendaAction = {
  label: string;
  icon: ReactNode;
  to?: string;
  onClick?: () => void;
};

export function MobileAgendaActions({ items }: { items: MobileAgendaAction[] }) {
  return (
    <nav aria-label="Atalhos da agenda" className="no-scrollbar mb-4 flex gap-2 overflow-x-auto sm:hidden">
      {items.map((item) => {
        const content = <><span className="text-champagne">{item.icon}</span><span>{item.label}</span></>;
        const className = "flex min-h-[76px] min-w-[88px] flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-black/[.06] bg-white px-2 text-center text-[10px] font-bold shadow-card";
        return item.to ? <Link key={item.label} to={item.to} className={className}>{content}</Link> : <button key={item.label} type="button" onClick={item.onClick} className={className}>{content}</button>;
      })}
    </nav>
  );
}
