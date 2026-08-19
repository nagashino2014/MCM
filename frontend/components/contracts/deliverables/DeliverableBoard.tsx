"use client";

// 착수계·준공계 작성(/contracts/deliverables) — 계약 트리에서 대상을 고르면 자동 채움된 값으로
// 서식을 만들고, PDF/HWPX 다운로드 또는 공문 첨부로 발송한다. 결재는 공문 결재로 갈음.
// 설계: docs/contract-deliverables-blueprint.md §5.
// 2026-08-07 개편(사용자 확정): 작성 책임을 용역 담당 실무자에게 일임 —
//  · 계약 선택을 다운로드/증명서 생성과 같은 트리뷰로 교체(관리자=전체 / 실무자=본인 수행 용역)
//  · 종류·양식·서식 + 기재 사항을 한 카드로 합치고 기재 사항은 항목 그룹별 탭으로 분리
//  · 좌우 카드 높이를 화면 하단에 맞춰 고정

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckSquare, ChevronDown, ChevronRight, Download, Eye, FileCog, Lock, Save, Search, Send, Unlock } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import { CATALOG_ADDON_TYPES, CATALOG_BY_TYPE, DEFAULT_DOC_TYPES, catalogByKind } from "@/lib/deliverable/catalog";
import { collectBindings } from "@/lib/deliverable/format";
import {
  BINDING_LABEL,
  DELIVERABLE_BINDINGS,
  DELIVERABLE_KIND_LABEL,
  OMIT_ORDER_NO_KEY,
  RESULT_PHOTOS_KEY,
  parsePhotoRefs,
  type BindingDef,
  type DeliverableKind,
  type DeliverablePhotoRef,
  type DeliverableSpec,
  type DeliverableValues,
} from "@/lib/deliverable/types";
import "@/components/cdash/cdash.css";

interface TreeContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  contractDate: string | null;
  contractAmount?: number | null;
}

interface TreeGroup {
  serviceType: string;
  contracts: TreeContractNode[];
}

interface TreePayload {
  totalCount: number;
  availableYears: string[];
  groups: TreeGroup[];
  scoped?: boolean;
}

interface MilestoneOption {
  milestoneId: string;
  stageLabel: string;
  stageOrder: number;
  amount: number | null;
}

interface TemplateOption {
  templateId: string;
  name: string;
  ownerFacilityName: string | null;
  /** overlay = 원본 HWPX 에 값 주입(서식 그대로) / spec = 재구축 */
  renderMode: "overlay" | "spec";
  specs: DeliverableSpec[];
  /** 서식 목록 — overlay 는 매핑(profile)에서, spec 은 재구축 결과에서 온다 */
  docs: { docType: string; title: string; bindings: string[] }[];
}

const BINDING_DEF = new Map(DELIVERABLE_BINDINGS.map((b) => [b.key, b]));
/** 기재 사항 탭 순서 — 바인딩 카탈로그의 group 을 그대로 쓴다 */
const TAB_GROUPS: BindingDef["group"][] = ["계약", "준공", "발주처", "자사", "작성"];

const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);

