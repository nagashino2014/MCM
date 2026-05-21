import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  label: string;
  value: number | string;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  emphasis?: boolean;
}

export function KpiCard({ label, value, unit, hint, icon: Icon, emphasis }: KpiCardProps) {
  if (emphasis) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-primary/15 via-white/70 to-white/40 border border-white/70 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold text-primary uppercase tracking-wide">{label}</div>
          {Icon && <Icon className="w-3.5 h-3.5 text-primary/80" />}
        </div>
        <div className="text-3xl font-extrabold text-stone-900 mt-1 leading-tight">
          {value}
          {unit && <span className="text-base ml-1 font-bold text-stone-500">{unit}</span>}
        </div>
        {hint && <div className="text-[10px] text-stone-500 font-medium mt-0.5">{hint}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white/60 border border-white/70 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{label}</div>
        {Icon && <Icon className="w-3 h-3 text-stone-400" />}
      </div>
      <div className="text-2xl font-extrabold text-stone-800 mt-1">
        {value}
        {unit && <span className="text-sm ml-0.5 font-bold text-stone-500">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] text-stone-400 font-medium mt-0.5">{hint}</div>}
    </div>
  );
}
