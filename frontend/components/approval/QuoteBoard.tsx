"use client";

// 견적서 작성(/approval/quote) — 대외 제출 견적서 전용 기안 화면. 설계: docs/quotation-blueprint.md.
// 흐름: 기본정보(용역 분류→기준 세트 로드·발송 모드)·수신처(사업장)/참조(메일 To) →
// 사업장 탭별 [제출 견적가 입력 → MD 역산(0.5 스냅·합계-견적가 제약)] + 요율·상황 변수 조정 →
// PDF 미리보기 → 전자결재 상신(persist docIdOverride — 이중 채번 방지 패턴 유지, 공문 실사고 교훈).
// 결재선 패널·수신처 픽커는 ApprovalLetterBoard 의 것을 재사용/이식했다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookmarkPlus, Calculator, Copy, Eye, FileText, Plus, Save, Send, Settings2, Trash2, Users, X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { FacilityRecipientPicker, QuickFacilityModal, RecipientPicker } from "@/components/approval/ApprovalLetterBoard";
import type { LetterRecipient } from "@/lib/letter/types";
import {
  MD_GRADES,
  QUOTE_FORM_ID,
  QUOTE_SERVICE_OPTIONS,
  SUMMARY_SHEET_MIN_SITES,
  STANDARD_OVERHEAD_RATE,
  STANDARD_TECH_FEE_RATE,
  mdSnapUnit,
  sumOverCap,
  type MdMatrixRow,
  type QuoteFieldValues,
  type QuoteSite,
  type QuoteWorkItem,
  type SituationEntry,
} from "@/lib/quote/types";
import { computeAmounts, gradeTotals, matrixLaborCost, mdVectorTotal, reverseAllocate, validateSumConstraint } from "@/lib/quote/rates";
import "@/components/cdash/cdash.css";

// 계약관리 CONTRACT_SERVICE_OPTIONS 와 동일(전 세분류 대응 — 사용자 확정). 기준 관리 화면과 공유.
const SERVICE_OPTIONS = QUOTE_SERVICE_OPTIONS;

interface LineStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string;
  assigneePosition: string | null;
}
interface Watcher {
  userId: string;
  name: string;
  kind: "ref" | "view";
}
interface LinePreset {
  presetId: string;
  name: string;
  steps: { stepType: "agree" | "approve"; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }[];
  watchers: { userId: string; name: string | null; kind: "ref" | "view" }[];
}
type OrgTarget = "approve" | "ref";

interface RateSetData {
  set: {
    setId: string;
    version: number;
    overheadRate: number;
    techFeeRate: number;
    directExpenseRate: number;
    marketAdjust: number;
    remarksTemplate: string;
    items: QuoteWorkItem[];
    factors: { factorKey: string; label: string; unit: string }[];
    bands: { factorKey: string; minVal: number; maxVal: number | null; coef: number }[];
  } | null;
  laborRates: Record<string, number>;
  laborYear: string;
  situationCodes: { code: string; label: string }[];
}