export function DeliverableBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  // 회수 재작성 진입(2026-08-19) — 공문 회수 후 ?deliverable=<id> 로 기존 문서를 다시 연다
  const sp = useSearchParams();
  const editDeliverableId = sp.get("deliverable");

  // ── 계약 트리 ──
  const [tree, setTree] = useState<TreePayload | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // ── 작성 상태 ──
  const [kind, setKind] = useState<DeliverableKind>("start");
  const [contract, setContract] = useState<TreeContractNode | null>(null);
  const [milestones, setMilestones] = useState<MilestoneOption[]>([]);
  const [milestoneId, setMilestoneId] = useState<string>("");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [docTypes, setDocTypes] = useState<string[]>(DEFAULT_DOC_TYPES.start);
  const [values, setValues] = useState<DeliverableValues>({});
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const [deliverableId, setDeliverableId] = useState<string | null>(null);
  // 이 문서가 이미 공문에 연계돼 있으면(회수 재작성) '공문 발송'이 그 공문으로 돌아간다
  const [letterDocId, setLetterDocId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("계약");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── 트리 로드 ──
  // 검색어가 있으면 연도 제한을 풀고 전 연도에서 찾는다 — 연도별로만 로드하면 다른 해 계약이
  // 검색되지 않는다(예: 2026 트리에서 2025년 계약을 찾지 못하던 문제).
  const searching = search.trim().length >= 2;
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    const t = setTimeout(() => {
      const qs = searching ? "" : `?year=${encodeURIComponent(year)}`;
      fetch(`/api/contracts/deliverables/tree${qs}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: TreePayload | null) => {
          if (!cancelled && d) setTree(d);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setTreeLoading(false);
        });
    }, searching ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [year, searching]);

  // 검색 중에는 결과가 흩어져 보이지 않도록 모든 용역분류를 펼친다
  useEffect(() => {
    if (searching) setExpanded(Object.fromEntries((tree?.groups ?? []).map((g) => [g.serviceType, true])));
  }, [searching, tree]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tree?.groups ?? [])
      .filter((g) => !typeFilter || g.serviceType === typeFilter)
      .map((g) => ({
        ...g,
        contracts: g.contracts.filter((c) => {
          if (subtypeFilter && (c.serviceSubtype ?? "") !== subtypeFilter) return false;
          if (!q) return true;
          return (
            c.contractTitle.toLowerCase().includes(q) ||
            (c.counterpartyName ?? "").toLowerCase().includes(q) ||
            (c.serviceSubtype ?? "").toLowerCase().includes(q)
          );
        }),
      }))
      // 자식이 없는 용역분류(부모 노드)는 표시하지 않는다(사용자 확정)
      .filter((g) => g.contracts.length > 0);
  }, [tree, search, typeFilter, subtypeFilter]);

  const subtypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of tree?.groups ?? []) for (const c of g.contracts) if (c.serviceSubtype) set.add(c.serviceSubtype);
    return [...set].sort();
  }, [tree]);

  /** 계약·종류·기성회차가 바뀌면 자동 채움값을 다시 산출한다(잠금 해제 항목은 보존) */
  const loadAutoValues = useCallback(
    async (contractId: string, nextKind: DeliverableKind, nextMilestoneId?: string, nextVatNote?: string) => {
      const params = new URLSearchParams({ contractId, kind: nextKind });
      if (nextMilestoneId) params.set("milestoneId", nextMilestoneId);
      if (nextVatNote) params.set("vatNote", nextVatNote);
      const res = await fetch(`/api/contracts/deliverables/sources?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setValues((prev) => {
        const auto = (data?.values ?? {}) as DeliverableValues;
        const merged: DeliverableValues = { ...auto };
        for (const [key, on] of Object.entries(unlocked)) if (on && prev[key] !== undefined) merged[key] = prev[key];
        return merged;
      });
      setMilestones(Array.isArray(data?.contract?.milestones) ? data.contract.milestones : []);
      setTemplates(Array.isArray(data?.templates) ? data.templates : []);
    },
    [unlocked]
  );

  const pickContract = async (c: TreeContractNode) => {
    setContract(c);
    setDeliverableId(null);
    setLetterDocId(null);
    setPreviewUrl(null);
    setUnlocked({});
    setMilestoneId("");
    await loadAutoValues(c.contractId, kind);
  };

  // 회수 재작성(2026-08-19) — ?deliverable=<id> 로 진입하면 저장된 문서를 그대로 복원한다.
  // 자동 채움(loadAutoValues)은 저장값을 덮어쓰므로 부르지 않고, 기성회차·양식 목록만 로드한다.
  useEffect(() => {
    if (!editDeliverableId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/contracts/deliverables/${encodeURIComponent(editDeliverableId)}`, { cache: "no-store" });
        const row = await res.json();
        if (!res.ok) throw new Error((row as { error?: string })?.error ?? "문서를 불러오지 못했습니다.");
        if (cancelled) return;
        setDeliverableId(row.deliverableId);
        setLetterDocId(row.letterDocId ?? null);
        setKind(row.kind === "start" ? "start" : "completion");
        setDocTypes(Array.isArray(row.docTypes) ? row.docTypes : []);
        setTemplateId(row.templateId ?? "");
        setValues((row.values ?? {}) as DeliverableValues);
        setUnlocked((row.unlocked ?? {}) as Record<string, boolean>);
        setMilestoneId(String(row.values?.["meta.milestoneId"] ?? ""));
        setContract({
          contractId: row.contractId,
          contractTitle: String(row.values?.["contract.title"] ?? row.title ?? ""),
          counterpartyName: String(row.values?.["orderer.name"] ?? ""),
          serviceSubtype: null,
          contractDate: null,
        });
        // 기성회차·발주처 양식 목록 — 값은 건드리지 않고 목록만 받는다
        const q = new URLSearchParams({ contractId: row.contractId, kind: row.kind });
        const src = await fetch(`/api/contracts/deliverables/sources?${q.toString()}`);
        if (src.ok) {
          const data = await src.json();
          if (!cancelled) {
            setMilestones(Array.isArray(data?.contract?.milestones) ? data.contract.milestones : []);
            setTemplates(Array.isArray(data?.templates) ? data.templates : []);
          }
        }
        if (!cancelled && row.letterDocId) {
          setMsg("회수된 공문의 서류입니다 — 수정 후 '공문 발송'을 누르면 기존 공문으로 돌아가 첨부가 교체됩니다.");
        }
      } catch (err) {
        if (!cancelled) setMsg((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDeliverableId]);

  const changeKind = async (next: DeliverableKind) => {
    setKind(next);
    setDocTypes(DEFAULT_DOC_TYPES[next]);
    setDeliverableId(null);
    setPreviewUrl(null);
    setTemplateId("");
    if (contract) await loadAutoValues(contract.contractId, next, milestoneId || undefined);
  };

  const changeMilestone = async (id: string) => {
    setMilestoneId(id);
    if (contract) await loadAutoValues(contract.contractId, kind, id || undefined);
  };

  /**
   * VAT 표기 변경 — 표기만 바꾸는 게 아니라 공급가액·부가세를 다시 산출한다.
   * 별도 = 계약금액이 공급가액(부가세 가산) / 포함 = 총액에서 역산.
   */
  const changeVatNote = async (note: string) => {
    setValues((prev) => ({ ...prev, "meta.vatNote": note }));
    setPreviewUrl(null);
    if (contract) await loadAutoValues(contract.contractId, kind, milestoneId || undefined, note);
  };

  // ── 선택 서식 → 편집 필드 ──
  const specs = useMemo<DeliverableSpec[]>(() => {
    if (templateId) {
      const tpl = templates.find((t) => t.templateId === templateId);
      if (tpl) {
        const byType = new Map(tpl.specs.map((s) => [s.docType, s]));
        // 양식에 없는 서식은 카탈로그 폴백 — 기본 추가 서식(내역서·결과보고서·대금청구서)
        const picked = docTypes.map((t) => byType.get(t) ?? CATALOG_BY_TYPE[t]).filter((s): s is DeliverableSpec => !!s);
        return picked.length ? picked : tpl.specs;
      }
    }
    return docTypes.map((t) => CATALOG_BY_TYPE[t]).filter((s): s is DeliverableSpec => !!s);
  }, [docTypes, templateId, templates]);

  const template = useMemo(() => templates.find((t) => t.templateId === templateId) ?? null, [templateId, templates]);

  const catalogOptions = useMemo(() => {
    if (template) {
      // 발주처 양식 + 기본 추가 서식(내역서·결과보고서·대금청구서) 조합(2026-08-19 사용자 확정) —
      // 발주처 양식이 준공계만 담고 있어도 나머지는 자사 기본 서식으로 함께 낸다
      const addons = kind === "completion" ? CATALOG_ADDON_TYPES.map((t) => CATALOG_BY_TYPE[t]).filter(Boolean) : [];
      return [
        ...template.docs.map((d) => ({ docType: d.docType, title: d.title })),
        ...addons.map((s) => ({ docType: s.docType, title: `${s.title}(기본)` })),
      ];
    }
    return catalogByKind(kind).map((s) => ({ docType: s.docType, title: s.title }));
  }, [kind, template]);

  // 편집 대상 항목 — overlay 양식은 Spec 이 없으므로 매핑된 바인딩 목록이 그 역할을 한다
  const editableBindings = useMemo(() => {
    if (template?.renderMode === "overlay") {
      const picked = template.docs.filter((d) => !docTypes.length || docTypes.includes(d.docType));
      const mapped = [...new Set((picked.length ? picked : template.docs).flatMap((d) => d.bindings))];
      // 기본 추가 서식 선택분의 바인딩도 편집 대상에 합친다(overlay 매핑에는 없는 항목들)
      const addonSpecs = docTypes.map((t) => CATALOG_BY_TYPE[t]).filter(Boolean);
      return [...new Set([...mapped, ...collectBindings(addonSpecs)])];
    }
    return collectBindings(specs);
  }, [docTypes, specs, template]);

  /** 탭(그룹) → 그 그룹에 속한 편집 대상 바인딩 */
  const bindingsByGroup = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const key of editableBindings) {
      const g = BINDING_DEF.get(key)?.group ?? "작성";
      map.set(g, [...(map.get(g) ?? []), key]);
    }
    return map;
  }, [editableBindings]);

  const activeTabs = useMemo(() => TAB_GROUPS.filter((g) => (bindingsByGroup.get(g)?.length ?? 0) > 0), [bindingsByGroup]);

  useEffect(() => {
    if (activeTabs.length && !activeTabs.includes(tab as BindingDef["group"]) && tab !== "미리보기") setTab(activeTabs[0]);
  }, [activeTabs, tab]);

  const toggleDocType = (docType: string) => {
    setDocTypes((prev) => (prev.includes(docType) ? prev.filter((t) => t !== docType) : [...prev, docType]));
    setPreviewUrl(null);
  };

  const setValue = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setPreviewUrl(null);
  };

  const toggleLock = (key: string) => setUnlocked((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── 성과품 사진(용역결과보고서 별첨, 2026-08-19) — 값은 RESULT_PHOTOS_KEY 에 JSON 으로 저장 ──
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoRefs = useMemo(() => parsePhotoRefs(values), [values]);
  const setPhotoRefs = (list: DeliverablePhotoRef[]) => setValue(RESULT_PHOTOS_KEY, list.length ? JSON.stringify(list) : "");

  const uploadPhotos = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setPhotoUploading(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const res = await fetch("/api/contracts/deliverables/photos", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "사진 업로드 실패");
      const items = (data.items ?? []) as { name: string; key: string; size: number }[];
      // 성과품 명칭 기본값 = 파일명(확장자 제외) — 업로드 후 입력란에서 고친다
      setPhotoRefs([...photoRefs, ...items.map((it) => ({ name: it.name.replace(/\.[^.]+$/, ""), key: it.key, size: it.size }))]);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setPhotoUploading(false);
    }
  };

  const save = async (): Promise<string | null> => {
    if (!contract) {
      setMsg("계약을 먼저 선택하세요.");
      return null;
    }
    if (!docTypes.length) {
      setMsg("생성할 서식을 하나 이상 선택하세요.");
      return null;
    }
    setBusy(true);
    setMsg(null);
    try {
      if (!deliverableId) {
        const res = await fetch("/api/contracts/deliverables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId: contract.contractId,
            kind,
            templateId: templateId || null,
            docTypes,
            milestoneId: milestoneId || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "저장 실패");
        const id = String(data.deliverableId);
        await fetch(`/api/contracts/deliverables/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values, unlocked, docTypes, templateId: templateId || null }),
        });
        setDeliverableId(id);
        return id;
      }
      const res = await fetch(`/api/contracts/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, unlocked, docTypes, templateId: templateId || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? "저장 실패");
      }
      return deliverableId;
    } catch (err) {
      setMsg((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** 저장만 수행(생성/갱신) — 값 변경 후 명시적으로 확정할 때 */
  const saveOnly = async () => {
    const id = await save();
    if (id) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const preview = async () => {
    const id = await save();
    if (id) {
      setPreviewUrl(`/api/contracts/deliverables/${id}/pdf?t=${Date.now()}`);
      setTab("미리보기");
    }
  };

  const download = async () => {
    const id = await save();
    if (id) window.open(`/api/contracts/deliverables/${id}/pdf?download=1&persist=1`, "_blank");
  };

  const downloadHwpx = async () => {
    const id = await save();
    if (id) window.open(`/api/contracts/deliverables/${id}/hwpx`, "_blank");
  };

  const goLetter = async () => {
    const id = await save();
    if (!id) return;
    // 회수 재작성이면 기존 공문(문서번호 유지)으로 돌아간다 — 공문 화면이 첨부를 재생성본으로 교체
    if (letterDocId) router.push(`/approval/letter?docId=${encodeURIComponent(letterDocId)}&deliverable=${id}`);
    else router.push(`/approval/letter?deliverable=${id}`);
  };

  const inputFor = (key: string) => {
    const def = BINDING_DEF.get(key);
    const raw = values[key];
    const value = raw == null ? "" : String(raw);
    const locked = !unlocked[key];
    const common = "cd-input w-full disabled:opacity-60";
    if (key === "meta.vatNote") {
      // 표기를 바꾸면 준공금액 표가 다시 계산된다 → 잠금 없이 바로 고를 수 있게 한다
      return (
        <select className="cd-input w-full" value={value || "VAT 별도"} onChange={(e) => void changeVatNote(e.target.value)}>
          <option value="VAT 별도">VAT 별도 (계약금액 = 공급가액)</option>
          <option value="VAT 포함">VAT 포함 (계약금액에서 역산)</option>
        </select>
      );
    }
    if (def?.format === "multiline") {
      return <textarea className={common} rows={3} value={value} disabled={locked} onChange={(e) => setValue(key, e.target.value)} />;
    }
    if (key === "contract.orderNo") {
      // 발주번호 제외 토글(2026-08-19 사용자 확정) — 발주처가 발주번호를 안 쓰는 계약은
      // 용역결과보고서에서 행 자체를 빼고 아래 번호를 당긴다(그때그때 켜고 끈다).
      const omitted = Number(values[OMIT_ORDER_NO_KEY] ?? 0) === 1;
      return (
        <div className="flex items-center gap-2">
          <input
            className={`${common} flex-1`}
            type="text"
            value={value}
            disabled={locked || omitted}
            onChange={(e) => setValue(key, e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-[11px] cd-text-faint cursor-pointer whitespace-nowrap" title="용역결과보고서에서 발주번호 행을 빼고 아래 항목 번호를 당깁니다.">
            <input type="checkbox" checked={omitted} onChange={(e) => setValue(OMIT_ORDER_NO_KEY, e.target.checked ? "1" : "0")} />
            문서에서 제외
          </label>
        </div>
      );
    }
    if (def?.format?.startsWith("date")) {
      return <AutoDateInput className={common} value={value.slice(0, 10)} disabled={locked} onChange={(next) => setValue(key, next)} />;
    }
    if (def?.format?.startsWith("amount")) {
      return <AmountInput className={common} value={value} disabled={locked} onChange={(next) => setValue(key, next)} />;
    }
    return <input className={common} type="text" value={value} disabled={locked} onChange={(e) => setValue(key, e.target.value)} />;
  };

  // 카드 하단이 좌측 메뉴바 하단과 맞도록 뷰포트 기준 고정 높이.
  // 210px = 페이지 상단 패딩 + CdPageHeader + 헤더 하단 여백 + 페이지 하단 패딩(실측)
  const paneHeight = "calc(100vh - 210px)";

  return (
    <div className="cdash cd-fields-white p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "계약", href: "/contracts" }, { label: "착수계·준공계" }]}
        title="착수계·준공계 작성"
        meta={contract ? `${contract.counterpartyName || "발주처 미상"} · ${DELIVERABLE_KIND_LABEL[kind]}` : "계약을 선택하세요"}
        actions={
          <>
            {/* 발주처가 자기네 양식을 고집하는 경우 여기서 등록한다(D4) */}
            <button
              type="button"
              className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={() => router.push("/contracts/deliverables/templates")}
              title="발주처 자체양식 업로드·매핑 관리"
            >
              <FileCog className="w-4 h-4" /> 발주처 양식
            </button>
            {/* 기재 사항 저장 — 값을 고친 뒤 문서로 확정해 둔다(공문 첨부·재출력이 같은 값을 쓴다) */}
            <button
              type="button"
              className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={saveOnly}
              disabled={busy || !contract}
            >
              <Save className="w-4 h-4" /> {saved ? "저장됨" : "저장"}
            </button>
            {/* 미리보기는 우측 카드의 '미리보기' 탭이 담당한다(버튼 중복 제거 — 사용자 확정) */}
            <button type="button" className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5" onClick={download} disabled={busy}>
              <Download className="w-4 h-4" /> PDF
            </button>
            <button
              type="button"
              className="cd-btn rounded-xl border cd-border-c px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={downloadHwpx}
              disabled={busy}
              title={
                !templateId || template?.renderMode === "overlay"
                  ? "한글에서 편집 가능한 원본"
                  : "스캔본을 재구성한 한글 파일 — 서식이 원본과 다를 수 있어 한글에서 다듬어 쓰세요"
              }
            >
              <Download className="w-4 h-4" /> HWPX
            </button>
            <button
              type="button"
              className="cd-btn cd-fill-primary rounded-xl px-3 py-2 text-[13px] flex items-center gap-1.5"
              onClick={goLetter}
              disabled={busy}
              title="공문 작성 화면으로 이동해 이 문서를 첨부합니다"
            >
              <Send className="w-4 h-4" /> 공문으로 발송
            </button>
          </>
        }
      />

      {msg && (
        <div className="mb-4 rounded-xl px-4 py-2.5 text-[13px]" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>
          {msg}
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-5 items-stretch" style={{ height: paneHeight }}>
        {/* 좌: 계약 트리(다운로드/증명서 생성과 동일 구조) */}
        <section className="cd-card rounded-3xl overflow-hidden flex flex-col w-full xl:flex-[4.5] min-w-0 min-h-0">
          <div className="p-4 border-b cd-border-c">
            <h2 className="font-bold cd-text flex items-center gap-2 text-sm">
              <CheckSquare className="w-4 h-4 cd-text-primary" /> 계약 선택
            </h2>
            <p className="text-[11px] cd-text-faint mt-0.5">
              {contract ? "선택 1건" : "선택 없음"} / 현재 목록 {filteredGroups.reduce((a, g) => a + g.contracts.length, 0).toLocaleString()}건
              {searching && <span className="ml-1">· 전 연도 검색</span>}
              {tree?.scoped && <span className="ml-1">· 본인 수행 용역</span>}
            </p>
          </div>
          <div className="p-3 flex flex-col gap-2 border-b cd-border-c">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 cd-text-faint" />
                <input
                  className="cd-input text-[12px]"
                  style={{ paddingLeft: "2rem" }}
                  placeholder="계약명 / 거래처 / 세분류 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="cd-input text-[12px] shrink-0 disabled:opacity-50"
                style={{ width: "5.5rem" }}
                value={year}
                disabled={searching}
                title={searching ? "검색 중에는 전 연도에서 찾습니다" : undefined}
                onChange={(e) => setYear(e.target.value)}
              >
                {(tree?.availableYears ?? [year]).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <select className="cd-input text-[12px] flex-1 min-w-0" style={{ width: "auto" }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">용역분류 전체</option>
                {(tree?.groups ?? []).map((g) => (
                  <option key={g.serviceType} value={g.serviceType}>{g.serviceType}</option>
                ))}
              </select>
              <select className="cd-input text-[12px] flex-1 min-w-0" style={{ width: "auto" }} value={subtypeFilter} onChange={(e) => setSubtypeFilter(e.target.value)}>
                <option value="">용역세분류 전체</option>
                {subtypeOptions.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {treeLoading ? (
              <p className="p-6 text-center text-[12px] cd-text-faint">계약 목록을 불러오는 중입니다.</p>
            ) : filteredGroups.length === 0 ? (
              <p className="p-6 text-center text-[12px] cd-text-faint">표시할 계약이 없습니다.</p>
            ) : (
              filteredGroups.map((group) => {
                const style = resolveServiceTypeStyle(group.serviceType);
                const isOpen = expanded[group.serviceType] === true;
                return (
                  <div key={group.serviceType}>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => (prev[group.serviceType] ? {} : { [group.serviceType]: true }))}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[color:var(--cd-surface)] border-b cd-border-c"
                    >
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5 cd-text-faint" /> : <ChevronRight className="w-3.5 h-3.5 cd-text-faint" />}
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.parentColor }} />
                      <span className="text-[12.5px] cd-text font-semibold">{group.serviceType}</span>
                      <span className="ml-auto text-[11px] cd-text-faint">{group.contracts.length}건</span>
                    </button>
                    {isOpen &&
                      group.contracts.map((c) => (
                        <label
                          key={c.contractId}
                          className={`flex items-center gap-2 px-4 py-2 text-[12px] cursor-pointer border-b cd-border-c ${
                            contract?.contractId === c.contractId ? "cd-tint-primary" : "hover:bg-[color:var(--cd-surface)]"
                          }`}
                          onClick={() => void pickContract(c)}
                        >
                          <input
                            type="checkbox"
                            className="shrink-0"
                            checked={contract?.contractId === c.contractId}
                            onChange={() => void pickContract(c)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="truncate cd-text" title={c.contractTitle}>{c.contractTitle}</span>
                          <span className="ml-auto shrink-0 text-[10px] font-mono cd-text-faint">{c.contractDate ?? "-"}</span>
                        </label>
                      ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* 우: 종류·양식·서식 + 기재 사항(탭) */}
        <section className="cd-card rounded-3xl overflow-hidden xl:flex-[5.5] min-w-0 flex flex-col min-h-0">
          <div className="p-4 border-b cd-border-c flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(["start", "completion"] as DeliverableKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`rounded-xl px-3.5 py-1.5 text-[13px] font-semibold border ${
                    kind === k ? "cd-fill-primary border-transparent" : "cd-border-c cd-text"
                  }`}
                  onClick={() => void changeKind(k)}
                >
                  {DELIVERABLE_KIND_LABEL[k]}
                </button>
              ))}
              <span className="mx-1 h-5 w-px" style={{ background: "var(--cd-border)" }} />
              <select
                className="cd-input text-[12px] shrink-0"
                style={{ width: "15rem" }}
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  setDocTypes([]);
                  setPreviewUrl(null);
                }}
              >
                <option value="">기본양식(5대 발전사 계열)</option>
                {templates.map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.ownerFacilityName ? `${t.ownerFacilityName} — ${t.name}` : t.name}
                  </option>
                ))}
              </select>
              {kind === "completion" && milestones.length > 0 && (
                <select className="cd-input text-[12px] shrink-0" style={{ width: "14rem" }} value={milestoneId} onChange={(e) => void changeMilestone(e.target.value)}>
                  <option value="">금회 회차 — 준공(마지막) 회차</option>
                  {milestones.map((m) => (
                    <option key={m.milestoneId} value={m.milestoneId}>
                      {m.stageLabel} ({fmtMoney(m.amount)})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {catalogOptions.map((o) => {
                const on = docTypes.includes(o.docType);
                return (
                  <button
                    key={o.docType}
                    type="button"
                    className={`rounded-xl px-3 py-1.5 text-[12.5px] border ${on ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c cd-text"}`}
                    onClick={() => toggleDocType(o.docType)}
                  >
                    {o.title}
                  </button>
                );
              })}
              {catalogOptions.length === 0 && <span className="text-[12px] cd-text-faint">선택할 서식이 없습니다.</span>}
            </div>
          </div>

          {/* 기재 사항 탭 */}
          <div className="flex items-end gap-1 px-3 pt-2 border-b cd-border-c">
            {activeTabs.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setTab(g)}
                className={`rounded-t-xl px-4 py-2 text-[12.5px] font-semibold border-b-2 ${
                  tab === g ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent"
                }`}
              >
                {g}
              </button>
            ))}
            {/* 탭을 누르면 저장 후 렌더까지 수행한다(별도 버튼 없이 여기서 완결) */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTab("미리보기");
                if (contract && !previewUrl) void preview();
              }}
              className={`ml-auto rounded-t-xl px-4 py-2 text-[12.5px] font-semibold border-b-2 flex items-center gap-1.5 disabled:opacity-50 ${
                tab === "미리보기" ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent"
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> 미리보기
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!contract ? (
              <p className="text-[12.5px] cd-text-faint">좌측 트리에서 계약을 선택하세요.</p>
            ) : tab === "미리보기" ? (
              previewUrl ? (
                <iframe src={previewUrl} className="w-full h-full min-h-[560px] rounded-xl border cd-border-c" title="미리보기" />
              ) : (
                <div className="h-full min-h-[240px] rounded-xl border border-dashed cd-border-c flex flex-col items-center justify-center gap-3 text-center px-6">
                  <span className="text-[12px] cd-text-faint">
                    {busy ? "미리보기를 생성하는 중입니다." : "기재 사항을 고친 뒤에는 아래 버튼으로 다시 생성하세요."}
                  </span>
                  <button
                    type="button"
                    className="cd-btn cd-fill-primary rounded-xl px-3.5 py-2 text-[12.5px] flex items-center gap-1.5 disabled:opacity-50"
                    onClick={preview}
                    disabled={busy || !contract}
                  >
                    <Eye className="w-4 h-4" /> 미리보기 생성
                  </button>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(bindingsByGroup.get(tab) ?? []).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint flex items-center gap-1.5">
                      {BINDING_LABEL[key] ?? key}
                      <button type="button" className="cd-text-faint hover:text-[color:var(--cd-primary)]" onClick={() => toggleLock(key)}>
                        {unlocked[key] ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      </button>
                    </span>
                    {inputFor(key)}
                  </label>
                ))}
                {(bindingsByGroup.get(tab) ?? []).length === 0 && (
                  <span className="text-[12px] cd-text-faint">서식을 선택하면 기재 사항이 표시됩니다.</span>
                )}
                {/* 성과품 사진 별첨(2026-08-19 사용자 확정) — 용역결과보고서 뒤에 사진 1장 = 별첨 1페이지
                    (좌상단 '첨부자료' 표기 + 명칭 + 1x1 표 박스에 사진 fit) */}
                {tab === "준공" && docTypes.includes("service_result_report") && (
                  <div className="md:col-span-2 flex flex-col gap-2 rounded-xl border cd-border-c p-3">
                    <span className="text-[11px] font-bold cd-text">
                      성과품 사진 별첨 <span className="font-normal cd-text-faint">— 용역결과보고서 뒤에 사진 1장당 별첨 1페이지로 붙습니다</span>
                    </span>
                    {photoRefs.map((ph, i) => (
                      <div key={ph.key} className="flex items-center gap-2">
                        <span className="text-[11px] cd-text-faint shrink-0">{i + 1}.</span>
                        <input
                          className="cd-input flex-1"
                          placeholder="성과품 명칭(별첨 페이지 캡션)"
                          value={ph.name}
                          onChange={(e) => setPhotoRefs(photoRefs.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
                        />
                        <span className="text-[10.5px] cd-text-faint font-mono shrink-0">{ph.size ? `${(ph.size / 1024 / 1024).toFixed(1)}MB` : ""}</span>
                        <button
                          type="button"
                          className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0"
                          onClick={() => setPhotoRefs(photoRefs.filter((_, xi) => xi !== i))}
                          title="사진 제거"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <label className="flex items-center gap-2 rounded-lg border border-dashed cd-border-c px-3 py-2 cursor-pointer text-[11.5px] cd-text-faint self-start">
                      {photoUploading ? "업로드 중..." : "＋ 사진 추가(PNG·JPG)"}
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) void uploadPhotos(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
