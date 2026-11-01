"use client";

// RAG & 영업 발굴 공용 표시 부품 — 기존 RagBoard·Salesboard 화면 문법(둥근 카드·틴트 아이콘 머리·굵은 숫자·
// 테두리 타일·색 pill)을 새 탭에서도 그대로 쓰기 위한 얇은 래퍼. 색은 cdash 토큰만 쓴다.

import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** 섹션 카드 — 틴트 아이콘 + 굵은 제목 + 건수 pill + 한 줄 설명, 오른쪽 동작. */
export function IntelCard({ icon: Icon, title, desc, count, actions, children, className = "", tone = "var(--cd-primary)" }: {
  icon?: LucideIcon; title: ReactNode; desc?: ReactNode; count?: ReactNode; actions?: ReactNode;
  children?: ReactNode; className?: string; tone?: string;
}) {
  return (
    <section className={`cd-card-bg rounded-2xl border cd-border-c p-4 min-w-0 ${className}`}>
      <div className="flex items-start gap-2 mb-3 flex-wrap">
        {Icon && (
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl shrink-0" style={{ background: `color-mix(in srgb, ${tone} 12%, var(--cd-card))`, color: tone }}>
            <Icon className="w-4 h-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="cd-text text-[0.95rem] font-extrabold leading-tight">{title}</h2>
            {count != null && count !== "" && <span className="cd-pill cd-pill-info">{count}</span>}
          </div>
          {desc && <p className="cd-text-muted text-xs mt-0.5">{desc}</p>}
        </div>
        {actions && <div className="flex items-center gap-1.5 flex-wrap">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Salesboard KPI 칸과 같은 모양 — 색 아이콘 칩 + 굵은 숫자 + 보조 설명. onClick 이 있으면 누를 수 있다. */
export function IntelKpi({ icon: Icon, color, label, value, sub, onClick, active }: {
  icon: LucideIcon; color: string; label: string; value: ReactNode; sub?: string; onClick?: () => void; active?: boolean;
}) {
  const body = (
    <span className="flex flex-col gap-1.5 min-w-0 flex-1">
      <span className="flex items-center gap-2 min-w-0">
        <span className="w-6 h-6 rounded-md inline-flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 14%, var(--cd-card))`, color }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="cd-text-muted text-[11.5px] font-bold truncate">{label}</span>
      </span>
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="cd-text text-xl font-extrabold leading-none">{value}</span>
        {sub && <span className="cd-text-faint text-[11px] truncate" title={sub}>{sub}</span>}
      </span>
    </span>
  );
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c min-w-0" style={active ? { borderColor: "var(--cd-primary)" } : undefined}>
      {onClick
        ? <button type="button" className="cd-row-hover w-full h-full text-left rounded-2xl px-3 py-2.5 flex items-center gap-3 min-w-0" aria-pressed={active} onClick={onClick}>{body}</button>
        : <div className="px-3 py-2.5 flex items-center gap-3 min-w-0">{body}</div>}
    </div>
  );
}

/** 목록 타일 — 테두리 둥근 행. 누르면 상세. active 는 선택 표시(남색 테두리). */
export function IntelTile({ onClick, active, children, className = "", style }: { onClick?: () => void; active?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  const cls = `w-full rounded-xl border cd-border-c px-3 py-2.5 text-left min-w-0 ${onClick ? "cd-row-hover" : ""} ${className}`;
  const merged = { ...(active ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)" } : null), ...style };
  return onClick
    ? <button type="button" className={cls} style={merged} aria-current={active || undefined} onClick={onClick}>{children}</button>
    : <div className={cls} style={merged}>{children}</div>;
}

/** 진행 막대 — 벡터 DB 적재 현황과 같은 둥근 막대. */
export function IntelBar({ value, max, height = 6, color = "var(--cd-primary)" }: { value: number; max: number; height?: number; color?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="rounded-full overflow-hidden flex-1" style={{ height, background: "var(--cd-surface)" }} aria-hidden>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: height }} />
    </div>
  );
}

export function IntelEmpty({ children }: { children: ReactNode }) {
  return <div className="cd-text-faint text-sm p-4 text-center rounded-xl border cd-border-c">{children}</div>;
}

export function IntelError({ children }: { children: ReactNode }) {
  return <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm" role="alert">{children}</div>;
}

export function IntelNotice({ children }: { children: ReactNode }) {
  return <div className="cd-tint-primary rounded-xl px-4 py-3 text-sm cd-text">{children}</div>;
}

/** 소제목(카드·드로어 안 구획). */
export function IntelSubhead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h3 className="cd-text text-[13px] font-extrabold">{children}</h3>
      {right}
    </div>
  );
}

/** 칩 필터(카드 안 목록 좁히기) — 기존 IntelBoard 소스 탭과 같은 cd-chip. */
export function IntelChips<K extends string>({ items, active, onChange }: { items: Array<{ key: K; label: ReactNode }>; active: K; onChange: (key: K) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {items.map((item) => (
        <button key={item.key} type="button" className="cd-chip cd-chip-sm" data-active={item.key === active} aria-pressed={item.key === active} onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 단계·상태 pill 클래스. */
export function stagePillClass(stage: string | null | undefined): string {
  if (stage === "canceled") return "cd-pill cd-pill-error";
  if (stage === "delayed" || stage === "suspended") return "cd-pill cd-pill-warn";
  if (stage === "construction" || stage === "operating" || stage === "approved") return "cd-pill cd-pill-success";
  if (stage === "permitting" || stage === "announced" || stage === "mou") return "cd-pill cd-pill-info";
  return "cd-pill cd-pill-idle";
}
