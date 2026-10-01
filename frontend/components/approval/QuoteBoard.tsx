"use client";

// 견적서 작성(/approval/quote) — 대외 제출 견적서 전용 기안 화면. 설계: docs/quotation-blueprint.md.
// 흐름: 기본정보(용역 분류→기준 세트 로드·발송 모드)·수신처(사업장)/참조(메일 To) →
// 사업장 탭별 [제출 견적가 입력 → MD 역산(0.5 스냅·합계-견적가 제약)] + 요율·상황 변수 조정 →
// PDF 미리보기 → 전자결재 상신(persist docIdOverride — 이중 채번 방지 패턴 유지, 공문 실사고 교훈).
// 복수 업무(2026-10-01): 세분류 '복수 업무'는 기준 세트 대신 사업장별 구성 업무(세분류×횟수) 태그와
// 업무 항목 트리(수동 입력 또는 산출내역서 엑셀 자동 분석)를 역산 기준으로 쓴다.
// 사업장 전용 기준 세트(270): 수신처 사업장에 전용 세트가 있으면 표준 세트 대신 적용(전환 가능).
// 결재선 패널·수신처 픽커는 ApprovalLetterBoard 의 것을 재사용/이식했다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookmarkPlus, Building2, Calculator, Copy, Eye, FileSpreadsheet, FileText, History, ListPlus, Plus, Save, Send, Settings2, Trash2, Users, X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AutosaveStatus, useAutosave } from "@/components/approval/useAutosave";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import { AmountInput } from "@/components/ui/AmountInput";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { QuoteItemTreeEditor } from "@/components/approval/QuoteItemTreeEditor";
import { FacilityRecipientPicker, QuickFacilityModal, RecipientPicker } from "@/components/approval/ApprovalLetterBoard";
import { DeleteDraftButton, RejectedBanner, toEditDocMeta, type EditDocMeta } from "@/components/approval/DraftEditNotice";
import type { LetterRecipient } from "@/lib/letter/types";
import {
  DEFAULT_MD_GRADES,
  ENG_DEDUCTION_BANDS,
  ENG_DEDUCTION_STAGE2_RATE,
  ENG_DEDUCTION_STD_YEARS,
  QUOTE_FORM_ID,
  QUOTE_MULTI_SUBTYPE,
  QUOTE_MULTI_WORK_MAX,
  QUOTE_REVISION_REASONS,
  QUOTE_REVISION_REASON_LABEL,
  QUOTE_SERVICE_OPTIONS,
  SUMMARY_SHEET_MIN_SITES,
  deductionCostOf,
  engineeringDeduction,
  STANDARD_OVERHEAD_RATE,
  STANDARD_TECH_FEE_RATE,
  fixedDirectExpense,
  formatQuoteNo,
  mdSnapUnit,
  parseQuoteNo,
  sortGrades,
  printCostOf,
  quoteNoLabel,
  sumOverCap,
  travelCostOf,
  travelTripsOf,
  treeRowsToWorkItems,
  workItemsToTreeRows,
  type DirectCosts,
  type MdMatrixRow,
  type QuoteFieldValues,
  type QuoteRevisionItem,
  type QuoteRevisionReason,
  type QuoteSite,
  type QuoteTreeRow,
  type QuoteWorkItem,
  type QuoteWorkTag,
  type SituationEntry,
} from "@/lib/quote/types";
import { computeAmounts, gradeTotals, matrixLaborCost, mdVectorTotal, priceFromSum, reverseAllocate, validateSumConstraint } from "@/lib/quote/rates";
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
  position?: string | null; // 직함 — 결재선 태그와 같은 표기(2026-10-01)
  kind: "ref" | "view";
}
interface LinePreset {
  presetId: string;
  name: string;
  steps: { stepType: "agree" | "approve"; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }[];
  watchers: { userId: string; name: string | null; kind: "ref" | "view" }[];
}
type OrgTarget = "approve" | "ref";

interface RateSet {
  setId: string;
  version: number;
  overheadRate: number;
  techFeeRate: number;
  directExpenseRate: number;
  marketAdjust: number;
  /** 세트별 기술등급 축(가변, 143) */
  grades?: string[];
  remarksTemplate: string;
  items: QuoteWorkItem[];
  factors: { factorKey: string; label: string; unit: string }[];
  bands: { factorKey: string; minVal: number; maxVal: number | null; coef: number }[];
}
interface RateSetData {
  set: RateSet | null; // 표준 세트
  /** 수신처 사업장 전용 세트(270) — 있으면 표준 대신 적용할 수 있다 */
  facilitySet?: (RateSet & { facilityId: string; facilityName: string }) | null;
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
const shortDate = (s: string | null | undefined) => (s ? s.slice(0, 10) : "-");
const DOC_STATUS_LABEL: Record<string, string> = { approved: "승인", rejected: "반려", draft: "작성 중", withdrawn: "회수" };

/** 업무 항목 트리(편집 행)의 등급별 기준 MD 합계 — 세부항목만 */
function treeGradeTotals(rows: QuoteTreeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.isParent) continue;
    for (const [g, v] of Object.entries(r.baseMd)) out[g] = Math.round(((out[g] ?? 0) + (v || 0)) * 1000) / 1000;
  }
  return out;
}

/**
 * 복수 업무 항목 트리의 공백 검증 — 역산·전용 세트 저장 전에 쓴다.
 * 완전히 빈 행(항목명·MD 모두 없음)은 버리고, 남은 행에서 항목명 없는 행·MD 가 하나도 없는 세부항목·
 * 세부항목이 없는 대항목을 찾는다. MD 가 빈 세부항목은 역산 가중치가 0 이라 MD 가 배분되지 않는다.
 */
function checkTreeRows(all: QuoteTreeRow[]): { rows: QuoteTreeRow[]; error: string | null } {
  const hasMd = (r: QuoteTreeRow) => !r.isParent && Object.values(r.baseMd).some((v) => v > 0);
  const rows = all.filter((r) => r.label.trim() || hasMd(r));
  if (!rows.some(hasMd)) return { rows, error: "업무 항목이 없습니다. [항목 입력(수동)] 또는 [항목 입력(자동)]으로 항목과 등급별 MD를 먼저 입력하세요." };
  const problems: string[] = [];
  rows.forEach((r, i) => {
    if (!r.label.trim()) problems.push(`${i + 1}번째 행 — 항목명이 비어 있습니다`);
    else if (r.isParent) {
      if (!(rows[i + 1] && !rows[i + 1].isParent)) problems.push(`[${r.label}] 대항목 아래에 세부항목이 없습니다`);
    } else if (!hasMd(r)) problems.push(`[${r.label}] 등급별 MD가 비어 있습니다`);
  });
  if (!problems.length) return { rows, error: null };
  return {
    rows,
    error:
      "업무 항목 입력이 끝나지 않았습니다. 세부항목마다 한 등급 이상 MD를 입력해야 합니다(필요 없는 행은 삭제).\n\n" +
      problems.slice(0, 6).map((p) => `· ${p}`).join("\n") +
      (problems.length > 6 ? `\n· 외 ${problems.length - 6}건` : ""),
  };
}

/** 공제료를 주어진 견적가 기준으로 다시 계산해 넣은 직접경비(적용하지 않으면 그대로) */
function withDeduction(d: DirectCosts | undefined, price: number): DirectCosts | undefined {
  if (!d?.deductionOn) return d;
  return { ...d, deductionBase: price, deductionAmount: engineeringDeduction(price, d).total };
}

