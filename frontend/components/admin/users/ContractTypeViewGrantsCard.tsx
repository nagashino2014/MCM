"use client";

// 용역 유형별 계약 열람(377) — 계정·권한 관리 화면의 계정 상세 칸.
// 수행인력으로 등록되지 않은 계약도, 고른 용역 유형이면 이 계정이 열람하게 한다(열람 전용, contract.view 보유 계정만 효력).
import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { subtypesOf } from "@/lib/contracts/service-categories";
import { useContractServiceOptions } from "@/lib/contracts/use-contract-service-options";

interface GrantRow {
  grantId: string;
  serviceType: string;
  serviceSubtype: string | null;
  note: string | null;
  createdAt: string | null;
  contractCount: number;
}

export default function ContractTypeViewGrantsCard({
  userId,
  canAssign,
  hasContractView,
  toast,
}: {
  userId: string;
  canAssign: boolean;
  /** 이 계정의 권한 템플릿에 계약 조회(contract.view)가 있는가 — 없으면 부여해도 효력이 없다. */
  hasContractView: boolean;
  toast: (message: string, type?: "success" | "error") => void;
}) {
  const { options } = useContractServiceOptions();
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [tableReady, setTableReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serviceType, setServiceType] = useState("");
  const [serviceSubtype, setServiceSubtype] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/permissions/contract-type-views?userId=" + encodeURIComponent(userId), { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "조회 실패");
      const json = (await res.json()) as { tableReady?: boolean; grants?: GrantRow[] };
      setGrants(json.grants ?? []);
      setTableReady(json.tableReady !== false);
    } catch (err) {
      setGrants([]);
      toast("용역 유형별 계약 열람 조회 실패: " + (err as Error).message, "error");
    } finally {
      setLoading(false);
    }
    // toast 는 부모가 렌더마다 새로 만드는 함수라 의존성에 넣지 않는다(재조회 반복 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    setServiceType("");
    setServiceSubtype("");
    setNote("");
    void load();
  }, [load]);

  const grant = async () => {
    if (!serviceType) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions/contract-type-views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, serviceType, serviceSubtype: serviceSubtype || null, note: note.trim() || null }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "부여 실패");
      toast(`${serviceType}${serviceSubtype ? " · " + serviceSubtype : ""} 계약 열람을 부여했습니다.`);
      setServiceType("");
      setServiceSubtype("");
      setNote("");
      await load();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (row: GrantRow) => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/permissions/contract-type-views?grantId=" + encodeURIComponent(row.grantId), { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "회수 실패");
      toast("계약 열람 부여를 회수했습니다.");
      await load();
    } catch (err) {
      toast("실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const subtypes = subtypesOf(options, serviceType);

  return (
    <div className="rounded-2xl cd-surface-bg border cd-border-c p-4">
      <h3 className="font-bold cd-text mb-1 flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-[color:var(--cd-primary)]" /> 용역 유형별 계약 열람 ({grants.length})
        <CdHelp topic="admin.contract-type-view" />
      </h3>
      <p className="text-xs cd-text-muted mb-3">
        수행인력으로 등록되지 않은 계약도, 고른 용역 유형이면 이 계정이 열람합니다. 수정 권한은 넓어지지 않습니다.
      </p>

      {!tableReady && (
        <div className="text-sm cd-text-muted rounded-xl cd-card-bg border cd-border-c p-3 mb-3" role="status">
          이 설정이 아직 설치되지 않았습니다(마이그레이션 377 적용 후 사용할 수 있습니다).
        </div>
      )}
      {tableReady && !hasContractView && (
        <div className="text-sm rounded-xl cd-card-bg border cd-border-c p-3 mb-3 text-[color:var(--cd-warning)]" role="status">
          이 계정에는 계약 조회 권한이 있는 템플릿이 없어, 부여해도 계약 메뉴가 열리지 않습니다. 먼저 권한 템플릿을 부여하세요.
        </div>
      )}

      {loading ? (
        <div className="text-sm cd-text-faint py-4 text-center">불러오는 중…</div>
      ) : grants.length === 0 ? (
        <div className="text-sm cd-text-faint py-4 text-center">부여된 용역 유형이 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-2 mb-3">
          {grants.map((row) => (
            <div key={row.grantId} className="grid grid-cols-[1.2fr_1fr_auto] gap-3 items-center rounded-xl cd-card-bg border cd-border-c p-3">
              <div className="text-sm font-bold cd-text-primary truncate">
                {row.serviceType} · {row.serviceSubtype ?? "전체 세분류"}
              </div>
              <div className="text-xs cd-text-muted truncate" title={row.note ?? undefined}>
                계약 {row.contractCount.toLocaleString()}건{row.createdAt ? " · " + row.createdAt.slice(0, 10) : ""}
                {row.note ? " · " + row.note : ""}
              </div>
              {canAssign ? (
                <button type="button" disabled={saving} onClick={() => revoke(row)} className="cd-btn cd-btn-danger cd-btn-sm">
                  회수
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      )}

      {canAssign && tableReady && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="cd-label !mb-0">용역 대분류</span>
            <select
              className="cd-select w-auto"
              value={serviceType}
              onChange={(e) => {
                setServiceType(e.target.value);
                setServiceSubtype("");
              }}
            >
              <option value="">선택</option>
              {options.map((o) => (
                <option key={o.type} value={o.type}>
                  {o.type}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="cd-label !mb-0">세분류</span>
            <select className="cd-select w-auto" value={serviceSubtype} disabled={!serviceType} onChange={(e) => setServiceSubtype(e.target.value)}>
              <option value="">전체 세분류</option>
              {subtypes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <span className="cd-label !mb-0">사유(선택)</span>
            <input className="cd-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예: 화관법 용역 총괄 감독" />
          </label>
          <button type="button" disabled={saving || !serviceType} onClick={grant} className="cd-btn cd-btn-primary ml-auto">
            열람 부여
          </button>
        </div>
      )}
    </div>
  );
}
