"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Mail, Phone, Search, Smartphone } from "lucide-react";
import { Empty, ErrorBox, Loading, MobileSheet, SheetRow } from "./mobile-shared";

// 모바일 담당자 — 전사 담당자(/api/sales/contacts) 클라 검색 → 카드 → 상세 시트(전화·문자·메일 원터치).
// ContactsBoard(데스크톱)와 동일 API·클라 필터 패턴.

interface SalesContact {
  id: number;
  facilityId: string;
  facilityName: string | null;
  departmentName: string | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  duties: string | null;
  status: string;
  deptType: string | null;
}

const DEPT_TYPE_LABEL: Record<string, string> = { contract: "계약", env: "환경" };

export function MobileContacts() {
  const [contacts, setContacts] = useState<SalesContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [engagement, setEngagement] = useState<"" | "contract" | "sales">("");
  const [selected, setSelected] = useState<SalesContact | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = engagement ? `?engagement=${engagement}` : "";
        const res = await fetch(`/api/sales/contacts${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setContacts(Array.isArray(data.contacts) ? data.contacts : []);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engagement]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const active = contacts.filter((c) => c.status !== "inactive");
    if (!s) return active.slice(0, 50);
    return active
      .filter((c) =>
        [c.personName, c.facilityName, c.departmentName, c.title, c.mobilePhone, c.officePhone, c.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(s)
      )
      .slice(0, 100);
  }, [contacts, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 cd-text-faint shrink-0" />
        <input
          className="cd-input flex-1"
          style={{ height: 42 }}
          placeholder="이름·사업장·부서·전화 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {/* 소속 사업장 관계 필터 */}
      <div className="flex items-center gap-1.5">
        {([["", "전체"], ["contract", "용역 진행 중"], ["sales", "영업 진행 중"]] as const).map(([value, label]) => (
          <button
            key={value}
            className={`cd-pill ${engagement === value ? "cd-pill-info" : "cd-pill-outline"}`}
            style={{ paddingTop: 6, paddingBottom: 6 }}
            onClick={() => setEngagement(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <Empty label="표시할 담당자가 없습니다." />
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((c) => (
            <button
              key={c.id}
              className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5 text-left"
              onClick={() => setSelected(c)}
            >
              <div className="flex-1 min-w-0">
                <div className="cd-text text-sm font-bold truncate">
                  {c.personName}
                  {c.title && <span className="cd-text-muted font-normal ml-1.5 text-xs">{c.title}</span>}
                </div>
                <div className="cd-text-faint text-xs truncate">
                  {[c.facilityName, c.departmentName].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {(c.mobilePhone ?? c.officePhone) && (
                <a
                  href={`tel:${c.mobilePhone ?? c.officePhone}`}
                  className="cd-btn cd-btn-soft cd-btn-sm shrink-0"
                  aria-label="전화"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="w-4 h-4" />
                </a>
              )}
              <ChevronRight className="w-4 h-4 cd-text-faint shrink-0" />
            </button>
          ))}
          {!q && contacts.filter((c) => c.status !== "inactive").length > 50 && (
            <p className="cd-text-faint text-xs text-center py-1">최근 50명만 표시 — 검색으로 찾아보세요.</p>
          )}
        </div>
      )}

      {selected && <ContactSheet contact={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ContactSheet({ contact: c, onClose }: { contact: SalesContact; onClose: () => void }) {
  const phone = c.mobilePhone ?? c.officePhone;
  return (
    <MobileSheet title={c.personName} onClose={onClose}>
      {/* 원터치 액션 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <ActionButton href={phone ? `tel:${phone}` : null} icon={<Phone className="w-4 h-4" />} label="전화" />
        <ActionButton href={c.mobilePhone ? `sms:${c.mobilePhone}` : null} icon={<Smartphone className="w-4 h-4" />} label="문자" />
        <ActionButton href={c.email ? `mailto:${c.email}` : null} icon={<Mail className="w-4 h-4" />} label="메일" />
      </div>

      <div className="rounded-xl border cd-border-c px-3 py-1.5">
        <SheetRow label="직급" value={c.title ?? "—"} />
        <SheetRow label="사업장" value={c.facilityName ?? "—"} />
        <SheetRow
          label="부서"
          value={[c.departmentName, c.deptType ? DEPT_TYPE_LABEL[c.deptType] : null].filter(Boolean).join(" · ") || "—"}
        />
        <SheetRow label="휴대폰" value={c.mobilePhone ?? "—"} />
        <SheetRow label="사무실" value={c.officePhone ?? "—"} />
        <SheetRow label="이메일" value={c.email ?? "—"} />
        {c.duties && <SheetRow label="업무" value={c.duties} />}
      </div>
    </MobileSheet>
  );
}

function ActionButton({ href, icon, label }: { href: string | null; icon: React.ReactNode; label: string }) {
  if (!href) {
    return (
      <span className="cd-surface-bg rounded-xl py-2.5 flex flex-col items-center gap-1 opacity-40">
        <span className="cd-text-faint">{icon}</span>
        <span className="cd-text-faint text-xs font-bold">{label}</span>
      </span>
    );
  }
  return (
    <a href={href} className="cd-tint-primary rounded-xl py-2.5 flex flex-col items-center gap-1">
      <span className="cd-text-primary">{icon}</span>
      <span className="cd-text-primary text-xs font-bold">{label}</span>
    </a>
  );
}