/** 소수 입력칸 — 입력 중에는 원문을 유지해 '0.' 처럼 소수점을 찍는 도중의 값이 지워지지 않게 한다 */
function DecimalInput({ value, disabled, label, onChange }: { value: number; disabled?: boolean; label: string; onChange: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="cd-input text-right text-[12px]"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={draft ?? String(value)}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, "");
        setDraft(v);
        onChange(Number(v) || 0);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

/** 이 사업장 라인의 등급 축 — 산정 당시 세트 스냅샷(가변, 143). 없으면 종전 4종 */
function siteGrades(site: QuoteSite): string[] {
  return site.rates.grades?.length ? site.rates.grades : DEFAULT_MD_GRADES;
}

export function QuoteBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const editDocId = sp.get("docId");
  const reviseDocId = sp.get("revise"); // 재견적 진입(269) — 이 용역 건의 최신 버전을 복사해 새 문서로 작성

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
  const [loading, setLoading] = useState(!!editDocId || !!reviseDocId);
  const [docNo, setDocNo] = useState<string | null>(null);
  const [nextNo, setNextNo] = useState<string | null>(null);
  // 견적번호 직접 지정(관리자, 2026-09-30) — 공문의 '번호 직접 지정' 패턴 이식. 임시저장 시 번호를 선점하고
  // 상신은 선점 번호를 그대로 쓴다. 종류 라벨은 용역 분류를 따르므로 일련번호만 입력한다.
  const [canAssign, setCanAssign] = useState(false);
  const [manualOn, setManualOn] = useState(false);
  const [manualSeq, setManualSeq] = useState("");
  const [manualCheck, setManualCheck] = useState<{ available: boolean; usedBy: string | null } | null>(null);
  // 재견적(버전 관리, 269) — rootDocId=원본, fromDocId=복사해 온 직전 버전, items=상신된 전 버전 이력.
  // 원본 견적(새로 작성)은 null. 기안하면 서버가 상신된 버전 max+1 로 quote_version 을 확정한다.
  const [revision, setRevision] = useState<{ rootDocId: string; fromDocId: string; items: QuoteRevisionItem[] } | null>(null);
  const [revisionReason, setRevisionReason] = useState<QuoteRevisionReason | "">("");
  const [prevTotalAmount, setPrevTotalAmount] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 재편집 문서의 상태·반려 사유·삭제 권한(서버 판정) — 반려 배너와 기안 삭제 버튼 노출용.
  const [editMeta, setEditMeta] = useState<EditDocMeta | null>(null);
  // 공급자 블록 담당자 연락처 — E-mail 은 내 메일함 주소, Mobile 은 기안자 직원 정보(employee_profiles) 자동.
  // Mobile 입력란은 2026-09-30 삭제(사용자 요청) — 재편집 문서에 저장된 값이 있으면 그 값을 우선한다.
  const [contactEmail, setContactEmail] = useState("");
  const [contactMobile, setContactMobile] = useState("");
  // 사업장 전용 기준 세트(270) 사용 여부 — 전용 세트가 있을 때만 의미가 있다(기본: 전용 우선)
  const [useFacilitySet, setUseFacilitySet] = useState(true);
  // 복수 업무 — 사업장별 항목 트리 편집기 펼침·자동 분석 진행·분석 메모
  const [treeOpen, setTreeOpen] = useState<Record<number, boolean>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [savingSet, setSavingSet] = useState(false);
  const [analysisNote, setAnalysisNote] = useState<Record<number, string>>({});
  // 복수 업무 — 구성 업무를 고를 용역 대분류(기본: 기본 정보의 용역 분류). 다른 대분류의 업무(예: 기타 > 총량제신고)도 섞을 수 있다
  const [workType, setWorkType] = useState<string | null>(null);
  const breakdownFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/mail/mailbox", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.address) setContactEmail((cur) => cur || String(d.address));
      })
      .catch(() => {});
    fetch("/api/quotes/drafter-contact", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.mobile) setContactMobile((cur) => cur || String(d.mobile));
      })
      .catch(() => {});
  }, []);

  const subtypeOptions = useMemo(
    () => SERVICE_OPTIONS.find((o) => o.type === serviceType)?.subtypes ?? [],
    [serviceType]
  );
  const isMulti = serviceSubtype === QUOTE_MULTI_SUBTYPE;
  // 수신처 사업장 — 전용 기준 세트 조회 키
  const facilityIdsKey = useMemo(
    () => [...new Set(recipients.map((r) => r.facilityId).filter((v): v is string => !!v))].join(","),
    [recipients]
  );
  // 적용 세트 — 전용 세트가 있고 사용 중이면 전용, 아니면 표준
  const activeSet: RateSet | null = (useFacilitySet && rateData?.facilitySet) || rateData?.set || null;

  // 채번 예정 번호 — 용역 대분류에 따라 5종 시퀀스 분기(확정은 상신 시)
  useEffect(() => {
    fetch(`/api/quotes/next-no?serviceType=${encodeURIComponent(serviceType)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.nextNo) setNextNo(d.nextNo);
        setCanAssign(d?.canAssign === true);
      })
      .catch(() => {});
  }, [serviceType]);

  // 기준 세트 로드 — 세분류 변경 시. 세트 없으면 T3(자유 입력)로 동작(§5-2).
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ serviceType, serviceSubtype });
    if (facilityIdsKey) qs.set("facilityIds", facilityIdsKey);
    fetch(`/api/quotes/rate-set?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RateSetData | null) => {
        if (cancelled || !d) return;
        setRateData(d);
        const set = (useFacilitySet && d.facilitySet) || d.set;
        const multi = serviceSubtype === QUOTE_MULTI_SUBTYPE;
        // 복수 업무 — 수신처 사업장에 전용 '복수 업무' 세트가 있으면 항목이 빈 사업장에 그 항목 트리를 채운다
        const fset = multi && useFacilitySet ? d.facilitySet : null;
        const fillTree = (s: QuoteSite): QuoteSite =>
          fset?.items.length && !(s.customItems ?? []).length
            ? { ...s, customItems: workItemsToTreeRows(fset.items), rates: { ...s.rates, grades: fset.grades?.length ? fset.grades : s.rates.grades } }
            : s;
        // 신규 작성 중 미산정 사이트에 세트 기본 요율·단가 반영
        setSites((prev) =>
          prev.map((s) =>
            s.amounts.final > 0
              ? s
              : s.rates.setId === set?.setId && Object.keys(s.rates.laborRates).length > 0
              ? // 수신처만 바뀐 재조회 등 적용 세트가 그대로면 조정해 둔 요율·등급은 두고 단가만 갱신한다
                { ...s, rates: { ...s.rates, laborRates: d.laborRates, laborYear: d.laborYear }, remarks: s.remarks || (set?.remarksTemplate ?? "") }
              : {
                  ...s,
                  rates: {
                    setId: set?.setId,
                    setVersion: set?.version,
                    overheadRate: set?.overheadRate ?? STANDARD_OVERHEAD_RATE,
                    techFeeRate: set?.techFeeRate ?? STANDARD_TECH_FEE_RATE,
                    directExpenseRate: 0, // 직접경비는 출장비·인쇄비 산식으로만 계산(2026-09-30) — 세트 요율 미적용
                    // 복수 업무는 세트가 없다 — 사업장별 항목 트리에서 정한 등급 축을 유지한다
                    grades: multi && s.rates.grades?.length ? s.rates.grades : set?.grades?.length ? set.grades : [...DEFAULT_MD_GRADES],
                    laborRates: d.laborRates,
                    laborYear: d.laborYear,
                  },
                  remarks: s.remarks || (set?.remarksTemplate ?? ""),
                }
          ).map(fillTree)
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [serviceType, serviceSubtype, facilityIdsKey, useFacilitySet]);

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
        setEditMeta(toEditDocMeta(d));
        setDocNo(d.docNo ?? null);
        // 상신 전 임시저장인데 번호가 있으면 = 직접 지정해 둔 문서(자동 채번은 상신 시 부여)
        if (d.docNo && d.status === "draft") {
          const parsed = parseQuoteNo(String(d.docNo));
          if (parsed) {
            setManualOn(true);
            setManualSeq(String(parsed.seq).padStart(4, "0"));
          }
        }
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
        // 재편집 중인 문서가 재견적이면 이력·사유·직전 금액을 복원한다
        if (v.quote_root_doc_id) {
          setRevisionReason(v.revision_reason ?? "");
          setPrevTotalAmount(v.prev_total_amount ?? null);
          const rootId = v.quote_root_doc_id;
          const fromId = v.revision_of_doc_id ?? rootId;
          fetch(`/api/quotes/revisions?docId=${encodeURIComponent(rootId)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .then((rv) => {
              if (cancelled) return;
              const items: QuoteRevisionItem[] = Array.isArray(rv?.items) ? rv.items.filter((it: QuoteRevisionItem) => it.docId !== editDocId) : [];
              setRevision({ rootDocId: rootId, fromDocId: fromId, items });
            })
            .catch(() => {});
        }
        setLine(
          (d.steps ?? []).map((s: { stepType: string; assigneeUserId: string; assigneeName: string | null; assigneePosition: string | null }) => ({
            stepType: s.stepType === "agree" ? "agree" : "approve",
            assigneeUserId: s.assigneeUserId,
            assigneeName: s.assigneeName ?? "",
            assigneePosition: s.assigneePosition,
          }))
        );
        setWatchers(
          (d.watchers ?? []).map((w: { userId: string; name: string | null; position?: string | null; kind: string }) => ({
            userId: w.userId,
            name: w.name ?? "",
            position: w.position ?? null,
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

  // 재견적 진입 — 이력에서 최신 버전을 골라 그 문서의 내용·결재선을 새 문서(docId 없음)로 복사한다.
  // 견적일은 오늘, 견적번호는 새로 채번. 직전 버전 금액은 '금액변동' 태그의 기준이 된다.
  useEffect(() => {
    if (!reviseDocId || editDocId) return;
    let cancelled = false;
    (async () => {
      try {
        const rv = await fetch(`/api/quotes/revisions?docId=${encodeURIComponent(reviseDocId)}`, { cache: "no-store" });
        const rvData = await rv.json();
        if (!rv.ok) throw new Error(rvData?.error ?? "견적 이력을 불러오지 못했습니다.");
        const items: QuoteRevisionItem[] = Array.isArray(rvData.items) ? rvData.items : [];
        const latest = items.length ? items[items.length - 1].docId : reviseDocId;
        const res = await fetch(`/api/approval/docs/${encodeURIComponent(latest)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "견적서를 불러오지 못했습니다.");
        if (cancelled) return;
        const d = data.doc;
        const v = (d.fieldValues ?? {}) as Partial<QuoteFieldValues>;
        setSubject(d.title ?? "");
        if (v.service_type) setServiceType(v.service_type);
        if (v.service_subtype) setServiceSubtype(v.service_subtype);
        if (v.send_mode) setSendMode(v.send_mode);
        setRecipients(Array.isArray(v.recipients) ? (v.recipients as LetterRecipient[]) : []);
        setCcRefs(Array.isArray(v.cc_refs) ? (v.cc_refs as LetterRecipient[]) : []);
        const copiedSites = Array.isArray(v.sites) ? v.sites : [];
        if (copiedSites.length) {
          setSites(copiedSites);
          setPriceInputs(Object.fromEntries(copiedSites.map((s) => [s.siteSeq, s.amounts.final ? String(s.amounts.final) : ""])));
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
          (d.watchers ?? []).map((w: { userId: string; name: string | null; position?: string | null; kind: string }) => ({
            userId: w.userId,
            name: w.name ?? "",
            position: w.position ?? null,
            kind: w.kind === "view" ? "view" : "ref",
          }))
        );
        setPrevTotalAmount(copiedSites.reduce((acc, s) => acc + (Number(s?.amounts?.final) || 0), 0));
        setRevision({ rootDocId: String(rvData.rootDocId ?? reviseDocId), fromDocId: latest, items });
      } catch (err) {
        alert((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reviseDocId, editDocId]);

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
      // 복수 업무는 사업장별 항목 트리, 그 외는 적용 세트(전용 우선)의 항목이 역산 가중치의 원천
      const tree = isMulti ? checkTreeRows(site.customItems ?? []) : null;
      if (tree?.error) return alert(tree.error);
      const items: QuoteWorkItem[] = tree ? treeRowsToWorkItems(tree.rows, `w${site.siteSeq}`) : activeSet?.items ?? [];
      if (!items.length) return alert("이 세분류는 산정 기준 세트가 없어 자유 입력(품목 직접 입력)으로 작성합니다.");
      if (!rateData) return alert("노임단가를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      const rates = {
        ...site.rates,
        // 산정에 쓴 기준의 스냅샷 — 복수 업무는 세트 없음(등급 축은 항목 트리 편집기에서 정한 값)
        setId: isMulti ? undefined : activeSet?.setId,
        setVersion: isMulti ? undefined : activeSet?.version,
        grades: isMulti ? siteGrades(site) : activeSet?.grades?.length ? activeSet.grades : siteGrades(site),
        laborRates: rateData.laborRates,
        laborYear: rateData.laborYear,
      };
      // 공제료는 제출 견적가(순계약금액) 기준 — 이번 견적가로 다시 계산해 직접경비에 넣는다
      const directCosts = withDeduction(site.directCosts, price);
      const fixedDirect = fixedDirectExpense(directCosts);
      if (fixedDirect >= price) return alert("직접경비(출장비+인쇄비+공제료)가 제출 견적가 이상입니다. 견적가 또는 산식 입력값을 확인하세요.");
      const res = reverseAllocate({ price, items, rates, fixedDirect });
      updateSite(idx, {
        directCosts,
        mdMatrix: res.mdMatrix,
        rates,
        amounts: res.amounts,
        freeItems: [],
      });
      if (!res.ok) alert("⚠ 역산 결과가 합계-견적가 제약(초과폭 상한)을 벗어났습니다. MD 를 수동 조정하거나 요율을 확인하세요.");
    },
    [sites, priceInputs, rateData, updateSite, isMulti, activeSet]
  );

  /**
   * 견적가 역산(복수 업무) — 항목 트리에 입력된 MD 를 그대로 산정 MD 로 쓰고, 그 합계에서 제출 견적가를 정한다
   * (MD 역산의 반대 방향). 산출내역서 엑셀로 MD 가 이미 정해진 경우에 쓴다.
   */
  const runForward = useCallback(
    (idx: number) => {
      const site = sites[idx];
      const tree = checkTreeRows(site.customItems ?? []);
      if (tree.error) return alert(tree.error);
      if (!rateData) return alert("노임단가를 불러오는 중입니다. 잠시 후 다시 시도하세요.");
      const rates = { ...site.rates, setId: undefined, setVersion: undefined, grades: siteGrades(site), laborRates: rateData.laborRates, laborYear: rateData.laborYear };
      const rows: MdMatrixRow[] = treeRowsToWorkItems(tree.rows, `w${site.siteSeq}`).map((it) => ({ itemId: it.itemId, parentId: it.parentId, label: it.label, md: { ...it.baseMd } }));
      // 대항목 소계(표시용) — 자식 합
      for (const r of rows) {
        const children = rows.filter((c) => c.parentId === r.itemId);
        if (!children.length) continue;
        const md: MdMatrixRow["md"] = {};
        for (const g of new Set(children.flatMap((c) => Object.keys(c.md)))) {
          const v = children.reduce((acc, c) => acc + (c.md[g] ?? 0), 0);
          if (v) md[g] = Math.round(v * 1000) / 1000;
        }
        r.md = md;
      }
      const labor = matrixLaborCost(rows, rates.laborRates);
      // 공제료는 견적가 기준이고 견적가는 공제료를 포함한 합계에서 정해진다 — 몇 번 되풀이하면 값이 멎는다
      let directCosts = withDeduction(site.directCosts, 0);
      let base = computeAmounts(labor, rates, fixedDirectExpense(directCosts));
      let price = priceFromSum(base.sum);
      for (let i = 0; i < 4 && price > 0 && site.directCosts?.deductionOn; i++) {
        directCosts = withDeduction(site.directCosts, price);
        base = computeAmounts(labor, rates, fixedDirectExpense(directCosts));
        const next = priceFromSum(base.sum);
        if (next === price) break;
        price = next;
      }
      if (!price) return alert("입력된 MD의 합계 금액이 너무 작아 제출 견적가를 정할 수 없습니다. MD와 노임단가를 확인하세요.");
      updateSite(idx, { directCosts, mdMatrix: rows, rates, amounts: { ...base, final: price }, freeItems: [] });
      setPriceInputs((prev) => ({ ...prev, [site.siteSeq]: String(price) }));
    },
    [sites, rateData, updateSite]
  );

  /** 복수 업무 — 구성 업무 태그 추가(같은 세분류를 다시 고르면 횟수 +1). 최대 4개 */
  const addWork = useCallback(
    (idx: number, type: string, subtype: string) => {
      const works = sites[idx].works ?? [];
      // 대분류가 없는 태그(종전 저장분)는 기본 정보의 용역 분류로 본다
      const same = (w: QuoteWorkTag) => (w.serviceType ?? serviceType) === type && w.subtype === subtype;
      if (works.some(same)) {
        return updateSite(idx, { works: works.map((w) => (same(w) ? { ...w, count: w.count + 1 } : w)) });
      }
      if (works.length >= QUOTE_MULTI_WORK_MAX) return alert(`구성 업무는 최대 ${QUOTE_MULTI_WORK_MAX}개까지 추가할 수 있습니다.`);
      updateSite(idx, { works: [...works, { serviceType: type, subtype, count: 1 }] });
    },
    [sites, updateSite, serviceType]
  );

  /**
   * 복수 업무 — 구성 업무 태그로 항목 트리 초안을 만든다. 세분류마다 대항목 1개, 그 세분류에 기준 세트
   * (전용 우선)가 있으면 세부항목을 표준 MD × 횟수로 채우고, 없으면 빈 세부항목 1행을 둔다.
   */
  const buildTreeFromWorks = useCallback(
    async (works: QuoteWorkTag[]): Promise<{ rows: QuoteTreeRow[]; grades: string[] }> => {
      const rows: QuoteTreeRow[] = [];
      const grades = new Set<string>();
      for (let n = 0; n < works.length; n++) {
        const w = works[n];
        const qs = new URLSearchParams({ serviceType: w.serviceType ?? serviceType, serviceSubtype: w.subtype });
        if (facilityIdsKey) qs.set("facilityIds", facilityIdsKey);
        const d: RateSetData | null = await fetch(`/api/quotes/rate-set?${qs.toString()}`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        const set = (useFacilitySet && d?.facilitySet) || d?.set || null;
        rows.push({ label: `${n + 1}. ${w.subtype}${w.count > 1 ? ` (${w.count}회)` : ""}`, isParent: true, baseMd: {} });
        const parentIds = new Set((set?.items ?? []).map((i) => i.parentId).filter(Boolean));
        const leaves = (set?.items ?? []).filter((i) => !parentIds.has(i.itemId));
        if (!leaves.length) {
          rows.push({ label: "", isParent: false, baseMd: {} });
          continue;
        }
        for (const g of set?.grades ?? []) grades.add(g);
        for (const it of leaves) {
          const baseMd: Record<string, number> = {};
          for (const [g, v] of Object.entries(it.baseMd)) if (v) baseMd[g] = Math.round(v * w.count * 100) / 100;
          rows.push({ label: it.label, isParent: false, baseMd });
        }
      }
      if (!rows.length) rows.push({ label: "", isParent: false, baseMd: {} });
      return { rows, grades: sortGrades([...grades]) };
    },
    [serviceType, facilityIdsKey, useFacilitySet]
  );

  /** 항목 입력(수동) — 편집기를 펼친다. 항목이 비어 있으면 구성 업무 태그로 초안을 채운다(force=다시 채우기) */
  const openManualTree = useCallback(
    async (idx: number, force = false) => {
      const site = sites[idx];
      setTreeOpen((prev) => ({ ...prev, [site.siteSeq]: true }));
      if ((site.customItems ?? []).length > 0 && !force) return;
      const built = await buildTreeFromWorks(site.works ?? []);
      updateSite(idx, {
        customItems: built.rows,
        rates: { ...site.rates, grades: built.grades.length ? built.grades : siteGrades(site) },
      });
    },
    [sites, buildTreeFromWorks, updateSite]
  );

  /** 항목 입력(자동) — 산출내역서 엑셀을 LLM 으로 분석해 항목 트리·기술등급을 채운다 */
  const runBreakdownAnalyze = useCallback(
    async (idx: number, file: File) => {
      const site = sites[idx];
      if ((site.customItems ?? []).some((r) => r.label.trim()) && !confirm("입력해 둔 업무 항목을 엑셀 분석 결과로 바꿀까요?")) return;
      setAnalyzing(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("works", JSON.stringify(site.works ?? []));
        const res = await fetch("/api/quotes/analyze-breakdown", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { error?: string; rows?: QuoteTreeRow[]; grades?: string[]; note?: string };
        if (!res.ok) throw new Error(data.error ?? "자동 분석에 실패했습니다.");
        updateSite(idx, {
          customItems: data.rows ?? [],
          rates: { ...site.rates, grades: data.grades?.length ? data.grades : siteGrades(site) },
        });
        setTreeOpen((prev) => ({ ...prev, [site.siteSeq]: true }));
        setAnalysisNote((prev) => ({ ...prev, [site.siteSeq]: `${file.name} 분석 결과${data.note ? ` — ${data.note}` : ""}` }));
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setAnalyzing(false);
      }
    },
    [sites, updateSite]
  );

  /** 복수 업무 — 수신처 사업장의 전용 '복수 업무' 세트 항목으로 다시 채운다 */
  const loadFacilityTree = useCallback(
    (idx: number) => {
      const fset = rateData?.facilitySet;
      if (!fset) return;
      const site = sites[idx];
      if ((site.customItems ?? []).some((r) => r.label.trim()) && !confirm(`입력해 둔 업무 항목을 [${fset.facilityName}] 전용 기준 세트로 바꿀까요?`)) return;
      updateSite(idx, {
        customItems: workItemsToTreeRows(fset.items),
        rates: { ...site.rates, grades: fset.grades?.length ? fset.grades : siteGrades(site) },
      });
      setTreeOpen((prev) => ({ ...prev, [site.siteSeq]: true }));
    },
    [rateData, sites, updateSite]
  );

  /**
   * 복수 업무 — 이 사업장 카드의 항목 트리를 수신처 사업장의 전용 기준 세트(개별, 세분류 '복수 업무')로 저장한다.
   * 다음 견적에서 같은 수신처·복수 업무를 고르면 자동으로 채워진다. 기준 관리 권한(approval.manage) 필요.
   */
  const saveAsFacilitySet = useCallback(
    async (idx: number) => {
      const site = sites[idx];
      const target = recipients.find((r) => r.facilityId);
      if (!target?.facilityId) return alert("전용 기준 세트는 수신처 사업장 기준으로 저장합니다. 수신처에 사업장을 먼저 지정하세요.");
      // 기준 세트의 MD 는 역산 분배 가중치로 쓰인다 — MD 가 빈 세부항목은 가중치 0 이 되므로 저장 전에 막는다
      const tree = checkTreeRows(site.customItems ?? []);
      if (tree.error) return alert(tree.error);
      const rows = tree.rows;
      const facilityName = target.name || target.facilityName || "수신처 사업장";
      setSavingSet(true);
      try {
        const fail = async (res: Response, fallback: string) =>
          new Error(res.status === 403 ? "기준 세트를 저장할 권한이 없습니다(견적 기준 관리 권한 필요)." : ((await res.json().catch(() => ({}))) as { error?: string }).error ?? fallback);
        const listRes = await fetch("/api/quotes/admin/rate-sets?scope=facility", { cache: "no-store" });
        if (!listRes.ok) throw await fail(listRes, "전용 기준 세트 목록을 불러오지 못했습니다.");
        const list = ((await listRes.json()).sets ?? []) as { setId: string; serviceType: string; serviceSubtype: string; facilityId: string | null }[];
        let setId = list.find((x) => x.facilityId === target.facilityId && x.serviceType === serviceType && x.serviceSubtype === QUOTE_MULTI_SUBTYPE)?.setId;
        // 기존 세트를 덮어쓸 때는 시장 보정계수 등 이 화면에 없는 값을 보존한다
        let keep = { marketAdjust: 1, directExpenseRate: 0 };
        if (setId) {
          if (!confirm(`[${facilityName}] 전용 '${QUOTE_MULTI_SUBTYPE}' 기준 세트가 이미 있습니다. 지금 항목으로 덮어쓸까요?`)) return;
          const cur = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(setId)}`, { cache: "no-store" });
          if (cur.ok) {
            const d = (await cur.json()).set as { marketAdjust: number; directExpenseRate: number };
            keep = { marketAdjust: d.marketAdjust, directExpenseRate: d.directExpenseRate };
          }
        } else {
          if (!confirm(`지금 항목을 [${facilityName}] 전용 '${QUOTE_MULTI_SUBTYPE}' 기준 세트로 저장할까요?\n다음 견적부터 이 수신처의 복수 업무 견적에 자동으로 채워집니다.`)) return;
          const created = await fetch("/api/quotes/admin/rate-sets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serviceType, serviceSubtype: QUOTE_MULTI_SUBTYPE, facilityId: target.facilityId }),
          });
          if (!created.ok) throw await fail(created, "전용 기준 세트 생성에 실패했습니다.");
          setId = (await created.json()).setId as string;
        }
        let lastParent = -1;
        const items = rows.map((r, i) => {
          if (r.isParent) lastParent = i;
          return { label: r.label, baseMd: r.isParent ? {} : r.baseMd, parentIdx: r.isParent ? null : lastParent >= 0 ? lastParent : null };
        });
        const saved = await fetch(`/api/quotes/admin/rate-sets/${encodeURIComponent(setId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overheadRate: site.rates.overheadRate,
            techFeeRate: site.rates.techFeeRate,
            directExpenseRate: keep.directExpenseRate,
            marketAdjust: keep.marketAdjust,
            grades: siteGrades(site),
            remarksTemplate: site.remarks,
            items,
          }),
        });
        if (!saved.ok) throw await fail(saved, "전용 기준 세트 저장에 실패했습니다.");
        alert(`[${facilityName}] 전용 '${QUOTE_MULTI_SUBTYPE}' 기준 세트로 저장했습니다.\n견적 기준 관리 › 기준 세트(개별)에서 수정할 수 있습니다.`);
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setSavingSet(false);
      }
    },
    [sites, recipients, serviceType]
  );

  /** MD 셀 수동 편집 → 금액 재계산(제약 실시간 검증은 요약 카드에서) */
  const editMdCell = useCallback(
    (idx: number, rowIdx: number, grade: string, value: number) => {
      const site = sites[idx];
      const rows: MdMatrixRow[] = site.mdMatrix.map((r, i) => (i === rowIdx ? { ...r, md: { ...r.md, [grade]: value }, overridden: true } : r));
      // 대항목 소계 재계산 — 등급 축은 세트마다 다르므로 자식 벡터의 키 합집합을 돈다
      for (const r of rows) {
        const children = rows.filter((c) => c.parentId === r.itemId);
        if (children.length) {
          const md: MdMatrixRow["md"] = {};
          for (const g of new Set(children.flatMap((c) => Object.keys(c.md)))) {
            const v = children.reduce((acc, c) => acc + (c.md[g] ?? 0), 0);
            if (v) md[g] = Math.round(v * 1000) / 1000;
          }
          r.md = md;
        }
      }
      const laborCost = matrixLaborCost(rows, site.rates.laborRates);
      const base = computeAmounts(laborCost, site.rates, fixedDirectExpense(site.directCosts));
      updateSite(idx, { mdMatrix: rows, amounts: { ...base, final: site.amounts.final, standard: site.amounts.standard } });
    },
    [sites, updateSite]
  );

  /** 요율 변경 → 금액 재계산 (직접경비 요율은 입력 폐지 — 비중 표시 전용) */
  const editRate = useCallback(
    (idx: number, key: "overheadRate" | "techFeeRate", value: number) => {
      const site = sites[idx];
      const rates = { ...site.rates, [key]: value };
      const laborCost = matrixLaborCost(site.mdMatrix, rates.laborRates);
      const base = computeAmounts(laborCost, rates, fixedDirectExpense(site.directCosts));
      updateSite(idx, { rates, amounts: { ...base, final: site.amounts.final, standard: site.amounts.standard } });
    },
    [sites, updateSite]
  );

  /** 직접경비 산식(출장비·인쇄비) 변경 → 금액 재계산. 역산 전이면 산식만 저장하고 역산 때 반영 */
  const editDirectCost = useCallback(
    (idx: number, patch: Partial<DirectCosts>) => {
      const site = sites[idx];
      // 공제료는 견적가 기준 — 입력 중인 견적가(없으면 확정 견적가)로 다시 계산한다
      const price = Number(String(priceInputs[site.siteSeq] ?? "").replace(/[^\d]/g, "")) || site.amounts.final;
      const directCosts = withDeduction(
        {
          travelDayRate: 0,
          travelPersonDays: 0,
          travelTrips: travelTripsOf(site.directCosts),
          printUnitPrice: 0,
          printCopies: 0,
          ...site.directCosts,
          ...patch,
        },
        price
      ) as DirectCosts;
      if (!site.mdMatrix.length) return updateSite(idx, { directCosts });
      const laborCost = matrixLaborCost(site.mdMatrix, site.rates.laborRates);
      const base = computeAmounts(laborCost, site.rates, fixedDirectExpense(directCosts));
      updateSite(idx, { directCosts, amounts: { ...base, final: site.amounts.final, standard: site.amounts.standard } });
    },
    [sites, priceInputs, updateSite]
  );

  // 직접 지정 번호 — 연도는 채번 예정 번호(없으면 확정 번호/올해), 종류는 용역 분류 기준.
  const quoteYear = (nextNo ?? docNo ?? "").slice(0, 4) || String(new Date().getFullYear());
  const manualNo = manualSeq.trim() ? formatQuoteNo(quoteYear, quoteNoLabel(serviceType), Number(manualSeq)) : "";
  // 상신 이력이 있는 문서(반려 후 재편집)는 번호가 이미 확정돼 바꿀 수 없다.
  const noLocked = !!docNo && editMeta?.status !== "draft";

  // 중복 확인 — 입력이 멎으면 서버에 조회(발송 대장 + 결재 문서 doc_no 합집합).
  useEffect(() => {
    if (!manualOn || !manualNo) {
      setManualCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ serviceType, check: manualNo });
      if (docId) qs.set("docId", docId);
      fetch(`/api/quotes/next-no?${qs.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setManualCheck(d?.check ?? null))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [manualOn, manualNo, serviceType, docId]);

  // 재견적 표시값 — 다음 버전(이력 max+1, 확정은 서버)·현재 합계(금액변동 태그의 우변)
  const nextVersion = revision ? Math.max(1, ...revision.items.map((it) => it.version)) + 1 : 1;
  const currentTotal = sites.reduce((a, s) => a + (s.amounts.final || 0), 0);

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
      // 재견적(269) — 원본 견적에는 넣지 않는다
      ...(revision
        ? {
            quote_root_doc_id: revision.rootDocId,
            revision_of_doc_id: revision.fromDocId,
            quote_version: nextVersion,
            revision_reason: revisionReason || undefined,
            prev_total_amount: prevTotalAmount ?? undefined,
          }
        : {}),
      // 양식별 조회 표시용
      ...( {
        recipients_display: recipients.map((r) => r.name).join(", "),
        // 복수 업무는 구성 업무(첫 사업장 기준)를 함께 적는다 — 예: 복수 업무(사후관리·변경허가 6회·재검토)
        quote_summary_display: `${
          isMulti && sites[0]?.works?.length
            ? `${serviceSubtype}(${sites[0].works.map((w) => (w.count > 1 ? `${w.subtype} ${w.count}회` : w.subtype)).join("·")})`
            : serviceSubtype
        } · ${sites.length}개 사업장 · ${won(totalFinal)}원`,
      } as Partial<QuoteFieldValues>),
    };
  }, [subject, serviceType, serviceSubtype, sendMode, recipients, ccRefs, issueDate, contactEmail, contactMobile, sites, situation, revision, nextVersion, revisionReason, prevTotalAmount, isMulti]);

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
          // 견적번호 직접 지정(관리자) — 켜져 있으면 선점, 껐으면 빈 문자열로 자동 채번 복귀. 권한 없으면 미전송.
          manualDocNo: canAssign && !noLocked ? (manualOn ? manualNo : "") : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDocId(data.docId);
      return { docId: data.docId, docNo: data.docNo };
    },
    [docId, subject, buildFieldValues, line, watchers, canAssign, noLocked, manualOn, manualNo]
  );

  // 자동 저장(5분, 변화 있을 때만) — 저장 대상 = 필드값 + 결재선 + 참조자 + 직접 지정 번호
  const getSnapshot = useCallback(
    () => JSON.stringify({ v: buildFieldValues(), line, watchers, manualNo: manualOn ? manualNo : "" }),
    [buildFieldValues, line, watchers, manualOn, manualNo]
  );
  const hasContent = useCallback(
    () => subject.trim().length > 0 || recipients.length > 0 || sites.some((s) => s.subjectLine.trim().length > 0 || s.amounts.final > 0),
    [subject, recipients, sites]
  );
  const autosaveSave = useCallback(() => persist("save"), [persist]);
  const { lastSavedAt, lastError, markSaved } = useAutosave({ ready: !loading && busy == null, hasContent, getSnapshot, save: autosaveSave });

  const validate = useCallback((): string | null => {
    if (!subject.trim()) return "건명을 입력하세요.";
    if (!isValidDateString(issueDate)) return "견적일을 YYYYMMDD 형식의 올바른 날짜로 입력하세요.";
    if (manualOn && !noLocked) {
      if (!parseQuoteNo(manualNo)) return "견적번호 일련번호를 1~4자리 숫자로 입력하세요(예: 0012).";
      if (manualCheck && !manualCheck.available) return `이미 사용 중인 견적번호입니다 — ${manualCheck.usedBy}`;
    }
    if (revision && !revisionReason) return "재견적 사유를 선택하세요(화면 하단 '재견적 사유' 카드).";
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
  }, [subject, issueDate, manualOn, noLocked, manualNo, manualCheck, revision, revisionReason, recipients, ccRefs, sendMode, sites, line]);

  const openPreview = useCallback(async () => {
    setBusy("preview");
    setPreviewOpen(true);
    try {
      const res = await fetch("/api/quotes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 직접 지정 중이면 그 번호로 미리보기(2026-10-01: 수동 번호가 docNo/nextNo 에만 의존해 미반영되던 문제)
        body: JSON.stringify({ values: buildFieldValues(), quoteNo: (manualOn && !noLocked && manualNo) || docNo || nextNo || "미채번", issueDate }),
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
  }, [buildFieldValues, manualOn, noLocked, manualNo, docNo, nextNo, issueDate]);

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (action === "submit") {
        const msg = validate();
        if (msg) return alert(msg);
      }
      setBusy(action);
      try {
        const saved = await persist("save");
        markSaved();
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
    [validate, persist, markSaved, sendMode, router]
  );

  const site = sites[activeSite];
  // 복수 업무는 항목 트리를 직접 구성해 역산하므로 항상 산정형
  const tier: "calc" | "free" = isMulti || (activeSet?.items?.length ?? 0) > 0 ? "calc" : "free";

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <div className="flex flex-col gap-5 min-h-0">
        <CdPageHeader
          title="견적서 작성"
          actions={
            <div className="flex items-center gap-2">
              {/* 중간 저장(2026-10-01) — 결재선 카드 하단의 임시저장과 같은 동작. 화면 상단에서도 바로 저장 */}
              <AutosaveStatus lastSavedAt={lastSavedAt} lastError={lastError} />
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null || loading}
                onClick={() => send("save")}
                title="작성 중인 견적서를 임시저장합니다(상신 전, 나중에 이어서 작성). 5분마다 자동 저장됩니다"
              >
                <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "저장"}
              </button>
              <DeleteDraftButton docId={docId} meta={editMeta} label="견적 삭제" />
            </div>
          }
        />
        {loading ? (
          <div className="cd-card rounded-3xl p-10 text-center text-sm cd-text-faint">불러오는 중...</div>
        ) : (
          <>
          <div className="max-w-[1032px]">
            <RejectedBanner meta={editMeta} />
          </div>
          <div className="flex flex-col xl:flex-row gap-5 items-start">
            {/* 좌: 기본정보 + 사업장 탭 — 폭은 공문 작성(1032px, 전자결재 작성 양식 273mm)과 동일 */}
            <div className="flex-1 min-w-0 max-w-[1032px] flex flex-col gap-4 w-full">
              {/* 견적 이력(재견적, 269) — 같은 용역 건의 상신된 버전 + 지금 작성 중인 버전. 금액변동·사유 태그 */}
              {revision && (
                <div className="cd-card rounded-3xl p-5 flex flex-col gap-2.5">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <History className="w-4 h-4 cd-text-primary" /> 견적 이력
                    <span className="text-[10.5px] font-normal cd-text-faint">같은 용역 건의 견적 버전 — 기안하면 v{nextVersion}으로 등록됩니다</span>
                  </h3>
                  <ul className="rounded-xl border cd-border-c overflow-hidden">
                    {revision.items.map((it) => (
                      <li key={it.docId} className="flex items-center gap-3 px-3 py-2 text-[12px] border-b cd-border-c flex-wrap">
                        <span className="font-mono font-semibold cd-text w-7">v{it.version}</span>
                        <span className="font-mono text-[11px] cd-text-faint">{it.quoteNo ?? "-"}</span>
                        <span className="cd-text-faint">발송일 {shortDate(it.sentAt ?? it.issueDate ?? it.submittedAt)}</span>
                        <span className="cd-text">{it.drafterName ?? "-"}</span>
                        <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text-faint">{DOC_STATUS_LABEL[it.status] ?? "결재 중"}</span>
                        <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text tabular-nums">
                            {it.prevTotalAmount != null ? `금액변동 : ${won(it.prevTotalAmount)}원 → ${won(it.totalAmount)}원` : `최초 견적 ${won(it.totalAmount)}원`}
                          </span>
                          {it.revisionReason && (
                            <span className="text-[10.5px] rounded-full px-2 py-0.5 cd-tint-primary">{QUOTE_REVISION_REASON_LABEL[it.revisionReason] ?? it.revisionReason}</span>
                          )}
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center gap-3 px-3 py-2 text-[12px] flex-wrap cd-tint-primary/40">
                      <span className="font-mono font-semibold cd-text-primary w-7">v{nextVersion}</span>
                      <span className="cd-text-faint">작성 중 · 견적일 {issueDate}</span>
                      <span className="ml-auto flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text tabular-nums">
                          금액변동 : {won(prevTotalAmount ?? 0)}원 → {won(currentTotal)}원
                        </span>
                        {revisionReason ? (
                          <span className="text-[10.5px] rounded-full px-2 py-0.5 cd-tint-primary">{QUOTE_REVISION_REASON_LABEL[revisionReason]}</span>
                        ) : (
                          <span className="text-[10.5px] rounded-full px-2 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">사유 미선택</span>
                        )}
                      </span>
                    </li>
                  </ul>
                </div>
              )}
              {/* 기본정보 */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-3.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 cd-text-primary" /> 기본 정보
                  </h3>
                  {/* cd-input 은 width:100% 라 고정폭은 감싸는 span 에 준다(상황 변수 행과 같은 패턴) — 한 줄 유지 */}
                  <span className="ml-auto shrink-0 text-[11px] cd-text-faint flex items-center gap-1.5 whitespace-nowrap">
                    {manualOn && !noLocked ? (
                      <>
                        견적번호
                        <span className="font-mono">{quoteYear}-{quoteNoLabel(serviceType)}-</span>
                        <span className="w-[68px] shrink-0">
                          <input
                            className="cd-input font-mono text-center text-[12px] px-1"
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="0012"
                            value={manualSeq}
                            onChange={(e) => setManualSeq(e.target.value.replace(/\D/g, "").slice(0, 4))}
                            aria-label="견적번호 일련번호"
                          />
                        </span>
                        {!manualNo ? (
                          <span>자동 채번 예정 {nextNo ?? "-"}</span>
                        ) : manualCheck == null ? (
                          <span>중복 확인 중...</span>
                        ) : manualCheck.available ? (
                          <span style={{ color: "var(--cd-success, #13DEB9)" }}>사용 가능</span>
                        ) : (
                          <span style={{ color: "var(--cd-danger, #FA896B)" }}>이미 사용 중 — {manualCheck.usedBy}</span>
                        )}
                      </>
                    ) : (
                      <>견적번호 {docNo ? <b className="cd-text">{docNo}</b> : <>예정 <b className="cd-text">{nextNo ?? "..."}</b></>}</>
                    )}
                    {canAssign && !noLocked && (
                      <button
                        type="button"
                        className="cd-btn rounded-lg border cd-border-c px-2 py-0.5 text-[10.5px] cd-text-faint"
                        title="관리자 — 자동 채번 대신 번호를 직접 지정합니다(공문과 동일)"
                        onClick={() => {
                          setManualOn((v) => !v);
                          setManualSeq("");
                        }}
                      >
                        {manualOn ? "자동 채번" : "번호 직접 지정"}
                      </button>
                    )}
                  </span>
                  <a
                    href="/approval/quote/settings"
                    className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                    title="세분류별 MD 기준·요율·노임단가 관리(관리 권한)"
                  >
                    <Settings2 className="w-3.5 h-3.5" /> 기준 관리
                  </a>
                </div>
                {/* 건명·용역 분류·세분류·견적일 한 줄 — 분류 두 칸은 종전(1/4 열) 대비 75%, 견적일은 60% 고정폭 */}
                <div className="flex flex-col md:flex-row gap-2.5">
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">건명(전체)</span>
                    <input className="cd-input text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="예: OOO㈜ OO공장 통합환경허가 취득 용역" />
                  </div>
                  <div className="md:w-[180px] md:shrink-0 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">용역 분류</span>
                    <select
                      className="cd-select"
                      value={serviceType}
                      onChange={(e) => {
                        const t = e.target.value;
                        const subs = SERVICE_OPTIONS.find((o) => o.type === t)?.subtypes ?? [];
                        setServiceType(t);
                        if (!subs.includes(serviceSubtype) && serviceSubtype !== QUOTE_MULTI_SUBTYPE) setServiceSubtype(subs[0] ?? "");
                      }}
                    >
                      {SERVICE_OPTIONS.map((o) => (
                        <option key={o.type} value={o.type}>{o.type}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:w-[180px] md:shrink-0 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">용역 세분류</span>
                    <select className="cd-select" value={serviceSubtype} onChange={(e) => setServiceSubtype(e.target.value)}>
                      {subtypeOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      {/* 여러 세분류 업무가 섞인 용역 — 사업장별 견적 카드에서 구성 업무·항목을 직접 구성 */}
                      <option value={QUOTE_MULTI_SUBTYPE}>{QUOTE_MULTI_SUBTYPE}</option>
                    </select>
                  </div>
                  <div className="md:w-[144px] md:shrink-0 flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">견적일</span>
                    <CdDateInput className="text-sm" value={issueDate} onChange={setIssueDate} aria-label="견적일" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
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
                      data-active={i === activeSite}
                      aria-pressed={i === activeSite}
                      className={`cd-choice cd-btn rounded-lg border px-2.5 py-1 text-[11.5px] ${i === activeSite ? "cd-tint-primary font-semibold" : "cd-border-c cd-text-faint"}`}
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
                          setId: activeSet?.setId,
                          setVersion: activeSet?.version,
                          overheadRate: activeSet?.overheadRate ?? STANDARD_OVERHEAD_RATE,
                          techFeeRate: activeSet?.techFeeRate ?? STANDARD_TECH_FEE_RATE,
                          directExpenseRate: 0,
                          laborRates: rateData.laborRates,
                          laborYear: rateData.laborYear,
                        };
                        base.remarks = activeSet?.remarksTemplate ?? "";
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
                        <input
                          className="cd-input text-sm"
                          value={site.subjectLine}
                          onChange={(e) => updateSite(activeSite, { subjectLine: e.target.value })}
                          placeholder={subject || "예: OO공장 통합환경허가 취득 용역"}
                          title={subject && !site.subjectLine ? "→ 키를 누르면 기본 정보 건명이 입력됩니다" : undefined}
                          onKeyDown={(e) => {
                            // 자동완성처럼 보이던 placeholder(기본 정보 건명)를 → 키로 실제 값으로 채운다(2026-10-01 사용자 요청)
                            if (e.key === "ArrowRight" && !site.subjectLine && subject) {
                              e.preventDefault();
                              updateSite(activeSite, { subjectLine: subject });
                            }
                          }}
                        />
                      </div>
                    </div>

                    {/* 복수 업무 — 구성 업무(세분류×횟수) 태그 + 업무 항목 입력(수동/자동). 세분류가 '복수 업무'일 때만 보인다 */}
                    {isMulti && (
                      <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* cd-select 는 width:100% 라 고정폭은 감싸는 요소에 준다 */}
                          {/* 용역 대분류 — 오른쪽 구성 업무 목록은 여기서 고른 대분류의 세분류(2026-10-01: 다른 대분류 업무 혼합) */}
                          <div className="w-[140px] shrink-0">
                            <select
                              className="cd-select"
                              value={workType ?? serviceType}
                              aria-label="구성 업무의 용역 대분류"
                              onChange={(e) => setWorkType(e.target.value)}
                            >
                              {SERVICE_OPTIONS.map((o) => (
                                <option key={o.type} value={o.type}>{o.type}</option>
                              ))}
                            </select>
                          </div>
                          <div className="w-[180px] shrink-0">
                            <select
                              className="cd-select"
                              value=""
                              aria-label="구성 업무(용역 세분류) 추가"
                              onChange={(e) => e.target.value && addWork(activeSite, workType ?? serviceType, e.target.value)}
                            >
                              <option value="">구성 업무 선택</option>
                              {(SERVICE_OPTIONS.find((o) => o.type === (workType ?? serviceType))?.subtypes ?? []).map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                          </div>
                          {(site.works ?? []).map((w, wi) => (
                            <span
                              key={`${w.serviceType ?? serviceType}/${w.subtype}`}
                              className="cd-action inline-flex items-center gap-1.5 rounded-lg border cd-border-c pl-2.5 pr-1.5 py-1 text-[11.5px] cd-text"
                              title={`${w.serviceType ?? serviceType} > ${w.subtype}`}
                            >
                              {/* 기본 정보의 용역 분류와 다른 대분류의 업무는 대분류를 함께 적는다 */}
                              {(w.serviceType ?? serviceType) !== serviceType && <span className="cd-text-faint">{w.serviceType}</span>}
                              <span className="font-semibold">{w.subtype}</span>
                              <span className="w-10 shrink-0">
                                <input
                                  className="cd-input text-center text-[11.5px] px-1 py-0.5"
                                  inputMode="numeric"
                                  aria-label={`${w.subtype} 횟수`}
                                  value={w.count ? String(w.count) : ""}
                                  onChange={(e) => {
                                    const count = Number(e.target.value.replace(/[^\d]/g, "").slice(0, 3)) || 0;
                                    updateSite(activeSite, { works: (site.works ?? []).map((x, xi) => (xi === wi ? { ...x, count } : x)) });
                                  }}
                                  onBlur={() => {
                                    if (!w.count) updateSite(activeSite, { works: (site.works ?? []).map((x, xi) => (xi === wi ? { ...x, count: 1 } : x)) });
                                  }}
                                />
                              </span>
                              <span className="cd-text-faint">회</span>
                              <button
                                type="button"
                                className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                                aria-label={`${w.subtype} 제거`}
                                onClick={() => updateSite(activeSite, { works: (site.works ?? []).filter((_, xi) => xi !== wi) })}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                          <span className="text-[10.5px] cd-text-faint">
                            {(site.works ?? []).length === 0 ? `이 용역을 구성하는 업무를 선택하세요(최대 ${QUOTE_MULTI_WORK_MAX}개)` : `${(site.works ?? []).length}/${QUOTE_MULTI_WORK_MAX}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                            aria-expanded={!!treeOpen[site.siteSeq]}
                            title="항목명과 등급별 MD를 직접 입력합니다. 항목이 비어 있으면 구성 업무의 기준 세트(표준 MD × 횟수)로 초안을 채웁니다"
                            onClick={() => {
                              if (treeOpen[site.siteSeq]) setTreeOpen((prev) => ({ ...prev, [site.siteSeq]: false }));
                              else void openManualTree(activeSite);
                            }}
                          >
                            <ListPlus className="w-3.5 h-3.5" /> 항목 입력(수동)
                          </button>
                          <button
                            type="button"
                            className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                            disabled={analyzing}
                            title="산출내역서 엑셀을 올리면 세부 업무단위·등급별 MD를 자동으로 항목화합니다(AI 분석, 1~2분)"
                            onClick={() => breakdownFileRef.current?.click()}
                          >
                            <FileSpreadsheet className="w-3.5 h-3.5" /> {analyzing ? "분석 중..." : "항목 입력(자동)"}
                          </button>
                          {/* 전용 기준 세트(개별, 세분류 '복수 업무') — 수신처 사업장 기준으로 저장·불러오기 */}
                          <button
                            type="button"
                            className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                            disabled={savingSet || analyzing}
                            title="지금 항목을 수신처 사업장의 전용 기준 세트(개별)로 저장합니다 — 다음 견적부터 자동으로 채워집니다(기준 관리 권한 필요)"
                            onClick={() => void saveAsFacilitySet(activeSite)}
                          >
                            <Save className="w-3.5 h-3.5" /> {savingSet ? "저장 중..." : "전용 기준 세트로 저장"}
                          </button>
                          {rateData?.facilitySet && (
                            <button
                              type="button"
                              className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5"
                              title={`[${rateData.facilitySet.facilityName}] 전용 기준 세트의 항목으로 다시 채웁니다`}
                              onClick={() => loadFacilityTree(activeSite)}
                            >
                              <Building2 className="w-3.5 h-3.5" /> 전용 세트 불러오기
                            </button>
                          )}
                          <input
                            ref={breakdownFileRef}
                            type="file"
                            accept=".xlsx,.xlsm,.xls"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = ""; // 같은 파일을 다시 골라도 동작하도록
                              if (file) void runBreakdownAnalyze(activeSite, file);
                            }}
                          />
                          {(() => {
                            const rows = site.customItems ?? [];
                            const totals = treeGradeTotals(rows);
                            const total = Object.values(totals).reduce((a, b) => a + b, 0);
                            if (analyzing) return <span className="text-[11px] cd-text-faint">산출내역서를 분석하고 있습니다. 1~2분 걸릴 수 있습니다.</span>;
                            if (!total) return <span className="text-[11px] cd-text-faint">업무 항목 미입력 — 항목을 입력해야 MD 역산을 실행할 수 있습니다.</span>;
                            // 기준 MD 그대로일 때의 합계(직접경비 제외) — 제출 견적가를 정할 때의 참고값
                            const labor = Object.entries(totals).reduce((a, [g, v]) => a + v * (rateData?.laborRates[g] ?? 0), 0);
                            const std = labor * (1 + site.rates.overheadRate) * (1 + site.rates.techFeeRate);
                            return (
                              <span className="text-[11px] cd-text-faint tabular-nums">
                                기준 {Math.round(total * 100) / 100}MD ({siteGrades(site).filter((g) => totals[g]).map((g) => `${g} ${totals[g]}`).join(" · ")})
                                {std > 0 ? ` · 기준 MD 합계 ${won(std)}원(직접경비 제외)` : ""}
                              </span>
                            );
                          })()}
                        </div>
                        {analysisNote[site.siteSeq] && <p className="text-[11px] cd-text-faint">{analysisNote[site.siteSeq]}</p>}
                        {treeOpen[site.siteSeq] && (
                          <div className="border-t cd-border-c pt-3 flex flex-col gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-[12px] font-semibold cd-text">업무 항목 트리 (별첨1) — 기준 MD = 역산 분배 가중치</p>
                              <button
                                type="button"
                                className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] cd-text-faint"
                                title="구성 업무 태그의 기준 세트(표준 MD × 횟수)로 항목을 다시 채웁니다"
                                onClick={() => {
                                  if (confirm("입력해 둔 업무 항목을 구성 업무의 기준 세트로 다시 채울까요?")) void openManualTree(activeSite, true);
                                }}
                              >
                                구성 업무로 다시 채우기
                              </button>
                            </div>
                            <QuoteItemTreeEditor
                              grades={siteGrades(site)}
                              rows={site.customItems ?? []}
                              onGradesChange={(next) => updateSite(activeSite, { rates: { ...site.rates, grades: next } })}
                              onRowsChange={(next) => updateSite(activeSite, { customItems: next })}
                            />
                            {site.mdMatrix.length > 0 && (
                              <span className="text-[10.5px] cd-text-faint">항목을 바꾼 뒤에는 [견적가 역산 실행] 또는 [MD 역산 실행]을 다시 눌러야 아래 MD 표와 금액에 반영됩니다.</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 사업장 전용 기준 세트(270) — 수신처 사업장에 전용 세트가 있을 때만. 표준 세트로 전환 가능 */}
                    {!isMulti && rateData?.facilitySet && (
                      <div className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2 flex-wrap text-[11.5px]">
                        <Building2 className="w-3.5 h-3.5 cd-text-primary" />
                        <span className="cd-text">
                          {useFacilitySet ? (
                            <><b>{rateData.facilitySet.facilityName}</b> 전용 기준 세트 적용 중</>
                          ) : (
                            <>표준 기준 세트 적용 중 — <b>{rateData.facilitySet.facilityName}</b> 전용 세트가 있습니다</>
                          )}
                        </span>
                        <button
                          type="button"
                          className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px]"
                          onClick={() => setUseFacilitySet((v) => !v)}
                        >
                          {useFacilitySet ? "표준 기준으로 전환" : "전용 기준으로 전환"}
                        </button>
                        {site.mdMatrix.length > 0 && <span className="w-full text-[10.5px] cd-text-faint">전환 후 [MD 역산 실행]을 다시 눌러야 산정에 반영됩니다.</span>}
                      </div>
                    )}

                    {/* 견적가 입력 → 역산 (T1/T2) 또는 자유 품목 (T3) */}
                    <div className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3">
                      {/* 좌 40%: 제출 견적가 → 역산 → 금액 요약 / 우 60%: 요율 + 직접경비 산식 */}
                      <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 items-start">
                        <div className="min-w-0 flex flex-col gap-2.5">
                          {/* 라벨 줄높이(leading-4)·라벨-입력 간격(gap-1)·행 간격(gap-2.5)을 우측 요율 칸과 같게 두어
                              견적가 입력박스 하단 = 요율 입력박스 하단, MD 역산 버튼 상단 = 출장비·인쇄비 상자 상단이 된다(2026-09-30 사용자 요청) */}
                          <div className="flex flex-col gap-1">
                            <span className="text-[12px] leading-4 font-semibold cd-text">제출 견적가(VAT 별도)</span>
                            <AmountInput
                              className="cd-input text-sm text-right"
                              value={priceInputs[site.siteSeq] ?? (site.amounts.final ? String(site.amounts.final) : "")}
                              onChange={(next) => setPriceInputs((prev) => ({ ...prev, [site.siteSeq]: next }))}
                              placeholder="예: 38,000,000"
                            />
                          </div>
                          <div className="flex items-start gap-2 flex-wrap">
                            <span className="text-[11px] cd-text-faint self-center">
                              {(() => {
                                const p = Number(priceInputs[site.siteSeq] ?? 0);
                                return p > 0 ? `${won(p)}원 · 스냅 ${mdSnapUnit(p)}MD · 초과폭 상한 ${won(sumOverCap(p))}원` : "";
                              })()}
                            </span>
                            {tier === "calc" ? (
                              <span className="ml-auto flex items-center gap-2 flex-wrap justify-end">
                                {/* 복수 업무 — 항목 트리에 MD 가 이미 정해져 있으면(엑셀 자동 입력 등) 그 MD 로 견적가를 정한다 */}
                                {isMulti && (
                                  <button
                                    type="button"
                                    className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold"
                                    title="업무 항목에 입력된 MD를 그대로 쓰고, 그 합계 금액에서 제출 견적가를 계산해 채웁니다"
                                    onClick={() => runForward(activeSite)}
                                  >
                                    견적가 역산 실행
                                  </button>
                                )}
                                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => runReverse(activeSite)}>
                                  MD 역산 실행
                                </button>
                              </span>
                            ) : (
                              <span className="text-[11px] cd-text-faint">이 세분류는 기준 세트 미등록 — 품목 직접 입력(자유형)</span>
                            )}
                          </div>

                          {/* 금액 요약 + 제약 상태 */}
                          {site.amounts.final > 0 && (
                            <div className="flex flex-col border-t cd-border-c pt-3.5 text-[12px] cd-text">
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
                                {(
                                  [
                                    ["직접인건비", site.amounts.laborCost],
                                    ["제경비", site.amounts.overhead],
                                    ["기술료", site.amounts.techFee],
                                    ...(site.amounts.directExpense > 0 ? [["직접경비", site.amounts.directExpense] as const] : []),
                                    ["합계", site.amounts.sum],
                                  ] as const
                                ).map(([label, amount]) => (
                                  <span key={label} className="flex items-center justify-between gap-2">
                                    <span className="cd-text-faint">{label}</span>
                                    <b>{won(amount)}</b>
                                  </span>
                                ))}
                              </div>
                              {/* 최종 견적 — 위 내역과 띄우고 강조선 아래 오른쪽 정렬, 제약 상태 태그는 그 왼쪽(2026-10-01 사용자 요청) */}
                              <div className="mt-4 pt-2.5 border-t-2 border-[color:var(--cd-primary)] flex items-center justify-between gap-2 flex-wrap">
                                {site.mdMatrix.length > 0 &&
                                  (() => {
                                    const c = validateSumConstraint(site.amounts.final, site.amounts.sum);
                                    return c.ok ? (
                                      <span className="shrink-0 text-[11px] rounded-full px-2 py-0.5 cd-tint-primary" title={`합계-견적가 초과 ${won(c.over)}원 < 상한 ${won(c.cap)}원`}>제약 OK</span>
                                    ) : (
                                      <span className="text-[11px] rounded-full px-2 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">
                                        ⚠ 제약 위반 — 합계-견적가 {won(c.over)}원 (0 초과 {won(c.cap)}원 미만이어야 상신 가능)
                                      </span>
                                    );
                                  })()}
                                <span className="ml-auto text-[16px] leading-6 font-bold cd-text-primary tabular-nums text-right">최종 견적 {won(site.amounts.final)}원</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex flex-col gap-2.5">
                          <div className="grid grid-cols-3 gap-2 items-end">
                            {(
                              [
                                ["제경비 요율", "overheadRate"],
                                ["기술료 요율", "techFeeRate"],
                              ] as const
                            ).map(([label, key]) => (
                              <label key={key} className="flex flex-col gap-1">
                                <span className="text-[11px] leading-4 cd-text-faint">{label}</span>
                                <span className="flex items-center gap-1 text-[12px] cd-text">
                                  <input className="cd-input text-right text-[12px]" value={String(Math.round(site.rates[key] * 100))} onChange={(e) => editRate(activeSite, key, Number(e.target.value) / 100 || 0)} />%
                                </span>
                              </label>
                            ))}
                            {(() => {
                              // 직접경비 요율 = 직접경비(출장비+인쇄비) ÷ 제출 견적가 — 입력 불가, 비중 표시 전용
                              const price = Number(priceInputs[site.siteSeq] ?? 0) || site.amounts.final;
                              const direct = site.mdMatrix.length ? site.amounts.directExpense : fixedDirectExpense(site.directCosts);
                              const share = price > 0 && direct > 0 ? ((direct / price) * 100).toFixed(1) : "0";
                              return (
                                <label className="flex flex-col gap-1" title="(출장비+인쇄비+공제료) ÷ 제출 견적가 (자동 계산)">
                                  <span className="text-[11px] leading-4 cd-text-faint">직접경비 요율(견적가 대비)</span>
                                  <span className="flex items-center gap-1 text-[12px] cd-text">
                                    <input className="cd-input text-right text-[12px]" value={share} disabled readOnly />%
                                  </span>
                                </label>
                              );
                            })()}
                          </div>

                          {/* 직접경비 산식 — 금액 직접 입력 없이 산식 입력값으로만 계산. 입력칸 5개는 한 격자에 두어 너비를 같게 맞춘다 */}
                          {(() => {
                            const fields: { key: keyof DirectCosts; label: string; money: boolean; value: number }[] = [
                              { key: "travelDayRate", label: "일단가(원)", money: true, value: site.directCosts?.travelDayRate ?? 0 },
                              { key: "travelPersonDays", label: "인원(회)", money: false, value: site.directCosts?.travelPersonDays ?? 0 },
                              { key: "travelTrips", label: "출장 횟수", money: false, value: travelTripsOf(site.directCosts) },
                              { key: "printUnitPrice", label: "부당 단가(원)", money: true, value: site.directCosts?.printUnitPrice ?? 0 },
                              { key: "printCopies", label: "총 부수(부)", money: false, value: site.directCosts?.printCopies ?? 0 },
                            ];
                            return (
                              // 구분선은 별도 좁은 열(row-span-2)로 두어 5개 입력칸 트랙이 전부 같은 폭(1fr)을 갖게 한다
                              <div className="rounded-lg border cd-border-c p-2.5 grid grid-cols-[1fr_1fr_1fr_1px_1fr_1fr] gap-x-2 gap-y-1.5">
                                <div className="col-span-3 flex items-center justify-between text-[12px]">
                                  <span className="font-semibold cd-text">출장비</span>
                                  <span className="cd-text tabular-nums">{won(travelCostOf(site.directCosts))}원</span>
                                </div>
                                <div className="row-span-2 border-l cd-border-c" aria-hidden="true" />
                                <div className="col-span-2 flex items-center justify-between text-[12px]">
                                  <span className="font-semibold cd-text">인쇄비</span>
                                  <span className="cd-text tabular-nums">{won(printCostOf(site.directCosts))}원</span>
                                </div>
                                {fields.map((f) => (
                                  <label key={f.key} className="flex flex-col gap-1 min-w-0">
                                    <span className="text-[11px] cd-text-faint whitespace-nowrap">{f.label}</span>
                                    {f.money ? (
                                      <AmountInput
                                        className="cd-input text-right text-[12px]"
                                        value={f.value || ""}
                                        disabled={tier === "free"}
                                        onChange={(v) => editDirectCost(activeSite, { [f.key]: Number(v) || 0 })}
                                      />
                                    ) : (
                                      <input
                                        className="cd-input text-right text-[12px]"
                                        inputMode="numeric"
                                        value={f.value ? String(f.value) : ""}
                                        disabled={tier === "free"}
                                        onChange={(e) => editDirectCost(activeSite, { [f.key]: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                                      />
                                    )}
                                  </label>
                                ))}
                              </div>
                            );
                          })()}
                          {/* 엔지니어링공제료(손해배상 공제료) — 1단계 + 2단계, 순계약금액 = 제출 견적가. 적용하면 직접경비에 포함 */}
                          {(() => {
                            const d = site.directCosts;
                            const on = !!d?.deductionOn;
                            const price = Number(String(priceInputs[site.siteSeq] ?? "").replace(/[^\d]/g, "")) || site.amounts.final;
                            // 입력 중인 견적가 기준 미리보기(역산을 실행하면 이 값이 직접경비에 들어간다)
                            const calc = engineeringDeduction(price, d);
                            const baseRate = d?.deductionBaseRate ?? ENG_DEDUCTION_BANDS[0].base;
                            const addRate = d?.deductionAddRate ?? ENG_DEDUCTION_BANDS[0].add;
                            const stale = on && site.mdMatrix.length > 0 && deductionCostOf(d) !== calc.total;
                            return (
                              <div className="rounded-lg border cd-border-c p-2.5 flex flex-col gap-1.5">
                                <div className="flex items-center justify-between gap-2 text-[12px]">
                                  <label className="flex items-center gap-1.5 font-semibold cd-text cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      disabled={tier === "free"}
                                      onChange={(e) => editDirectCost(activeSite, { deductionOn: e.target.checked })}
                                    />
                                    엔지니어링공제료
                                  </label>
                                  <span className="cd-text tabular-nums">{won(on ? calc.total : 0)}원</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <label className="flex flex-col gap-1 min-w-0" title={`1단계 기본요율 — 기본값은 환경부문(대기관리) 요율표의 5억원 이하 구간. 고치지 않으면 5억원 초과분은 구간별 요율이 자동 적용됩니다`}>
                                    <span className="text-[11px] cd-text-faint whitespace-nowrap">기본요율(%)</span>
                                    <DecimalInput label="공제료 기본요율(%)" value={baseRate} disabled={!on} onChange={(n) => editDirectCost(activeSite, { deductionBaseRate: n })} />
                                  </label>
                                  <label className="flex flex-col gap-1 min-w-0" title="1단계 가산요율 — 표준담보기간 초과일수에 곱해집니다">
                                    <span className="text-[11px] cd-text-faint whitespace-nowrap">가산요율(%)</span>
                                    <DecimalInput label="공제료 가산요율(%)" value={addRate} disabled={!on} onChange={(n) => editDirectCost(activeSite, { deductionAddRate: n })} />
                                  </label>
                                  <label className="flex flex-col gap-1 min-w-0" title={`표준담보기간(${ENG_DEDUCTION_STD_YEARS}년)을 넘는 담보일수 — 넘지 않으면 0`}>
                                    <span className="text-[11px] cd-text-faint whitespace-nowrap">담보기간 초과일수</span>
                                    <input
                                      className="cd-input text-right text-[12px]"
                                      inputMode="numeric"
                                      aria-label="표준담보기간 초과일수"
                                      disabled={!on}
                                      value={d?.deductionExcessDays ? String(d.deductionExcessDays) : ""}
                                      placeholder="0"
                                      onChange={(e) => editDirectCost(activeSite, { deductionExcessDays: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })}
                                    />
                                  </label>
                                </div>
                                {on && (
                                  <span className="text-[10.5px] cd-text-faint tabular-nums">
                                    {price > 0
                                      ? `1단계 ${won(calc.stage1)}원 + 2단계(견적가 × ${ENG_DEDUCTION_STAGE2_RATE}%) ${won(calc.stage2)}원 · 천원 미만 절사 · 순계약금액 = 제출 견적가`
                                      : "제출 견적가를 입력하면 계산됩니다 · 순계약금액 = 제출 견적가"}
                                    {stale ? " · 견적가가 바뀌었습니다 — 역산을 다시 실행하세요" : ""}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                          <span className="text-[10.5px] cd-text-faint text-right">
                            {tier === "free" ? "자유 입력 견적은 직접경비를 품목으로 입력하세요 · " : ""}V.A.T 별도 · 유효기간 견적일로부터 1개월
                          </span>
                        </div>
                      </div>

                      {/* MD 그리드 (T1/T2) */}
                      {tier === "calc" && site.mdMatrix.length > 0 && (
                        <div className="overflow-x-auto">
                          {/* 등급 축은 산정에 쓰인 세트 스냅샷을 따른다(가변, 143). 열 총폭은 개수와 무관하게 40% */}
                          <table className="w-full text-[11.5px] border-collapse min-w-[680px] table-fixed">
                            <colgroup>
                              <col />
                              {siteGrades(site).map((g) => (
                                <col key={g} style={{ width: `${40 / siteGrades(site).length}%` }} />
                              ))}
                            </colgroup>
                            <thead className="cd-table-head">
                              <tr>
                                <th className="border cd-border-c px-2 py-1.5 text-left cd-text-faint font-semibold">항목 (별첨1)</th>
                                {siteGrades(site).map((g) => (
                                  <th key={g} className="border cd-border-c px-2 py-1.5 cd-text-faint font-semibold">{g}(MD)</th>
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
                                    {siteGrades(site).map((g) => (
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
                                  return siteGrades(site).map((g) => (
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
                              <AmountInput className="cd-input text-sm w-36 text-right" value={it.amount || ""} placeholder="금액(원)" onChange={(v) => {
                                const next = [...(site.freeItems ?? [])];
                                next[i] = { ...next[i], amount: Number(v) || 0 };
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
                      {/* 높이는 cdash.css 의 textarea.cd-input{min-height:64px} 보다 우선하도록 inline(2026-09-30 사용자 요청: 종전의 2.5배) */}
                      <textarea className="cd-input text-[12.5px]" style={{ minHeight: 210 }} value={site.remarks} onChange={(e) => updateSite(activeSite, { remarks: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>

              {/* 하단: 상황 변수(절반) + 재견적 사유(절반, 2026-10-01) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 상황 변수 (건별 상황 조정 레이어 — 내부 기록용, 문서에 표기되지 않음) */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-2.5 min-w-0">
                <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                  <Copy className="w-4 h-4 cd-text-primary" /> 상황 변수
                  <span className="text-[10.5px] font-normal cd-text-faint">가격 결정 배경 기록(내부용) — 수주율 분석의 원료가 됩니다</span>
                </h3>
                {situation.map((s, i) => (
                  // 목록·조정률·사유 한 줄 — cd-select/cd-input 이 width:100% 라 고정폭은 감싸는 요소에 준다
                  <div key={i} className="flex items-center gap-2 flex-wrap md:flex-nowrap">
                    <div className="w-[240px] shrink-0">
                      <select className="cd-select" value={s.code} onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, code: e.target.value } : x)))}>
                        {(rateData?.situationCodes ?? []).map((c) => (
                          <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-1 shrink-0 text-[11.5px] cd-text-faint whitespace-nowrap">조정률
                      <span className="w-16">
                        <input className="cd-input text-right text-[12px]" value={s.rate != null ? String(Math.round(s.rate * 100)) : ""} placeholder="-5" onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, rate: e.target.value === "" ? undefined : Number(e.target.value) / 100 } : x)))} />
                      </span>%
                    </label>
                    <input className="cd-input text-sm flex-1 min-w-[160px] md:min-w-0" value={s.memo ?? ""} placeholder="사유 (예: 경쟁사 OO 저가 투찰 예상)" onChange={(e) => setSituation((prev) => prev.map((x, xi) => (xi === i ? { ...x, memo: e.target.value } : x)))} />
                    <button type="button" className="shrink-0 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => setSituation((prev) => prev.filter((_, xi) => xi !== i))}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint self-start" onClick={() => setSituation((prev) => [...prev, { code: rateData?.situationCodes?.[0]?.code ?? "nego", scope: "doc" }])}>
                  ＋ 상황 변수 추가
                </button>
              </div>

              {/* 재견적 사유 — 재견적 작성 시에만 활성화. 견적 이력의 부연 태그(용역 범위 증가/축소·네고 요청) */}
              <div className="cd-card rounded-3xl p-5 flex flex-col gap-2.5 min-w-0">
                <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                  <History className="w-4 h-4 cd-text-primary" /> 재견적 사유
                  <span className="text-[10.5px] font-normal cd-text-faint">재견적 작성 시에만 활성화 — 견적 이력의 부연 태그로 표시</span>
                </h3>
                <select
                  className="cd-select"
                  value={revisionReason}
                  disabled={!revision}
                  onChange={(e) => setRevisionReason(e.target.value as QuoteRevisionReason | "")}
                  aria-label="재견적 사유"
                >
                  <option value="">{revision ? "사유 선택(필수)" : "원본 견적 — 해당 없음"}</option>
                  {QUOTE_REVISION_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </select>
                {revision ? (
                  <span className="text-[11px] cd-text-faint tabular-nums">
                    금액변동 : {won(prevTotalAmount ?? 0)}원 → {won(currentTotal)}원 (v{Math.max(1, ...revision.items.map((it) => it.version))} 대비)
                  </span>
                ) : (
                  <span className="text-[11px] cd-text-faint">문서함 › 발송견적 탭의 [재견적] 버튼으로 진입한 문서에서만 선택합니다.</span>
                )}
              </div>
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
                    <span key={p.presetId} className="cd-action inline-flex items-center rounded-full border cd-border-c overflow-hidden">
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
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-[11px] cd-text-faint flex-1 flex items-center justify-center gap-1" onClick={saveAsPreset} title="현재 결재선·참조자를 프리셋으로 저장">
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
                    <div key={`${w.userId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                      <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                      <select className="cd-select" style={{ width: 70 }} value={w.kind} onChange={(e) => setWatchers((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as "ref" | "view" } : x)))}>
                        <option value="ref">참조</option>
                        <option value="view">열람</option>
                      </select>
                      <span className="text-[12.5px] cd-text truncate flex-1">
                        {w.name}
                        {w.position ? <span className="cd-text-faint text-[11px]"> {w.position}</span> : null}
                      </span>
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
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={() => send("save")}>
                  <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
                </button>
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={openPreview} title="현재 내용을 견적서 PDF 로 미리보기">
                  <FileText className="w-3.5 h-3.5" /> {busy === "preview" ? "생성 중..." : "미리보기"}
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={() => send("submit")}>
                  <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
                </button>
              </div>
              <p className="text-[10.5px] cd-text-faint">
                승인 완료 시 견적번호 채번 → xlsx/PDF 생성 → {sendMode === "mail" ? "참조자 메일 자동 발송(PDF)" : "발송견적 탭에서 다운로드(직접 제출)"} 순으로 처리됩니다.
              </p>
            </div>
          </div>
          </>
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
            setWatchers((prev) => (prev.some((w) => w.userId === userId) ? prev : [...prev, { userId, name: emp.name, position: emp.positionName, kind: "ref" }]));
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