function emptySite(seq: number, subject: string): QuoteSite {
  return {
    siteSeq: seq,
    siteLabel: `사업장 ${seq}`,
    subjectLine: subject,
    mdMatrix: [],
    freeItems: [],
    rates: {
      overheadRate: STANDARD_OVERHEAD_RATE,
      techFeeRate: STANDARD_TECH_FEE_RATE,
      directExpenseRate: 0,
      laborRates: {},
      laborYear: String(new Date().getFullYear()),
    },
    amounts: { laborCost: 0, overhead: 0, techFee: 0, directExpense: 0, sum: 0, final: 0 },
    remarks: "",
  };
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function QuoteBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const editDocId = sp.get("docId");

  const [docId, setDocId] = useState<string | null>(editDocId);
  const [subject, setSubject] = useState("");
  const [serviceType, setServiceType] = useState("통합허가");
  const [serviceSubtype, setServiceSubtype] = useState("최초허가");
  const [sendMode, setSendMode] = useState<"mail" | "direct">("mail");
  const [recipients, setRecipients] = useState<LetterRecipient[]>([]);
  const [ccRefs, setCcRefs] = useState<LetterRecipient[]>([]);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [sites, setSites] = useState<QuoteSite[]>([emptySite(1, "")]);
  const [activeSite, setActiveSite] = useState(0);
  const [situation, setSituation] = useState<SituationEntry[]>([]);
  const [rateData, setRateData] = useState<RateSetData | null>(null);
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({}); // 사업장별 제출 견적가 입력값
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [presets, setPresets] = useState<LinePreset[]>([]);
  const [orgModal, setOrgModal] = useState<OrgTarget | null>(null);
  const [facilityModal, setFacilityModal] = useState(false);
  const [busy, setBusy] = useState<"save" | "submit" | "preview" | null>(null);
  const [loading, setLoading] = useState(!!editDocId);
  const [docNo, setDocNo] = useState<string | null>(null);
  const [nextNo, setNextNo] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 공급자 블록 담당자 연락처 — E-mail 은 내 메일함 주소 자동(공문 패턴), Mobile 은 선택 입력
  const [contactEmail, setContactEmail] = useState("");
  const [contactMobile, setContactMobile] = useState("");

  useEffect(() => {
    fetch("/api/mail/mailbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.address) setContactEmail((cur) => cur || String(d.address));
      })
      .catch(() => {});
  }, []);

  const subtypeOptions = useMemo(
    () => SERVICE_OPTIONS.find((o) => o.type === serviceType)?.subtypes ?? [],
    [serviceType]
  );

  // 채번 예정 번호 — 용역 대분류에 따라 5종 시퀀스 분기(확정은 상신 시)
  useEffect(() => {
    fetch(`/api/quotes/next-no?serviceType=${encodeURIComponent(serviceType)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.nextNo && setNextNo(d.nextNo))
      .catch(() => {});
  }, [serviceType]);

  // 기준 세트 로드 — 세분류 변경 시. 세트 없으면 T3(자유 입력)로 동작(§5-2).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quotes/rate-set?serviceType=${encodeURIComponent(serviceType)}&serviceSubtype=${encodeURIComponent(serviceSubtype)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RateSetData | null) => {
        if (cancelled || !d) return;
        setRateData(d);
        // 신규 작성 중 미산정 사이트에 세트 기본 요율·단가 반영
        setSites((prev) =>
          prev.map((s) =>
            s.amounts.final > 0
              ? s
              : {
                  ...s,
                  rates: {
                    setId: d.set?.setId,
                    setVersion: d.set?.version,
                    overheadRate: d.set?.overheadRate ?? STANDARD_OVERHEAD_RATE,
                    techFeeRate: d.set?.techFeeRate ?? STANDARD_TECH_FEE_RATE,
                    directExpenseRate: d.set?.directExpenseRate ?? 0,
                    laborRates: d.laborRates,
                    laborYear: d.laborYear,
                  },
                  remarks: s.remarks || (d.set?.remarksTemplate ?? ""),
                }
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serviceType, serviceSubtype]);

  // 결재선 프리셋
  useEffect(() => {
    fetch("/api/approval/line-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d?.presets) && setPresets(d.presets))
      .catch(() => {});
  }, []);

  // 재편집(임시저장/반려) — field_values 복원
  useEffect(() => {
    if (!editDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/approval/docs/${encodeURIComponent(editDocId)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
        if (cancelled) return;
        const d = data.doc;
        const v = (d.fieldValues ?? {}) as Partial<QuoteFieldValues>;
        setDocNo(d.docNo ?? null);
        setSubject(d.title ?? "");
        if (v.service_type) setServiceType(v.service_type);
        if (v.service_subtype) setServiceSubtype(v.service_subtype);
        if (v.send_mode) setSendMode(v.send_mode);
        setRecipients(Array.isArray(v.recipients) ? (v.recipients as LetterRecipient[]) : []);
        setCcRefs(Array.isArray(v.cc_refs) ? (v.cc_refs as LetterRecipient[]) : []);
        if (v.issue_date) setIssueDate(v.issue_date);
        if (v.contact_email) setContactEmail(v.contact_email);
        if (v.contact_mobile) setContactMobile(v.contact_mobile);
        if (Array.isArray(v.sites) && v.sites.length) {
          setSites(v.sites);
          setPriceInputs(Object.fromEntries(v.sites.map((s) => [s.siteSeq, s.amounts.final ? String(s.amounts.final) : ""])));
        }
        setSituation(Array.isArray(v.situation) ? v.situation : []);
        setLine(
          (d.steps ?? []).map((s: { stepType: string; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }) => ({
            stepType: s.stepType === "agree" ? "agree" : "approve",
            assigneeUserId: s.assigneeUserId,
            assigneeName: s.assigneeName ?? "",
            assigneePosition: s.assigneePosition,
          }))
        );
        setWatchers(
          (d.watchers ?? []).map((w: { userId: string; name: string | null; kind: string }) => ({
            userId: w.userId,
            name: w.name ?? "",
            kind: w.kind === "view" ? "view" : "ref",
          }))
        );
      } catch (err) {
        alert((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editDocId]);

  const applyPreset = (p: LinePreset) => {
    setLine(p.steps.map((s) => ({ stepType: s.stepType === "agree" ? "agree" : "approve", assigneeUserId: s.assigneeUserId, assigneeName: s.assigneeName ?? "", assigneePosition: s.assigneePosition })));
    setWatchers(p.watchers.map((w) => ({ userId: w.userId, name: w.name ?? "", kind: w.kind === "view" ? "view" : "ref" })));
  };

  const saveAsPreset = async () => {
    if (line.length === 0) return alert("저장할 결재선이 없습니다.");
    const name = window.prompt("결재선 프리셋 이름을 입력하세요.", "");
    if (name == null) return;
    try {
      const res = await fetch("/api/approval/line-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          steps: line.map((s) => ({ stepType: s.stepType, assigneeUserId: s.assigneeUserId, assigneeName: s.assigneeName, assigneePosition: s.assigneePosition })),
          watchers: watchers.map((w) => ({ userId: w.userId, name: w.name, kind: w.kind })),
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "프리셋 저장 실패");
      const listRes = await fetch("/api/approval/line-presets", { cache: "no-store" });
      if (listRes.ok) setPresets((await listRes.json()).presets ?? []);
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const deletePreset = async (presetId: string) => {
    try {
      await fetch(`/api/approval/line-presets?presetId=${encodeURIComponent(presetId)}`, { method: "DELETE" });
      setPresets((prev) => prev.filter((p) => p.presetId !== presetId));
    } catch {
      // 무시
    }
  };

  const updateSite = useCallback((idx: number, patch: Partial<QuoteSite>) => {
    setSites((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  /** 제출 견적가 → MD 역산(§5-1-c). 기준 세트 항목이 있어야 동작(T1/T2). */
  const runReverse = useCallback(
    (idx: number) => {
      const site = sites[idx];
      const price = Number(String(priceInputs[site.siteSeq] ?? "").replace(/[^\d]/g, ""));
      if (!price) return alert("제출 견적가를 입력하세요.");
      const items = rateData?.set?.items ?? [];
      if (!items.length) return alert("이 세분류는 산정 기준 세트가 없어 자유 입력(품목 직접 입력)으로 작성합니다.");
      const rates = { ...site.rates, laborRates: rateData!.laborRates, laborYear: rateData!.laborYear };
      const res = reverseAllocate({ price, items, rates });
      updateSite(idx, {
        mdMatrix: res.mdMatrix,
        rates,
        amounts: res.amounts,
        freeItems: [],
      });
      if (!res.ok) alert("⚠ 역산 결과가 합계-견적가 제약(초과폭 상한)을 벗어났습니다. MD 를 수동 조정하거나 요율을 확인하세요.");
    },
    [sites, priceInputs, rateData, updateSite]
  );

  /** MD 셀 수동 편집 → 금액 재계산(제약 실시간 검증은 요약 카드에서) */
  const editMdCell = useCallback(
    (idx: number, rowIdx: number, grade: (typeof MD_GRADES)[number], value: number) => {
      const site = sites[idx];
      const rows: MdMatrixRow[] = site.mdMatrix.map((r, i) => (i === rowIdx ? { ...r, md: { ...r.md, [grade]: value }, overridden: true } : r));
      // 대항목 소계 재계산
      for (const r of rows) {
        const children = rows.filter((c) => c.parentId === r.itemId);
        if (children.length) {
          const md: MdMatrixRow["md"] = {};
          for (const g of MD_GRADES) {
            const v = children.reduce((acc, c) => acc + (c.md[g] ?? 0), 0);
            if (v) md[g] = Math.round(v * 1000) / 1000;
          }
          r.md = md;
        }
      }
      const laborCost = matrixLaborCost(rows, site.rates.laborRates);
      const base = computeAmounts(laborCost, site.rates);
      updateSite(idx, { mdMatrix: rows, amounts: { ...base, final: site.amounts.final, standard: site.amounts.standard } });
    },
    [sites, updateSite]
  );

  /** 요율 변경 → 금액 재계산 */
  const editRate = useCallback(
    (idx: number, key: "overheadRate" | "techFeeRate" | "directExpenseRate", value: number) => {
      const site = sites[idx];
      const rates = { ...site.rates, [key]: value };
      const laborCost = matrixLaborCost(site.mdMatrix, rates.laborRates);
      const base = computeAmounts(laborCost, rates);
      updateSite(idx, { rates, amounts: { ...base, final: site.amounts.final, standard: site.amounts.standard } });
    },
    [sites, updateSite]
  );

  const buildFieldValues = useCallback((): QuoteFieldValues => {
    const totalFinal = sites.reduce((a, s) => a + (s.amounts.final || 0), 0);
    return {
      subject,
      service_type: serviceType,
      service_subtype: serviceSubtype,
      send_mode: sendMode,
      recipients: recipients as QuoteFieldValues["recipients"],
      cc_refs: ccRefs as QuoteFieldValues["cc_refs"],
      issue_date: issueDate,
      contact_email: contactEmail || undefined,
      contact_mobile: contactMobile || undefined,
      sites,
      situation: situation.length ? situation : undefined,
      // 양식별 조회 표시용
      ...( {
        recipients_display: recipients.map((r) => r.name).join(", "),
        quote_summary_display: `${serviceSubtype} · ${sites.length}개 사업장 · ${won(totalFinal)}원`,
      } as Partial<QuoteFieldValues>),
    };
  }, [subject, serviceType, serviceSubtype, sendMode, recipients, ccRefs, issueDate, contactEmail, contactMobile, sites, situation]);

  const persist = useCallback(
    // docIdOverride: save 직후 submit — setDocId 비동기로 인한 이중 문서·채번 이중 소모 방지(공문 실사고 교훈)
    async (action: "save" | "submit", docIdOverride?: string): Promise<{ docId: string; docNo?: string | null }> => {
      const res = await fetch("/api/approval/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          docId: docIdOverride ?? docId,
          formId: QUOTE_FORM_ID,
          title: subject,
          urgent: false,
          fieldValues: buildFieldValues(),
          line,
          watchers: watchers.map((w) => ({ userId: w.userId, kind: w.kind })),
          refDocId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDocId(data.docId);
      return { docId: data.docId, docNo: data.docNo };
    },
    [docId, subject, buildFieldValues, line, watchers]
  );

  const validate = useCallback((): string | null => {
    if (!subject.trim()) return "건명을 입력하세요.";
    if (recipients.length === 0) return "수신처(사업장/기관)를 1건 이상 지정하세요.";
    if (sendMode === "mail" && !ccRefs.some((r) => (r.email ?? "").includes("@")))
      return "메일 발송 모드는 참조 담당자에 메일주소가 1건 이상 필요합니다(발송 안 함 모드로 바꾸거나 참조자를 추가하세요).";
    for (const s of sites) {
      if (!s.siteLabel.trim()) return "사업장 라벨을 입력하세요.";
      if (!s.subjectLine.trim()) return `[${s.siteLabel}] 사업장별 건명을 입력하세요.`;
      if (!(s.amounts.final > 0)) return `[${s.siteLabel}] 제출 견적가를 입력하고 산정을 실행하세요.`;
      const hasMd = s.mdMatrix.length > 0;
      const hasFree = (s.freeItems ?? []).length > 0;
      if (!hasMd && !hasFree) return `[${s.siteLabel}] MD 산정 또는 품목 직접 입력이 필요합니다.`;
      if (hasMd) {
        const check = validateSumConstraint(s.amounts.final, s.amounts.sum);
        if (!check.ok)
          return `[${s.siteLabel}] 합계(${won(s.amounts.sum)}원)가 제약을 벗어났습니다 — 견적가보다 크고 초과폭이 ${won(check.cap)}원 미만이어야 합니다.`;
      }
    }
    if (line.length === 0) return "결재선에 결재자를 1명 이상 추가하세요.";
    return null;
  }, [subject, recipients, ccRefs, sendMode, sites, line]);

  const openPreview = useCallback(async () => {
    setBusy("preview");
    setPreviewOpen(true);
    try {
      const res = await fetch("/api/quotes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: buildFieldValues(), quoteNo: docNo ?? nextNo ?? "미채번", issueDate }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "미리보기 생성 실패");
      const blob = await res.blob();
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, [buildFieldValues, docNo, nextNo, issueDate]);

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (action === "submit") {
        const msg = validate();
        if (msg) return alert(msg);
      }
      setBusy(action);
      try {
        const saved = await persist("save");
        if (action === "save") {
          alert("임시저장되었습니다.");
          return;
        }
        const done = await persist("submit", saved.docId);
        alert(
          `상신되었습니다. 견적번호: ${done.docNo}\n결재 승인이 완료되면 ${sendMode === "mail" ? "참조자 메일로 PDF 가 자동 발송됩니다." : "PDF/xlsx 가 생성됩니다(발송견적 탭에서 다운로드해 직접 제출)."}`
        );
        router.push("/approval");
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [validate, persist, sendMode, router]
  );

  const site = sites[activeSite];
  const tier: "calc" | "free" = (rateData?.set?.items?.length ?? 0) > 0 ? "calc" : "free";

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <div className="flex flex-col gap-5 min-h-0">
        <CdPageHeader title="견적서 작성" />
        {loading ? (
          <div className="cd-card rounded-3xl p-10 text-center text-sm cd-text-faint">불러오는 중...</div>
        ) : (
          <div className="flex flex-col xl:flex-row gap-5 items-start">
            {/* 좌: 기본정보 + 사업장 탭 */}
            <div className="flex-1 min-w-0 flex flex-col gap-4 w-full">
              {/* 기본정보 */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-3.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 cd-text-primary" /> 기본 정보
                  </h3>
                  <span className="ml-auto text-[11px] cd-text-faint">
                    견적번호 {docNo ? <b className="cd-text">{docNo}</b> : <>예정 <b className="cd-text">{nextNo ?? "..."}</b></>}
                  </span>
                  <a
                    href="/approval/quote/settings"
                    className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                    title="세분류별 MD 기준·요율·노임단가 관리(관리 권한)"
                  >
                    <Settings2 className="w-3.5 h-3.5" /> 기준 관리
                  </a>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                  <div className="md:col-span-2 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">건명(전체)</span>
                    <input className="cd-input text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: OOO㈜ OO공장 통합환경허가 취득 용역" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">용역 분류</span>
                    <select
                      className="cd-select"
                      value={serviceType}
                      onChange={(e) => {
                        const t = e.target.value;
                        const subs = SERVICE_OPTIONS.find((o) => o.type === t)?.subtypes ?? [];
                        setServiceType(t);
                        if (!subs.includes(serviceSubtype)) setServiceSubtype(subs[0] ?? "");
                      }}
                    >
                      {SERVICE_OPTIONS.map((o) => (
                        <option key={o.type} value={o.type}>{o.type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">용역 세분류</span>
                    <select className="cd-select" value={serviceSubtype} onChange={(e) => setServiceSubtype(e.target.value)}>
                      {subtypeOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">견적일</span>
                    <input type="date" className="cd-input text-sm" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">담당자 Mobile (견적서 공급자란 표기, 선택)</span>
                    <input className="cd-input text-sm" value={contactMobile} onChange={(e) => setContactMobile(e.target.value)} placeholder="010-0000-0000" />
                  </div>
                  <div className="md:col-span-3 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">발송 방식 — 승인 완료 후 처리</span>
                    <div className="flex items-center gap-4 h-9">
                      <label className="flex items-center gap-1.5 text-[12.5px] cd-text cursor-pointer">
                        <input type="radio" checked={sendMode === "mail"} onChange={() => setSendMode("mail")} />
                        메일 발송 <span className="cd-text-faint text-[11px]">(참조자 메일로 PDF 자동 발송)</span>
                      </label>
                      <label className="flex items-center gap-1.5 text-[12.5px] cd-text cursor-pointer">
                        <input type="radio" checked={sendMode === "direct"} onChange={() => setSendMode("direct")} />
                        발송 안 함 · 직접 제출 <span className="cd-text-faint text-[11px]">(PDF 다운로드 → 전자조달시스템 등)</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1 border-t cd-border-c">
                  <FacilityRecipientPicker list={recipients} onChange={setRecipients} onNewFacility={() => setFacilityModal(true)} />
                  <RecipientPicker
                    label="참조 담당자"
                    hint={sendMode === "mail" ? "실제 메일 발송 대상(To) — 1건 이상 필요" : "직접 제출 모드에서는 선택"}
                    list={ccRefs}
                    onChange={setCcRefs}
                  />
                </div>
              </div>

              {/* 사업장 탭 */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-3.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2 mr-1">
                    <Calculator className="w-4 h-4 cd-text-primary" /> 사업장별 견적
                  </h3>
                  {sites.map((s, i) => (
                    <button
                      key={s.siteSeq}
                      type="button"
                      className={`cd-btn rounded-lg border px-2.5 py-1 text-[11.5px] ${i === activeSite ? "cd-tint-primary font-semibold" : "cd-border-c cd-text-faint"}`}
                      onClick={() => setActiveSite(i)}
                    >
                      {s.siteLabel}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="cd-btn rounded-lg border border-dashed cd-border-c px-2 py-1 text-[11.5px] cd-text-faint"
                    onClick={() => {
                      const seq = Math.max(0, ...sites.map((s) => s.siteSeq)) + 1;
                      const base = emptySite(seq, subject);
                      if (rateData) {
                        base.rates = {
                          setId: rateData.set?.setId,
                          setVersion: rateData.set?.version,
                          overheadRate: rateData.set?.overheadRate ?? STANDARD_OVERHEAD_RATE,
                          techFeeRate: rateData.set?.techFeeRate ?? STANDARD_TECH_FEE_RATE,
                          directExpenseRate: rateData.set?.directExpenseRate ?? 0,
                          laborRates: rateData.laborRates,
                          laborYear: rateData.laborYear,
                        };
                        base.remarks = rateData.set?.remarksTemplate ?? "";
                      }
                      setSites((prev) => [...prev, base]);
                      setActiveSite(sites.length);
                    }}
                  >
                    <Plus className="w-3 h-3 inline" /> 사업장 추가
                  </button>
                  {sites.length > 1 && (
                    <button
                      type="button"
                      className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[11px] cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                      onClick={() => {
                        if (!confirm(`[${site.siteLabel}] 사업장을 삭제할까요?`)) return;
                        setSites((prev) => prev.filter((_, i) => i !== activeSite));
                        setActiveSite(0);
                      }}
                    >
                      <Trash2 className="w-3 h-3 inline" /> 삭제
                    </button>
                  )}
                  <span className="ml-auto text-[10.5px] cd-text-faint">
                    {sites.length >= SUMMARY_SHEET_MIN_SITES ? "사업장 4개 이상 — 총괄 견적서 자동 생성" : `사업장 ${sites.length}개`}
                  </span>
                </div>

                {site && (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">사업장 라벨(시트명·총괄 표기)</span>
                        <input className="cd-input text-sm" value={site.siteLabel} onChange={(e) => updateSite(activeSite, { siteLabel: e.target.value })} />
                      </div>
                      <div className="md:col-span-2 flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">사업장별 건명(견적서 시트 표기)</span>
                        <input className="cd-input text-sm" value={site.subjectLine} onChange={(e) => updateSite(activeSite, { subjectLine: e.target.value })} placeholder={subject || "예: OO공장 통합환경허가 취득 용역"} />
                      </div>
                    </div>

                    {/* 견적가 입력 → 역산 (T1/T2) 또는 자유 품목 (T3) */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold cd-text">제출 견적가(VAT 별도)</span>
                        <input
                          className="cd-input text-sm w-44 text-right"
                          inputMode="numeric"
                          value={priceInputs[site.siteSeq] ?? (site.amounts.final ? String(site.amounts.final) : "")}
                          onChange={(e) => setPriceInputs((prev) => ({ ...prev, [site.siteSeq]: e.target.value.replace(/[^\d]/g, "") }))}
                          placeholder="예: 38000000"
                        />
                        <span className="text-[11px] cd-text-faint">
                          {(() => {
                            const p = Number(priceInputs[site.siteSeq] ?? 0);
                            return p > 0 ? `${won(p)}원 · 스냅 ${mdSnapUnit(p)}MD · 초과폭 상한 ${won(sumOverCap(p))}원` : "";
                          })()}
                        </span>
                        {tier === "calc" ? (
                          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => runReverse(activeSite)}>
                            MD 역산 실행
                          </button>
                        ) : (
                          <span className="text-[11px] cd-text-faint">이 세분류는 기준 세트 미등록 — 품목 직접 입력(자유형)</span>
                        )}
                        <div className="ml-auto flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-3 text-[11.5px]">
                            <label className="flex items-center gap-1 whitespace-nowrap">제경비 요율
                              <input className="cd-input w-12 text-right text-[12px] px-1.5" value={String(Math.round(site.rates.overheadRate * 100))} onChange={(e) => editRate(activeSite, "overheadRate", Number(e.target.value) / 100 || 0)} />%
                            </label>
                            <label className="flex items-center gap-1 whitespace-nowrap">기술료 요율
                              <input className="cd-input w-12 text-right text-[12px] px-1.5" value={String(Math.round(site.rates.techFeeRate * 100))} onChange={(e) => editRate(activeSite, "techFeeRate", Number(e.target.value) / 100 || 0)} />%
                            </label>
                            <label className="flex items-center gap-1 whitespace-nowrap">직접경비 요율
                              <input className="cd-input w-12 text-right text-[12px] px-1.5" value={String(Math.round(site.rates.directExpenseRate * 100))} onChange={(e) => editRate(activeSite, "directExpenseRate", Number(e.target.value) / 100 || 0)} />%
                            </label>
                          </div>
                          <span className="text-[10.5px] cd-text-faint whitespace-nowrap">V.A.T 별도 · 유효기간 견적일로부터 1개월</span>
                        </div>
                      </div>

                      {/* 금액 요약 + 제약 상태 */}
                      {site.amounts.final > 0 && (
                        <div className="flex items-center gap-4 flex-wrap text-[12px] cd-text">
                          <span>직접인건비 <b>{won(site.amounts.laborCost)}</b></span>
                          <span>제경비 <b>{won(site.amounts.overhead)}</b></span>
                          <span>기술료 <b>{won(site.amounts.techFee)}</b></span>
                          {site.amounts.directExpense > 0 && <span>직접경비 <b>{won(site.amounts.directExpense)}</b></span>}
                          <span>합계 <b>{won(site.amounts.sum)}</b></span>
                          <span className="font-bold cd-text-primary">최종 견적 {won(site.amounts.final)}원</span>
                          {site.mdMatrix.length > 0 &&
                            (() => {
                              const c = validateSumConstraint(site.amounts.final, site.amounts.sum);
                              return c.ok ? (
                                <span className="text-[11px] rounded-full px-2 py-0.5 cd-tint-primary">제약 OK (초과 {won(c.over)}원 &lt; {won(c.cap)}원)</span>
                              ) : (
                                <span className="text-[11px] rounded-full px-2 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">
                                  ⚠ 제약 위반 — 합계-견적가 {won(c.over)}원 (0 초과 {won(c.cap)}원 미만이어야 상신 가능)
                                </span>
                              );
                            })()}
                        </div>
                      )}

                      {/* MD 그리드 (T1/T2) */}
                      {tier === "calc" && site.mdMatrix.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11.5px] border-collapse min-w-[680px]">
                            <thead>
                              <tr>
                                <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">항목 (별첨1)</th>
                                {MD_GRADES.map((g) => (
                                  <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold w-24">{g}(MD)</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {site.mdMatrix.map((r, ri) => {
                                const isParent = site.mdMatrix.some((c) => c.parentId === r.itemId);
                                return (
                                  <tr key={r.itemId} className={isParent ? "cd-tint-primary/40 font-semibold" : ""}>
                                    <td className={`border cd-border-c px-2 py-1 ${r.parentId ? "pl-5" : "font-semibold"}`}>
                                      {r.label}
                                      {r.overridden && <span className="ml-1 text-[9px] cd-text-primary" title="수동 조정됨">●</span>}
                                    </td>
                                    {MD_GRADES.map((g) => (
                                      <td key={g} className="border cd-border-c px-1 py-0.5 text-center">
                                        {isParent ? (
                                          <span className="cd-text-faint">{r.md[g] ?? 0}</span>
                                        ) : (
                                          <input
                                            className="w-full bg-transparent text-center outline-none"
                                            value={String(r.md[g] ?? 0)}
                                            onChange={(e) => editMdCell(activeSite, ri, g, Number(e.target.value) || 0)}
                                          />
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                              <tr className="font-bold">
                                <td className="border cd-border-c px-2 py-1.5">총 계(MD)</td>
                                {(() => {
                                  const t = gradeTotals(site.mdMatrix);
                                  return MD_GRADES.map((g) => (
                                    <td key={g} className="border cd-border-c px-2 py-1.5 text-center">{t[g] ?? 0}</td>
                                  ));
                                })()}
                              </tr>
                            </tbody>
                          </table>
                          <p className="text-[10.5px] cd-text-faint mt-1">
                            총 {mdVectorTotal(gradeTotals(site.mdMatrix))}MD · 셀을 직접 수정할 수 있습니다(수정 후에도 합계-견적가 제약을 지켜야 상신 가능).
                          </p>
                        </div>
                      )}

                      {/* 자유 품목 (T3) */}
                      {tier === "free" && (
                        <div className="flex flex-col gap-1.5">
                          {(site.freeItems ?? []).map((it, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input className="cd-input text-sm flex-1" value={it.label} placeholder="품명 및 내용" onChange={(e) => {
                                const next = [...(site.freeItems ?? [])];
                                next[i] = { ...next[i], label: e.target.value };
                                updateSite(activeSite, { freeItems: next });
                              }} />
                              <input className="cd-input text-sm w-36 text-right" inputMode="numeric" value={String(it.amount || "")} placeholder="금액(원)" onChange={(e) => {
                                const next = [...(site.freeItems ?? [])];
                                next[i] = { ...next[i], amount: Number(e.target.value.replace(/[^\d]/g, "")) || 0 };
                                const sum = next.reduce((a, x) => a + x.amount, 0);
                                const price = Number(priceInputs[site.siteSeq] ?? 0) || sum;
                                updateSite(activeSite, { freeItems: next, amounts: { ...site.amounts, laborCost: 0, overhead: 0, techFee: 0, directExpense: 0, sum, final: price } });
                              }} />
                              <input className="cd-input text-sm w-44" value={it.note ?? ""} placeholder="비고" onChange={(e) => {
                                const next = [...(site.freeItems ?? [])];
                                next[i] = { ...next[i], note: e.target.value };
                                updateSite(activeSite, { freeItems: next });
                              }} />
                              <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => {
                                const next = (site.freeItems ?? []).filter((_, xi) => xi !== i);
                                const sum = next.reduce((a, x) => a + x.amount, 0);
                                updateSite(activeSite, { freeItems: next, amounts: { ...site.amounts, sum, final: Number(priceInputs[site.siteSeq] ?? 0) || sum } });
                              }}>
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint self-start" onClick={() => {
                            updateSite(activeSite, { freeItems: [...(site.freeItems ?? []), { label: "", amount: 0 }] });
                          }}>
                            ＋ 품목 추가
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 특이사항 */}
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">특이사항 (견적서 시트 하단)</span>
                      <textarea className="cd-input text-[12.5px] min-h-[84px]" value={site.remarks} onChange={(e) => updateSite(activeSite, { remarks: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>

              {/* 상황 변수 (건별 상황 조정 레이어 — 내부 기록용, 문서에 표기되지 않음) */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-2.5">
                <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                  <Copy className="w-4 h-4 cd-text-primary" /> 상황 변수
                  <span className="text-[10.5px] font-normal cd-text-faint">가격 결정 배경 기록(내부용) — 수주율 분석의 원료가 됩니다</span>
                </h3>
                {situation.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select className="cd-select w-52" value={s.code} onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, code: e.target.value } : x)))}>
                      {(rateData?.situationCodes ?? []).map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-[11.5px] cd-text-faint">조정률
                      <input className="cd-input w-16 text-right text-[12px]" value={s.rate != null ? String(Math.round(s.rate * 100)) : ""} placeholder="-5" onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, rate: e.target.value === "" ? undefined : Number(e.target.value) / 100 } : x)))} />%
                    </label>
                    <input className="cd-input text-sm flex-1 min-w-[160px]" value={s.memo ?? ""} placeholder="메모 (예: 경쟁사 OO 저가 투찰 예상)" onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, memo: e.target.value } : x)))} />
                    <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setSituation((prev) => prev.filter((_, xi) => xi !== i))}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint self-start" onClick={() => setSituation((prev) => [...prev, { code: rateData?.situationCodes?.[0]?.code ?? "nego", scope: "doc" }])}>
                  ＋ 상황 변수 추가
                </button>
              </div>
            </div>

            {/* 우: 결재선 (ApprovalLetterBoard/DraftBoard 이식) */}
            <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
              <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                <Users className="w-4 h-4 cd-text-primary" /> 결재선
                <span className="ml-auto text-[11px] font-normal cd-text-faint">기안 → 위에서 아래 순서</span>
              </h3>
              {presets.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10.5px] cd-text-faint mr-0.5">불러오기</span>
                  {presets.map((p) => (
                    <span key={p.presetId} className="inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                      <button type="button" className="text-[11px] px-2 py-0.5 hover:cd-tint-primary" onClick={() => applyPreset(p)} title="이 결재선 불러오기">{p.name}</button>
                      <button type="button" className="text-[10px] px-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => deletePreset(p.presetId)} title="프리셋 삭제">×</button>
                    </span>
                  ))}
                </div>
              )}
              {line.length === 0 && <p className="text-[12px] cd-text-faint">아래 버튼으로 합의/승인 결재자를 추가하세요.</p>}
              <div className="flex flex-col gap-1.5">
                {line.map((s, i) => (
                  <div key={`${s.assigneeUserId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                    <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                    <select className="cd-select" style={{ width: 70 }} value={s.stepType} onChange={(e) => setLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, stepType: e.target.value as "agree" | "approve" } : x)))}>
                      <option value="agree">합의</option>
                      <option value="approve">승인</option>
                    </select>
                    <span className="text-[12.5px] cd-text truncate flex-1">
                      {s.assigneeName}
                      {s.assigneePosition ? <span className="cd-text-faint text-[11px]"> {s.assigneePosition}</span> : null}
                    </span>
                    <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setLine((prev) => prev.filter((_, xi) => xi !== i))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex-1" onClick={() => setOrgModal("approve")}>
                  ＋ 결재자 추가
                </button>
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-[11px] cd-text-faint flex items-center gap-1" onClick={saveAsPreset} title="현재 결재선·참조자를 프리셋으로 저장">
                  <BookmarkPlus className="w-3.5 h-3.5" /> 프리셋 저장
                </button>
              </div>
              <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
                <h4 className="font-bold cd-text text-[12.5px] flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 cd-text-primary" /> 참조 · 열람
                  <span className="ml-auto text-[10px] font-normal cd-text-faint">사내 참조(결재 시스템)</span>
                </h4>
                {watchers.length === 0 ? (
                  <p className="text-[11px] cd-text-faint">필요 시 사내 참조/열람자를 지정하세요(선택).</p>
                ) : (
                  watchers.map((w, i) => (
                    <div key={`${w.userId}-${i}`} className="rounded-xl border cd-border-c px-3 py-1.5 flex items-center gap-2">
                      <select className="cd-select" style={{ width: 66 }} value={w.kind} onChange={(e) => setWatchers((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as "ref" | "view" } : x)))}>
                        <option value="ref">참조</option>
                        <option value="view">열람</option>
                      </select>
                      <span className="text-[12px] cd-text truncate flex-1">{w.name}</span>
                      <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="제거" onClick={() => setWatchers((prev) => prev.filter((_, xi) => xi !== i))}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
                <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint" onClick={() => setOrgModal("ref")}>
                  ＋ 참조/열람자 추가
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={() => send("save")}>
                  <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
                </button>
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={openPreview} title="현재 내용을 견적서 PDF 로 미리보기">
                  <FileText className="w-3.5 h-3.5" /> {busy === "preview" ? "생성 중..." : "미리보기"}
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={() => send("submit")}>
                  <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
                </button>
              </div>
              <p className="text-[10.5px] cd-text-faint">
                승인 완료 시 견적번호 채번 → xlsx/PDF 생성 → {sendMode === "mail" ? "참조자 메일 자동 발송(PDF)" : "발송견적 탭에서 다운로드(직접 제출)"} 순으로 처리됩니다.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PDF 미리보기 모달 */}
      {previewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={() => setPreviewOpen(false)}>
          <div className="rounded-2xl bg-[color:var(--cd-card)] shadow-2xl w-full max-w-[1400px] h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center px-4 py-2.5 border-b cd-border-c">
              <span className="text-sm font-bold cd-text">견적서 미리보기</span>
              <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setPreviewOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-[color:var(--cd-surface)]">
              {previewUrl ? (
                <iframe title="견적서 미리보기" src={previewUrl} className="w-full h-full" />
              ) : (
                <div className="h-full flex items-center justify-center text-sm cd-text-faint">생성 중...</div>
              )}
            </div>
          </div>
        </div>
      )}

      {facilityModal && (
        <QuickFacilityModal
          theme={theme}
          onClose={() => setFacilityModal(false)}
          onCreated={(r) => {
            setRecipients((prev) => [...prev, r]);
            setFacilityModal(false);
          }}
        />
      )}

      <OrgPickerModal
        open={orgModal != null}
        title={orgModal === "ref" ? "참조/열람자 추가 — 조직도에서 선택" : "결재자 추가 — 조직도에서 선택"}
        hint={orgModal === "ref" ? "인원을 클릭하면 참조/열람자로 추가됩니다." : "인원을 클릭하면 결재선 맨 뒤에 추가됩니다. 타입(합의/승인)은 목록에서 변경하세요."}
        onClose={() => setOrgModal(null)}
        onSelect={(emp) => {
          if (!orgModal) return;
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const userId = emp.userId;
          if (orgModal === "ref") {
            setWatchers((prev) => (prev.some((w) => w.userId === userId) ? prev : [...prev, { userId, name: emp.name, kind: "ref" }]));
          } else {
            setLine((prev) =>
              prev.some((s) => s.assigneeUserId === userId)
                ? prev
                : [...prev, { stepType: "approve", assigneeUserId: userId, assigneeName: emp.name, assigneePosition: emp.positionName }]
            );
          }
        }}
      />
    </div>
  );
}
