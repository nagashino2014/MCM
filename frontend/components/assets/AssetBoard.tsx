"use client";

// 자산 관리(/assets, asset.manage) — 예약 가능 자산(법인차량·회의실 등) 마스터 편집.
// 좌측 종류 카드(법인차량/회의실/기타) + 우측 리스트(휴가 종류 규정 화면과 같은 레이아웃).
// 회의실·기타는 인라인 편집으로 충분하고, 법인차량은 상세 모달(129 — 차량번호·소유 유형·
// 취득/반납·계약서/등록증 PDF)로 관리한다. 예약 이력이 있는 자산은 삭제 대신 비활성화된다.
// 설계: docs/groupware-ux-overhaul-blueprint.md §7 + 차량 상세(129).

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import {
  ASSET_KIND_LABELS,
  COMPANY_OWNER_NAME,
  VEHICLE_OWNERSHIP_LABELS,
  type AssetKind,
  type ReservableAsset,
  type VehicleOwnership,
} from "@/lib/assets/types";
import "@/components/cdash/cdash.css";

const KINDS: AssetKind[] = ["vehicle", "room", "etc"];

const fmtComma = (n: number | null): string => (n != null ? n.toLocaleString("ko-KR") : "");

interface SimpleDraft {
  name: string;
  description: string;
  active: boolean;
}

