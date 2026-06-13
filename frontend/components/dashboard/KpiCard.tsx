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
      <div className="rounded-2xl cd-tint-primary border cd-border-c p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold cd-text-primary uppercase tracking-wide">{label}</div>
          {Icon && <Icon className="w-3.5 h-3.5 cd-text-primary" />}
        </div>
        <div className="text-3xl font-extrabold cd-text mt-1 leading-tight">
          {value}
          {unit && <span className="text-base ml-1 font-bold cd-text-faint">{unit}</span>}
        </div>
        {hint && <div className="text-[10px] cd-text-faint font-medium mt-0.5">{hint}</div>}
      </div>
    );
  }

  return (
    <div className="rounded-xl cd-surface-bg border cd-border-c p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">{label}</div>
        {Icon && <Icon className="w-3 h-3 cd-text-faint" />}
      </div>
      <div className="text-2xl font-extrabold cd-text mt-1">
        {value}
        {unit && <span className="text-sm ml-0.5 font-bold cd-text-faint">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] cd-text-faint font-medium mt-0.5">{hint}</div>}
    </div>
  );
}
