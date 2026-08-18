"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Search, X, Building2, Phone, Smartphone, Mail, Briefcase } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

// API 응답 shape(서버 queries.ts SalesContact와 동일).
interface SalesContact {
  id: number;
  facilityId: string;
  facilityName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  duties: string | null;
  status: string;
  deptType: string | null;
  appointedAt: string | null;
  transferredAt: string | null;
  resignedAt: string | null;
  updatedAt: string;
}

const DEPT_TYPE_LABEL: Record<string, string> = { contract: "계약", env: "환경", billing: "계산서" };
const DEPT_TYPE_PILL: Record<string, string> = { contract: "cd-pill-info", env: "cd-pill-success", billing: "cd-pill-warn" };

function DeptTypeTag({ deptType }: { deptType: string | null }) {
  if (!deptType || !DEPT_TYPE_LABEL[deptType]) return <span className="cd-text-faint">—</span>;
  return <span className={`cd-pill ${DEPT_TYPE_PILL[deptType] ?? "cd-pill-idle"}`}>{DEPT_TYPE_LABEL[deptType]}</span>;
}

function StatusTag({ status }: { status: string }) {
  const active = status !== "inactive";
  return <span className={`cd-pill ${active ? "cd-pill-success" : "cd-pill-idle"}`}>{active ? "재직" : "퇴사"}</span>;
}

export function ContactsBoard() {
  const { theme } = useCdashTheme();
  const [contacts, setContacts] = useState<SalesContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SalesContact | null>(null);

  const [q, setQ] = useState("");
  const [deptType, setDeptType] = useState("");
  const [status, setStatus] = useState("");
  const [engagement, setEngagement] = useState(""); // '' | contract | sales — 소속 사업장 관계

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = engagement ? `?engagement=${engagement}` : "";
      const res = await fetch(`/api/sales/contacts${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [engagement]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (deptType && c.deptType !== deptType) return false;
      if (status && (status === "active" ? c.status === "inactive" : c.status !== "inactive")) return false;
      if (s) {
        const hay = [c.personName, c.facilityName, c.departmentName, c.title, c.officePhone, c.mobilePhone, c.email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [contacts, q, deptType, status]);

  const hasFilter = !!(q || deptType || status || engagement);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Users className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="담당자 정보 관리"
        titleSuffix={`${filtered.length}명${hasFilter ? ` / ${contacts.length}` : ""}`}
        subtitle="전 사업장 담당자를 한 곳에서 조회합니다. 명함 촬영·통합 타임라인은 준비 중입니다."
      />

      {/* 툴바 */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5">
          <Search className="w-4 h-4 cd-text-faint" />
          <input
            className="cd-input"
            style={{ width: 240 }}
            placeholder="이름·사업장·부서·전화·이메일 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="cd-select" style={{ width: "auto" }} value={deptType} onChange={(e) => setDeptType(e.target.value)}>
          <option value="">부서유형 전체</option>
          <option value="contract">계약</option>
          <option value="env">환경</option>
          <option value="billing">계산서</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">재직상태 전체</option>
          <option value="active">재직</option>
          <option value="inactive">퇴사</option>
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={engagement} onChange={(e) => setEngagement(e.target.value)}>
          <option value="">관계 전체</option>
          <option value="contract">용역 진행 중</option>
          <option value="sales">영업 진행 중</option>
        </select>
        {hasFilter && (
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setQ(""); setDeptType(""); setStatus(""); setEngagement(""); }}>
            <X className="w-3.5 h-3.5" /> 초기화
          </button>
        )}
      </div>

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="cd-text-faint text-sm p-6 text-center cd-card-bg rounded-2xl border cd-border-c">
          표시할 담당자가 없습니다.
        </div>
      ) : (
        <div className="cd-card-bg rounded-2xl border cd-border-c overflow-hidden">
          <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>직급</th>
                  <th>사업장</th>
                  <th>부서</th>
                  <th>부서유형</th>
                  <th>휴대폰</th>
                  <th>사무실</th>
                  <th>이메일</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                    <td className="cd-text font-bold">{c.personName}</td>
                    <td className="cd-text-muted">{c.title ?? "—"}</td>
                    <td className="cd-text-muted">{c.facilityName ?? "—"}</td>
                    <td className="cd-text-muted">{c.departmentName ?? "—"}</td>
                    <td><DeptTypeTag deptType={c.deptType} /></td>
                    <td className="cd-text-muted tabular-nums">{c.mobilePhone ?? "—"}</td>
                    <td className="cd-text-muted tabular-nums">{c.officePhone ?? "—"}</td>
                    <td className="cd-text-muted">{c.email ?? "—"}</td>
                    <td><StatusTag status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <ContactDetailModal theme={theme} contact={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ContactDetailModal({ theme, contact, onClose }: { theme: string; contact: SalesContact; onClose: () => void }) {
  const c = contact;
  const Row = ({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) => (
    <div className="flex items-start gap-2 py-1.5">
      <span className="cd-text-faint text-xs shrink-0 flex items-center gap-1" style={{ width: 84 }}>
        {icon}{label}
      </span>
      <span className="cd-text text-sm flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 440, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="cd-text text-lg font-extrabold truncate">{c.personName}</h3>
            {c.title && <span className="cd-text-muted text-sm shrink-0">{c.title}</span>}
            <StatusTag status={c.status} />
          </div>
          <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="rounded-xl border cd-border-c px-3 py-1.5 mb-3">
          <Row icon={<Building2 className="w-3.5 h-3.5" />} label="사업장" value={c.facilityName ?? "—"} />
          <Row label="부서" value={<span className="inline-flex items-center gap-1.5">{c.departmentName ?? "—"} <DeptTypeTag deptType={c.deptType} /></span>} />
          <Row icon={<Smartphone className="w-3.5 h-3.5" />} label="휴대폰" value={c.mobilePhone ?? "—"} />
          <Row icon={<Phone className="w-3.5 h-3.5" />} label="사무실" value={c.officePhone ?? "—"} />
          <Row icon={<Mail className="w-3.5 h-3.5" />} label="이메일" value={c.email ?? "—"} />
          <Row icon={<Briefcase className="w-3.5 h-3.5" />} label="업무" value={c.duties ?? "—"} />
        </div>

        {(c.appointedAt || c.transferredAt || c.resignedAt) && (
          <div className="rounded-xl border cd-border-c px-3 py-1.5 mb-3">
            {c.appointedAt && <Row label="선임일" value={c.appointedAt.slice(0, 10)} />}
            {c.transferredAt && <Row label="부서변경" value={c.transferredAt.slice(0, 10)} />}
            {c.resignedAt && <Row label="퇴사일" value={c.resignedAt.slice(0, 10)} />}
          </div>
        )}

        <p className="cd-text-faint text-xs">명함 촬영·인사변동/영업접촉 통합 타임라인은 준비 중입니다.</p>
      </div>
    </div>
  );
}