export function AssetBoard() {
  const { theme } = useCdashTheme();
  const [assets, setAssets] = useState<ReservableAsset[]>([]);
  const [activeKind, setActiveKind] = useState<AssetKind>("vehicle");
  const [drafts, setDrafts] = useState<Record<string, SimpleDraft>>({});
  const [creating, setCreating] = useState<SimpleDraft>({ name: "", description: "", active: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // assetId | "new"
  const [error, setError] = useState<string | null>(null);
  // 차량 상세 모달 — "new"(신규) 또는 assetId(편집)
  const [vehicleModal, setVehicleModal] = useState<"new" | string | null>(null);
  const [pdfViewer, setPdfViewer] = useState<{ title: string; url: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/assets", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "자산 목록을 불러오지 못했습니다.");
      const list: ReservableAsset[] = data.assets ?? [];
      setAssets(list);
      setDrafts(
        Object.fromEntries(
          list.map((a) => [a.assetId, { name: a.name, description: a.description ?? "", active: a.active }])
        )
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byKind = (k: AssetKind) => assets.filter((a) => a.kind === k);
  const kindAssets = byKind(activeKind);

  const setDraft = (assetId: string, patch: Partial<SimpleDraft>) =>
    setDrafts((prev) => ({ ...prev, [assetId]: { ...prev[assetId], ...patch } }));

  const isDirty = (a: ReservableAsset): boolean => {
    const d = drafts[a.assetId];
    if (!d) return false;
    return d.name !== a.name || d.description !== (a.description ?? "") || d.active !== a.active;
  };

  const patchAsset = async (assetId: string, body: Record<string, unknown>) => {
    setBusy(assetId);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (a: ReservableAsset) => {
    if (!confirm(`'${a.name}' 자산을 삭제할까요? 예약 이력이 있으면 비활성화로 전환됩니다.`)) return;
    setBusy(a.assetId);
    try {
      const res = await fetch(`/api/assets/${a.assetId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제 실패");
      if (data.deactivated) alert("예약 이력이 있어 비활성화로 전환했습니다.");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const createSimple = async () => {
    if (!creating.name.trim()) {
      alert("자산 이름을 입력하세요.");
      return;
    }
    setBusy("new");
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activeKind, name: creating.name, description: creating.description || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "등록 실패");
      setCreating({ name: "", description: "", active: true });
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const openDoc = (a: ReservableAsset, docType: "contract" | "registration") => {
    const key = docType === "contract" ? a.contractDocKey : a.registrationDocKey;
    if (!key) return;
    setPdfViewer({
      title: `${a.name} ${docType === "contract" ? "계약서" : "차량 등록증"}`,
      url: `/api/assets/documents?key=${encodeURIComponent(key)}`,
    });
  };

  const modalAsset = vehicleModal && vehicleModal !== "new" ? assets.find((a) => a.assetId === vehicleModal) ?? null : null;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="자산 관리"
        meta={`${assets.length}개 자산 · 사용 ${assets.filter((a) => a.active).length}`}
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
          {/* 좌: 자산 종류 카드 */}
          <div className="lg:w-[345px] shrink-0 flex flex-col gap-2 lg:overflow-y-auto">
            <p className="text-[11px] font-bold cd-text-faint px-0.5">자산 종류 선택</p>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => {
                const list = byKind(k);
                const on = activeKind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setActiveKind(k)}
                    className={`rounded-2xl px-3.5 py-[18px] text-left border transition-all ${
                      on ? "cd-glass-active" : "cd-border-c cd-row-hover"
                    }`}
                    style={{
                      background: on ? undefined : "var(--cd-card-solid)",
                      boxShadow: on ? undefined : "var(--cd-shadow)",
                    }}
                  >
                    <span className="block text-[10px] font-bold cd-text-faint">자산 종류</span>
                    <span className="block text-[14.5px] font-extrabold truncate cd-text">{ASSET_KIND_LABELS[k]}</span>
                    <span className="block mt-1 text-[11px] cd-text-faint">
                      {list.length}개 · 사용 {list.filter((a) => a.active).length}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10.5px] cd-text-faint leading-relaxed px-0.5 mt-1">
              법인차량은 출장신청서의 이용차량 선택지로 나타나고, 회의실·기타 자산은 이용 현황 화면에서 직접
              예약합니다. 비활성 자산은 선택지·예약에서 숨겨지며, 예약 이력이 있는 자산은 삭제 대신 비활성화됩니다.
            </p>
          </div>

          {/* 우: 선택 종류 리스트 */}
          <div className="flex-1 min-w-0 cd-card p-5 gap-3 lg:overflow-y-auto">
            {activeKind === "vehicle" ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 pr-2 font-semibold">차종</th>
                        <th className="py-1.5 pr-2 font-semibold">차량번호</th>
                        <th className="py-1.5 pr-2 font-semibold">소유 유형</th>
                        <th className="py-1.5 pr-2 font-semibold">취득일</th>
                        <th className="py-1.5 pr-2 font-semibold">반납(매각)일</th>
                        <th className="py-1.5 pr-2 font-semibold">상세 정보</th>
                        <th className="py-1.5 pr-2 font-semibold">계약서</th>
                        <th className="py-1.5 pr-2 font-semibold">등록증</th>
                        <th className="py-1.5 pr-2 font-semibold">사용</th>
                        <th className="py-1.5 font-semibold">동작</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kindAssets.map((a) => (
                        <tr key={a.assetId} className="border-t cd-border-c">
                          <td className="py-2 pr-2 cd-text font-semibold whitespace-nowrap">{a.name}</td>
                          <td className="py-2 pr-2 cd-text whitespace-nowrap">{a.plateNo ?? "-"}</td>
                          <td className="py-2 pr-2 whitespace-nowrap">
                            {a.ownership ? (
                              <span className="text-[11px] rounded-full px-2 py-0.5 cd-tint-primary">
                                {VEHICLE_OWNERSHIP_LABELS[a.ownership]}
                              </span>
                            ) : (
                              <span className="cd-text-faint">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 cd-text whitespace-nowrap">{a.acquiredAt ?? "-"}</td>
                          <td className="py-2 pr-2 cd-text whitespace-nowrap">{a.returnedAt ?? "-"}</td>
                          <td className="py-2 pr-2">
                            <button
                              type="button"
                              className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px]"
                              onClick={() => setVehicleModal(a.assetId)}
                            >
                              상세 정보
                            </button>
                          </td>
                          {(["contract", "registration"] as const).map((docType) => {
                            const key = docType === "contract" ? a.contractDocKey : a.registrationDocKey;
                            return (
                              <td key={docType} className="py-2 pr-2">
                                {key ? (
                                  <button
                                    type="button"
                                    className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] flex items-center gap-1"
                                    onClick={() => openDoc(a, docType)}
                                  >
                                    <FileText className="w-3 h-3" /> 보기
                                  </button>
                                ) : (
                                  <span className="text-[11px] cd-text-faint">미등록</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="py-2 pr-2 text-center">
                            <input
                              type="checkbox"
                              checked={a.active}
                              disabled={busy === a.assetId}
                              onChange={(e) => patchAsset(a.assetId, { active: e.target.checked })}
                            />
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              className="cd-text-faint hover:cd-error-text disabled:opacity-40"
                              title="삭제"
                              disabled={busy === a.assetId}
                              onClick={() => removeRow(a)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {kindAssets.length === 0 && (
                        <tr>
                          <td colSpan={10} className="py-6 text-center text-[12.5px] cd-text-faint">
                            등록된 차량이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="cd-btn rounded-xl border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex items-center gap-1.5 self-start"
                  onClick={() => setVehicleModal("new")}
                >
                  <Plus className="w-3.5 h-3.5" /> 차량 추가
                </button>
                <p className="text-[10.5px] cd-text-faint">
                  차량의 상세 항목(소유 유형·계약기간·금액·서류)은 [상세 정보]에서 편집합니다. 계약서·등록증 PDF는
                  상세 정보 창에서 업로드하면 이 목록의 [보기]로 바로 열람됩니다.
                </p>
              </>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-left cd-text-faint text-[11px]">
                        <th className="py-1.5 pr-2 font-semibold">이름</th>
                        <th className="py-1.5 pr-2 font-semibold">설명</th>
                        <th className="py-1.5 pr-2 font-semibold">사용</th>
                        <th className="py-1.5 font-semibold">동작</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kindAssets.map((a) => {
                        const d = drafts[a.assetId];
                        if (!d) return null;
                        return (
                          <tr key={a.assetId} className="border-t cd-border-c">
                            <td className="py-1 pr-2">
                              <input
                                className="cd-input"
                                style={{ width: 180 }}
                                value={d.name}
                                onChange={(e) => setDraft(a.assetId, { name: e.target.value })}
                              />
                            </td>
                            <td className="py-1 pr-2">
                              <input
                                className="cd-input w-full min-w-[160px]"
                                value={d.description}
                                onChange={(e) => setDraft(a.assetId, { description: e.target.value })}
                              />
                            </td>
                            <td className="py-1 pr-2 text-center">
                              <input
                                type="checkbox"
                                checked={d.active}
                                onChange={(e) => setDraft(a.assetId, { active: e.target.checked })}
                              />
                            </td>
                            <td className="py-1">
                              <span className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[11px] flex items-center gap-1 disabled:opacity-40"
                                  disabled={!isDirty(a) || busy === a.assetId}
                                  onClick={() =>
                                    patchAsset(a.assetId, {
                                      name: d.name,
                                      description: d.description || null,
                                      active: d.active,
                                    })
                                  }
                                >
                                  <Save className="w-3 h-3" /> 저장
                                </button>
                                <button
                                  type="button"
                                  className="cd-text-faint hover:cd-error-text disabled:opacity-40"
                                  title="삭제"
                                  disabled={busy === a.assetId}
                                  onClick={() => removeRow(a)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {kindAssets.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-[12.5px] cd-text-faint">
                            등록된 자산이 없습니다.
                          </td>
                        </tr>
                      )}
                      {/* 신규 등록 행 */}
                      <tr className="border-t cd-border-c">
                        <td className="py-2 pr-2">
                          <input
                            className="cd-input"
                            style={{ width: 180 }}
                            value={creating.name}
                            placeholder={`새 ${ASSET_KIND_LABELS[activeKind]} 이름`}
                            onChange={(e) => setCreating((p) => ({ ...p, name: e.target.value }))}
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <input
                            className="cd-input w-full min-w-[160px]"
                            value={creating.description}
                            onChange={(e) => setCreating((p) => ({ ...p, description: e.target.value }))}
                          />
                        </td>
                        <td className="py-2 pr-2 text-center cd-text-faint text-[11px]">—</td>
                        <td className="py-2">
                          <button
                            type="button"
                            className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
                            disabled={busy === "new"}
                            onClick={createSimple}
                          >
                            <Plus className="w-3 h-3" /> 등록
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-[10.5px] cd-text-faint">
                  회의실·기타 자산은 이름과 설명만으로 관리됩니다. 이용 현황 화면에서 직접 예약합니다.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* 차량 상세 모달 — 편집 대상이 사라진 경우(삭제 등)엔 렌더하지 않는다 */}
      {(vehicleModal === "new" || modalAsset != null) && (
        <VehicleDetailModal
          asset={vehicleModal === "new" ? null : modalAsset}
          onClose={() => setVehicleModal(null)}
          onSaved={async () => {
            await load();
          }}
          onCreated={(assetId) => setVehicleModal(assetId)}
          onOpenDoc={(a, docType) => openDoc(a, docType)}
        />
      )}

      {/* PDF 뷰어 팝업 */}
      {pdfViewer && <DraggablePdfViewer title={pdfViewer.title} url={pdfViewer.url} onClose={() => setPdfViewer(null)} />}
    </div>
  );
}

/* ---------- 차량 상세 모달 ---------- */

interface VehicleForm {
  name: string;
  plateNo: string;
  ownership: "" | VehicleOwnership;
  ownerName: string;
  acquiredAt: string;
  contractMonths: string;
  returnedAt: string;
  acquisitionPrice: string;
  monthlyFee: string;
  description: string;
}

function formFromAsset(a: ReservableAsset | null): VehicleForm {
  return {
    name: a?.name ?? "",
    plateNo: a?.plateNo ?? "",
    ownership: a?.ownership ?? "",
    ownerName: a?.ownerName ?? "",
    acquiredAt: a?.acquiredAt ?? "",
    contractMonths: a?.contractMonths != null ? String(a.contractMonths) : "",
    returnedAt: a?.returnedAt ?? "",
    acquisitionPrice: a?.acquisitionPrice != null ? String(a.acquisitionPrice) : "",
    monthlyFee: a?.monthlyFee != null ? String(a.monthlyFee) : "",
    description: a?.description ?? "",
  };
}

function VehicleDetailModal({
  asset,
  onClose,
  onSaved,
  onCreated,
  onOpenDoc,
}: {
  /** null = 신규 등록 모드 */
  asset: ReservableAsset | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  /** 신규 등록 완료 — 부모가 편집 모드로 전환해 서류 업로드를 이어서 할 수 있게 한다. */
  onCreated: (assetId: string) => void;
  onOpenDoc: (a: ReservableAsset, docType: "contract" | "registration") => void;
}) {
  const [form, setForm] = useState<VehicleForm>(() => formFromAsset(asset));
  const [saving, setSaving] = useState(false);
  // 서류 업로드 — 종류 선택 + 파일 선택 + 업로드 버튼
  const [docType, setDocType] = useState<"contract" | "registration">("contract");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNew = asset == null;
  // 업로드 후 부모 load() 로 asset prop 이 갱신되므로 서류 상태는 항상 최신이 표시된다.

  const set = (patch: Partial<VehicleForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const setOwnership = (o: "" | VehicleOwnership) => {
    // 법인 소유 → 소유자 자동 입력, 렌트/리스 → (자동값이었다면) 수동 입력으로 비움
    if (o === "owned") set({ ownership: o, ownerName: COMPANY_OWNER_NAME });
    else set({ ownership: o, ownerName: form.ownerName === COMPANY_OWNER_NAME ? "" : form.ownerName });
  };

  const isRentOrLease = form.ownership === "rent" || form.ownership === "lease";
  const isOwned = form.ownership === "owned";

  const save = async () => {
    if (!form.name.trim()) {
      alert("차종을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const vehicle = {
        plateNo: form.plateNo || null,
        ownership: form.ownership || null,
        ownerName: form.ownerName || null,
        acquiredAt: form.acquiredAt || null,
        contractMonths: isRentOrLease && form.contractMonths ? Number(form.contractMonths) : null,
        returnedAt: form.returnedAt || null,
        acquisitionPrice: isOwned && form.acquisitionPrice ? Number(form.acquisitionPrice) : null,
        monthlyFee: isRentOrLease && form.monthlyFee ? Number(form.monthlyFee) : null,
      };
      const res = await fetch(isNew ? "/api/assets" : `/api/assets/${asset.assetId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isNew
            ? { kind: "vehicle", name: form.name, description: form.description || null, vehicle }
            : { name: form.name, description: form.description || null, vehicle }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      await onSaved();
      if (isNew && data.asset?.assetId) {
        // 신규 등록 직후 같은 차량의 편집 모드로 전환 — 서류 업로드를 이어서 할 수 있다.
        onCreated(String(data.asset.assetId));
      } else {
        onClose();
      }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const upload = async () => {
    if (!asset) return;
    if (!docFile) {
      alert("업로드할 PDF 파일을 선택하세요.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", docFile);
      fd.append("docType", docType);
      const res = await fetch(`/api/assets/${asset.assetId}/documents`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "업로드 실패");
      setDocFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await onSaved();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <label className="text-[11px] cd-text-faint flex flex-col gap-1">
      {label}
      {node}
      {hint && <span className="text-[10px]">{hint}</span>}
    </label>
  );

  return (
    <CdModal
      open
      onClose={onClose}
      title={isNew ? "차량 추가" : `차량 상세 정보 — ${asset.name}`}
      size="lg"
      closeOnBackdrop={false}
      footer={
        <>
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs" onClick={onClose}>
            닫기
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            disabled={saving}
            onClick={save}
          >
            <Save className="w-3.5 h-3.5 inline mr-1" />
            {saving ? "저장 중..." : isNew ? "등록" : "저장"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {field(
            "차종",
            <input className="cd-input" value={form.name} placeholder="니로 / K8" onChange={(e) => set({ name: e.target.value })} />
          )}
          {field(
            "차량번호",
            <input className="cd-input" value={form.plateNo} placeholder="12가3456" onChange={(e) => set({ plateNo: e.target.value })} />
          )}
          {field(
            "소유 유형",
            <select
              className="cd-select"
              style={{ width: "100%" }}
              value={form.ownership}
              onChange={(e) => setOwnership(e.target.value as "" | VehicleOwnership)}
            >
              <option value="">선택</option>
              {(Object.keys(VEHICLE_OWNERSHIP_LABELS) as VehicleOwnership[]).map((o) => (
                <option key={o} value={o}>
                  {VEHICLE_OWNERSHIP_LABELS[o]}
                </option>
              ))}
            </select>
          )}
          {field(
            "소유자",
            <input
              className="cd-input"
              value={form.ownerName}
              disabled={isOwned}
              placeholder={form.ownership === "rent" ? "렌터카 회사 명칭" : form.ownership === "lease" ? "리스사 명칭" : "소유 유형을 먼저 선택"}
              onChange={(e) => set({ ownerName: e.target.value })}
            />,
            isOwned ? "법인 소유는 자동 입력됩니다." : undefined
          )}
          {field("취득(계약)일", <AutoDateInput className="cd-input" value={form.acquiredAt} onChange={(v) => set({ acquiredAt: v })} />)}
          {field(
            "계약기간",
            <span className="flex items-center gap-1.5">
              <input
                className="cd-input text-right"
                style={{ width: 90 }}
                inputMode="numeric"
                disabled={!isRentOrLease}
                value={form.contractMonths}
                onChange={(e) => set({ contractMonths: e.target.value.replace(/\D/g, "") })}
              />
              <span className="text-[12px] cd-text shrink-0">개월</span>
            </span>,
            !isRentOrLease ? "장기 렌트·리스일 때만 입력합니다." : undefined
          )}
          {field("반납(매각)일", <AutoDateInput className="cd-input" value={form.returnedAt} onChange={(v) => set({ returnedAt: v })} />)}
          {field(
            "취득 가격",
            <span className="flex items-center gap-1.5">
              <input
                className="cd-input text-right w-full"
                inputMode="numeric"
                disabled={!isOwned}
                value={form.acquisitionPrice ? fmtComma(Number(form.acquisitionPrice)) : ""}
                onChange={(e) => set({ acquisitionPrice: e.target.value.replace(/\D/g, "") })}
              />
              <span className="text-[11px] cd-text-faint shrink-0">원</span>
            </span>,
            !isOwned ? "법인 소유일 때만 입력합니다." : undefined
          )}
          {field(
            "렌트(리스)료",
            <span className="flex items-center gap-1.5">
              <input
                className="cd-input text-right w-full"
                inputMode="numeric"
                disabled={!isRentOrLease}
                value={form.monthlyFee ? fmtComma(Number(form.monthlyFee)) : ""}
                onChange={(e) => set({ monthlyFee: e.target.value.replace(/\D/g, "") })}
              />
              <span className="text-[11px] cd-text-faint shrink-0">원/월</span>
            </span>,
            !isRentOrLease ? "장기 렌트·리스일 때만 입력합니다." : undefined
          )}
          {field(
            "설명(선택)",
            <input className="cd-input" value={form.description} onChange={(e) => set({ description: e.target.value })} />
          )}
        </div>

        {/* 서류 등록 — 계약서 / 차량 등록증 */}
        <div className="rounded-xl border border-dashed cd-border-c p-3 flex flex-col gap-2">
          <span className="text-[11px] font-bold cd-text-faint">서류 등록 (PDF)</span>
          {isNew ? (
            <p className="text-[11.5px] cd-text-faint">차량을 먼저 등록(저장)한 뒤 서류를 업로드할 수 있습니다.</p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select
                  className="cd-select shrink-0"
                  style={{ width: 130 }}
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as "contract" | "registration")}
                >
                  <option value="contract">계약서</option>
                  <option value="registration">차량 등록증</option>
                </select>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="text-[11.5px] cd-text flex-1 min-w-[180px]"
                  onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-[11.5px] flex items-center gap-1 disabled:opacity-50 shrink-0"
                  disabled={uploading || !docFile}
                  onClick={upload}
                >
                  <Upload className="w-3.5 h-3.5" /> {uploading ? "업로드 중..." : "업로드"}
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {(["contract", "registration"] as const).map((t) => {
                  const key = t === "contract" ? asset.contractDocKey : asset.registrationDocKey;
                  const name = t === "contract" ? asset.contractDocName : asset.registrationDocName;
                  return (
                    <p key={t} className="text-[11.5px] flex items-center gap-1.5">
                      <span className="cd-text-faint w-[76px] shrink-0">{t === "contract" ? "계약서" : "차량 등록증"}</span>
                      {key ? (
                        <>
                          <span className="cd-text truncate">{name ?? key}</span>
                          <button type="button" className="cd-text-primary shrink-0" onClick={() => onOpenDoc(asset, t)}>
                            보기
                          </button>
                        </>
                      ) : (
                        <span className="cd-text-faint">미등록</span>
                      )}
                    </p>
                  );
                })}
              </div>
              <p className="text-[10px] cd-text-faint">같은 종류를 다시 업로드하면 기존 파일을 교체합니다.</p>
            </>
          )}
        </div>
      </div>
    </CdModal>
  );
}

/* ---------- PDF 뷰어 팝업 (계약 화면 DraggablePdfViewer 패턴 복제) ---------- */

function DraggablePdfViewer({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const [position, setPosition] = useState(() => ({
    x:
      typeof window === "undefined"
        ? 96
        : Math.max(16, Math.round((window.innerWidth - Math.min(1280, window.innerWidth - 32)) / 2)),
    y: 24,
  }));
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = { x: event.clientX - position.x, y: event.clientY - position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const width = Math.min(1280, window.innerWidth - 32);
    const height = Math.min(1100, window.innerHeight - 32);
    setPosition({
      x: Math.min(Math.max(8, event.clientX - dragOffset.current.x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, event.clientY - dragOffset.current.y), Math.max(8, window.innerHeight - height - 8)),
    });
  };
  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="fixed z-[110] rounded-3xl border cd-border-c cd-card-bg shadow-2xl overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: "min(1280px, calc(100vw - 32px))",
        height: "min(1100px, calc(100vh - 32px))",
      }}
    >
      <div
        className="h-12 px-4 border-b cd-border-c cd-surface-bg flex items-center justify-between gap-3 cursor-move select-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="min-w-0 flex items-center gap-2">
          <FileText className="w-4 h-4 cd-text-primary shrink-0" />
          <span className="text-sm cd-text truncate">{title}</span>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="rounded-lg p-1 cd-text-faint hover:bg-[color:var(--cd-surface)] hover:text-[color:var(--cd-text)]"
          title="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <iframe title={title} src={`${url.split("#", 1)[0]}#toolbar=1&navpanes=0&view=FitH`} className="w-full h-[calc(100%-48px)] cd-surface-bg" />
    </div>
  );
}
