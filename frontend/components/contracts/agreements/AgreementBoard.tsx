"use client";

// 계약서 작성(/contracts/agreements) — 용역 계약서 초안 작성·전자결재 검토·발주처 발송 보드.
// 설계: docs/contract-agreement-blueprint.md. 흐름: 연동 선택(수주 견적/기존 계약/직접) →
// 양식(세분류의 활성 표준 셋 자동 선택 + 발주처 자체양식 추천) → 갑지 입력(금액·지급 단계는
// 단일 원천으로 갑지 문구·지급방법 조문 양쪽 자동 생성) → 조문 편집(자동 번호 재부여) →
// PDF 미리보기 → 전자결재 상신(persist docIdOverride — 이중 채번 방지, 공문 실사고 교훈).
// 승인 후에는 자동 발송하지 않는다 — 목록에서 수동 발송(2026-08-10 ① 확정).
// 결재선 패널·발주처 픽커는 QuoteBoard/ApprovalLetterBoard 의 것을 재사용/이식했다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown, ArrowUp, BookmarkPlus, Building2, Eye, FileSignature, FileText, Link2, ListPlus,
  Pencil, Plus, RefreshCw, Save, Search, Send, Settings2, Trash2, Users, X,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { AmountInput } from "@/components/ui/AmountInput";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { FacilityRecipientPicker, QuickFacilityModal, RecipientPicker } from "@/components/approval/ApprovalLetterBoard";
import { DeleteDraftButton, RejectedBanner, toEditDocMeta, type EditDocMeta } from "@/components/approval/DraftEditNotice";
import type { LetterRecipient } from "@/lib/letter/types";
import { QUOTE_SERVICE_OPTIONS } from "@/lib/quote/types";
import { amountLine, computeAmounts, distributePayments, paymentClauseBody } from "@/lib/agreement/compose";
import {
  AGREEMENT_FORM_ID,
  AGREEMENT_SEND_STATUS_LABEL,
  type AgreementClause,
  type AgreementFieldValues,
  type AgreementOrdererInfo,
  type AgreementSendStatus,
  type AgreementTemplateRow,
  type PaymentStep,
} from "@/lib/agreement/types";
import "@/components/cdash/cdash.css";

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

interface DocListRow {
  docId: string;
  docNo: string | null;
  title: string;
  docStatus: string;
  drafterName: string | null;
  updatedAt: string;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  ordererName: string | null;
  amountSupply: number | null;
  templateName: string | null;
  sendStatus: AgreementSendStatus | null;
  sentAt: string | null;
  pdfKey: string | null;
  hwpxKey: string | null;
}

// lib/deliverable/data.ts searchContracts(ContractSearchRow) 반환 필드 그대로
interface SourceContract {
  contractId: string;
  title: string;
  ordererName: string;
  siteName: string;
  serviceType: string;
  contractDate: string;
}
interface SourceQuote {
  quoteId: string;
  quoteNo: string | null;
  title: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  totalAmount: number | null;
  facilityId: string | null;
  facilityName: string | null;
}

const won = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);
/** 상태 배지 — 점 + 은은한 틴트(테두리 pill 보다 정돈된 표현) */
function StatusPill({
  kind,
  children,
  title,
}: {
  kind: "ok" | "bad" | "busy" | "idle";
  children: React.ReactNode;
  title?: string;
}) {
  const tone: Record<string, { bg: string; fg: string; dot: string }> = {
    ok: { bg: "rgba(93,135,255,0.13)", fg: "var(--cd-primary)", dot: "var(--cd-primary)" },
    bad: { bg: "rgba(250,137,107,0.15)", fg: "var(--cd-danger, #FA896B)", dot: "var(--cd-danger, #FA896B)" },
    busy: { bg: "rgba(255,174,31,0.16)", fg: "#B7791F", dot: "#FFAE1F" },
    idle: { bg: "rgba(120,130,160,0.12)", fg: "var(--cd-muted)", dot: "var(--cd-faint)" },
  };
  const t = tone[kind];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
      style={{ background: t.bg, color: t.fg }}
      title={title}
    >
      <span className="rounded-full" style={{ width: 5, height: 5, background: t.dot }} />
      {children}
    </span>
  );
}

/** "26-08-11 07:55" — 목록의 작성/발송 일시 */
const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = /^(\d{2})(\d{2})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}` : iso.slice(0, 10);
};
const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "작성 중",
  in_progress: "결재 진행",
  approved: "승인",
  rejected: "반려",
};

const EMPTY_ORDERER: AgreementOrdererInfo = { facilityId: null, name: "", ceo: "", address: "", bizNo: "", phone: "" };
const DEFAULT_PAYMENTS: PaymentStep[] = [
  { label: "착수금", ratio: 30, amount: 0, condition: "계약 완료 후 현금 지급" },
  { label: "중도금", ratio: 40, amount: 0, condition: "성과품 접수 후 현금 지급" },
  { label: "잔금", ratio: 30, amount: 0, condition: "용역 완료 후 현금 지급" },
];

let clauseSeq = 0;
const newClauseId = () => `c-${Date.now().toString(36)}-${clauseSeq++}`;

export function AgreementBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const editDocId = sp.get("docId");

  const [mode, setMode] = useState<"list" | "edit">(editDocId ? "edit" : "list");

  // ── 목록 ──
  const [docs, setDocs] = useState<DocListRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listQ, setListQ] = useState("");
  const [sendBusy, setSendBusy] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);

  // ── 작성 상태 ──
  const [docId, setDocId] = useState<string | null>(editDocId);
  const [subject, setSubject] = useState("");
  const [serviceType, setServiceType] = useState("통합허가");
  const [serviceSubtype, setServiceSubtype] = useState("최초허가");
  const [template, setTemplate] = useState<AgreementTemplateRow | null>(null);
  const [customTemplates, setCustomTemplates] = useState<{ templateId: string; name: string }[]>([]);
  const [ordererList, setOrdererList] = useState<LetterRecipient[]>([]); // FacilityRecipientPicker 호환(단일 유지)
  const [orderer, setOrderer] = useState<AgreementOrdererInfo>(EMPTY_ORDERER);
  const [amountSupply, setAmountSupply] = useState(0);
  const [payments, setPayments] = useState<PaymentStep[]>(DEFAULT_PAYMENTS);
  const [payTab, setPayTab] = useState(0);
  const [clauseTab, setClauseTab] = useState(0);
  const [periodText, setPeriodText] = useState("계약일 부터 용역 완료 시 까지");
  const [scopeText, setScopeText] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [attachNote, setAttachNote] = useState("용역계약 조건 1부.");
  const [clauses, setClauses] = useState<AgreementClause[]>([]);
  const [hasClausePage, setHasClausePage] = useState(true);
  const [contractId, setContractId] = useState<string | null>(null);
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [linkLabel, setLinkLabel] = useState<string | null>(null);

  // 연동 검색
  const [srcQ, setSrcQ] = useState("");
  const [srcOpen, setSrcOpen] = useState(false);
  const [srcContracts, setSrcContracts] = useState<SourceContract[]>([]);
  const [srcQuotes, setSrcQuotes] = useState<SourceQuote[]>([]);

  // 결재선
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [presets, setPresets] = useState<LinePreset[]>([]);
  const [orgModal, setOrgModal] = useState<OrgTarget | null>(null);
  const [facilityModal, setFacilityModal] = useState(false);

  const [busy, setBusy] = useState<"save" | "submit" | "preview" | null>(null);
  const [loading, setLoading] = useState(!!editDocId);
  const [editMeta, setEditMeta] = useState<EditDocMeta | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const subtypeOptions = useMemo(
    () => SERVICE_OPTIONS.find((o) => o.type === serviceType)?.subtypes ?? [],
    [serviceType]
  );
  const amounts = useMemo(() => computeAmounts(amountSupply), [amountSupply]);

  // ── 목록 로드 ──
  const loadDocs = useCallback(() => {
    setListLoading(true);
    const qs = listQ.trim() ? `?q=${encodeURIComponent(listQ.trim())}` : "";
    fetch(`/api/contracts/agreements${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDocs(Array.isArray(d?.docs) ? d.docs : []))
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, [listQ]);
  useEffect(() => {
    if (mode === "list") loadDocs();
  }, [mode, loadDocs]);

  // ── 세분류 → 표준 셋 자동 선택 (custom 양식을 직접 고른 경우는 유지) ──
  useEffect(() => {
    if (template?.kind === "custom") return;
    let cancelled = false;
    fetch(
      `/api/contracts/agreements/templates?serviceType=${encodeURIComponent(serviceType)}&serviceSubtype=${encodeURIComponent(serviceSubtype)}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const tpl = (d?.template ?? null) as AgreementTemplateRow | null;
        setTemplate(tpl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, serviceSubtype]);

  // 템플릿 변경 → 조문 스냅 갱신(사용자 편집분이 있으면 유지 여부 확인)
  const prevTplId = template?.templateId ?? null;
  useEffect(() => {
    if (!template) {
      setHasClausePage(false);
      setClauses([]);
      return;
    }
    const tplClauses = template.spec.clausePage?.clauses ?? [];
    setHasClausePage(!!template.spec.clausePage);
    setClauses(tplClauses.map((c) => ({ ...c })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevTplId]);

  // ── 연동 검색 ──
  useEffect(() => {
    if (!srcOpen) return;
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/contracts/agreements/sources?q=${encodeURIComponent(srcQ.trim())}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setSrcContracts(Array.isArray(d?.contracts) ? d.contracts : []);
          setSrcQuotes(Array.isArray(d?.quotes) ? d.quotes : []);
        })
        .catch(() => {});
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [srcQ, srcOpen]);

  const loadOrdererDetail = useCallback((facilityId: string) => {
    fetch(`/api/contracts/agreements/sources?facilityId=${encodeURIComponent(facilityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.orderer) return;
        setOrderer((prev) => ({
          facilityId: d.orderer.facilityId,
          name: d.orderer.name || prev.name,
          ceo: prev.ceo,
          address: d.orderer.address || prev.address,
          bizNo: d.orderer.bizNo || prev.bizNo,
          phone: d.orderer.phone || prev.phone,
        }));
        setCustomTemplates(Array.isArray(d.customTemplates) ? d.customTemplates : []);
      })
      .catch(() => {});
  }, []);

  // 발주처 픽커(단일 유지) — 픽커가 주는 주소·사업자번호는 즉시 반영하고,
  // 전화번호·자체양식 추천은 상세 API 로 보강한다(실패해도 기본 채움은 유지).
  const onOrdererChange = useCallback(
    (next: LetterRecipient[]) => {
      const last = next.length ? [next[next.length - 1]] : [];
      setOrdererList(last);
      if (last.length) {
        const r = last[0] as LetterRecipient & { address?: string; bizNo?: string };
        setOrderer((prev) => ({
          ...prev,
          facilityId: r.facilityId ?? null,
          name: r.name ?? "",
          address: r.address || prev.address,
          bizNo: r.bizNo || prev.bizNo,
        }));
        if (r.facilityId) loadOrdererDetail(r.facilityId);
      } else {
        setOrderer(EMPTY_ORDERER);
        setCustomTemplates([]);
      }
    },
    [loadOrdererDetail]
  );

  const applyContract = useCallback(
    (c: SourceContract) => {
      setContractId(c.contractId);
      setQuotationId(null);
      setLinkLabel(`계약: ${c.title}`);
      setSrcOpen(false);
      fetch(`/api/contracts/agreements/sources?contractId=${encodeURIComponent(c.contractId)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d?.contract) return;
          setSubject(d.contract.title ?? "");
          if (d.contract.serviceType) setServiceType(d.contract.serviceType);
          if (d.contract.serviceSubtype) setServiceSubtype(d.contract.serviceSubtype);
          if (d.contract.amount) {
            const supply = Math.round(Number(d.contract.amount) / 1.1);
            setAmountSupply(supply);
            setPayments((prev) => distributePayments(supply, prev));
          }
          if (d.orderer) {
            setOrderer((prev) => ({ ...d.orderer, ceo: prev.ceo }));
            setOrdererList([{ facilityId: d.orderer.facilityId, name: d.orderer.name } as LetterRecipient]);
          }
          setCustomTemplates(Array.isArray(d.customTemplates) ? d.customTemplates : []);
        })
        .catch(() => {});
    },
    []
  );

  const applyQuote = useCallback(
    (q: SourceQuote) => {
      setQuotationId(q.quoteId);
      setContractId(null);
      setLinkLabel(`견적: ${q.quoteNo ?? ""} ${q.title ?? ""}`.trim());
      setSrcOpen(false);
      setSubject(q.title ?? "");
      if (q.serviceType) setServiceType(q.serviceType);
      if (q.serviceSubtype) setServiceSubtype(q.serviceSubtype);
      if (q.totalAmount) {
        setAmountSupply(q.totalAmount);
        setPayments((prev) => distributePayments(q.totalAmount ?? 0, prev));
      }
      if (q.facilityId) {
        setOrdererList([{ facilityId: q.facilityId, name: q.facilityName ?? "" } as LetterRecipient]);
        setOrderer((prev) => ({ ...prev, facilityId: q.facilityId, name: q.facilityName ?? prev.name }));
        loadOrdererDetail(q.facilityId);
      }
    },
    [loadOrdererDetail]
  );

  // ── 결재선 프리셋 ──
  useEffect(() => {
    fetch("/api/approval/line-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d?.presets) && setPresets(d.presets))
      .catch(() => {});
  }, []);
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

  // ── 재편집(임시저장/반려) — field_values 복원 ──
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
        const v = (d.fieldValues ?? {}) as Partial<AgreementFieldValues>;
        setEditMeta(toEditDocMeta(d));
        setSubject(d.title ?? v.title ?? "");
        if (v.serviceType) setServiceType(v.serviceType);
        if (v.serviceSubtype) setServiceSubtype(v.serviceSubtype);
        if (v.orderer) {
          setOrderer({ ...EMPTY_ORDERER, ...v.orderer });
          if (v.orderer.name) setOrdererList([{ facilityId: v.orderer.facilityId ?? undefined, name: v.orderer.name } as LetterRecipient]);
        }
        if (v.amountSupply != null) setAmountSupply(Number(v.amountSupply) || 0);
        if (Array.isArray(v.payments)) setPayments(v.payments);
        if (v.periodText) setPeriodText(v.periodText);
        if (v.scopeText != null) setScopeText(v.scopeText);
        if (v.issueDate) setIssueDate(v.issueDate);
        if (v.attachNote != null) setAttachNote(v.attachNote);
        setContractId(v.contractId ?? null);
        setQuotationId(v.quotationId ?? null);
        if (v.contractId) setLinkLabel("계약 연동");
        else if (v.quotationId) setLinkLabel("견적 연동");
        // 템플릿·조문 스냅 복원 — 템플릿 로드 후 스냅으로 덮어쓴다(편집분 보존)
        if (v.templateId) {
          const tRes = await fetch(`/api/contracts/agreements/templates?templateId=${encodeURIComponent(v.templateId)}`, { cache: "no-store" });
          if (tRes.ok) {
            const tData = await tRes.json();
            if (!cancelled && tData?.template) setTemplate(tData.template);
          }
        }
        if (Array.isArray(v.clauses)) {
          // 템플릿 변경 이펙트가 기본 조문으로 리셋한 뒤에 스냅으로 복원되도록 지연 적용
          setTimeout(() => {
            if (cancelled) return;
            setClauses(v.clauses as AgreementClause[]);
            setHasClausePage(v.hasClausePage ?? (v.clauses as AgreementClause[]).length > 0);
          }, 0);
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

  // ── field_values 조립 ──
  const buildFieldValues = useCallback((): AgreementFieldValues => {
    return {
      templateId: template?.templateId ?? null,
      contractId,
      quotationId,
      serviceType,
      serviceSubtype,
      title: subject,
      orderer,
      amountSupply: amounts.supply,
      payments,
      periodText,
      scopeText,
      issueDate,
      attachNote: hasClausePage ? attachNote : undefined,
      clauses,
      hasClausePage,
      // 양식별 조회 표시용
      ...({
        orderer_display: orderer.name,
        amount_display: `${won(amounts.supply)} (VAT 별도)`,
        template_display: template?.name ?? "미지정",
      } as unknown as Partial<AgreementFieldValues>),
    };
  }, [template, contractId, quotationId, serviceType, serviceSubtype, subject, orderer, amounts.supply, payments, periodText, scopeText, issueDate, attachNote, clauses, hasClausePage]);

  const persist = useCallback(
    // docIdOverride: save 직후 submit — setDocId 비동기로 인한 이중 문서·채번 이중 소모 방지(공문 실사고 교훈)
    async (action: "save" | "submit", docIdOverride?: string): Promise<{ docId: string; docNo?: string | null }> => {
      const res = await fetch("/api/approval/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          docId: docIdOverride ?? docId,
          formId: AGREEMENT_FORM_ID,
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
    if (!subject.trim()) return "계약명을 입력하세요.";
    if (!template) return "계약서 양식이 없습니다 — 이 세분류의 표준 셋이 미지정입니다(기준 관리에서 등록).";
    if (!orderer.name.trim()) return "발주처를 지정하세요.";
    if (!(amounts.supply > 0)) return "계약금액(공급가)을 입력하세요.";
    if (payments.length === 0) return "지급 단계를 1개 이상 추가하세요.";
    const paySum = payments.reduce((a, p) => a + p.amount, 0);
    if (paySum !== amounts.supply)
      return `지급 단계 금액 합(${won(paySum)})이 공급가(${won(amounts.supply)})와 다릅니다.`;
    if (!periodText.trim()) return "계약기간을 입력하세요.";
    if (line.length === 0) return "결재선에 결재자를 1명 이상 추가하세요.";
    return null;
  }, [subject, template, orderer, amounts.supply, payments, periodText, line]);

  const openPreview = useCallback(async () => {
    if (!template) return alert("계약서 양식이 없습니다.");
    setBusy("preview");
    setPreviewOpen(true);
    try {
      const res = await fetch("/api/contracts/agreements/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldValues: buildFieldValues() }),
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
  }, [template, buildFieldValues]);

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
        await persist("submit", saved.docId);
        alert("상신되었습니다. 결재 승인이 완료되면 목록에서 발주처 담당자에게 발송할 수 있습니다(자동 발송 없음).");
        setMode("list");
        router.replace("/contracts/agreements");
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [validate, persist, router]
  );

  // ── 조문 편집 ──
  const updateClause = (i: number, patch: Partial<AgreementClause>) =>
    setClauses((prev) => prev.map((c, ci) => (ci === i ? { ...c, ...patch } : c)));
  const moveClause = (i: number, dir: -1 | 1) =>
    setClauses((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeClause = (i: number) => setClauses((prev) => prev.filter((_, ci) => ci !== i));
  const insertClause = (i: number) =>
    setClauses((prev) => {
      const next = [...prev];
      next.splice(i + 1, 0, { id: newClauseId(), title: "추가 조항", body: "" });
      return next;
    });

  const resetForNew = () => {
    setDocId(null);
    setEditMeta(null);
    setSubject("");
    setOrderer(EMPTY_ORDERER);
    setOrdererList([]);
    setAmountSupply(0);
    setPayments(DEFAULT_PAYMENTS.map((p) => ({ ...p })));
    setPeriodText("계약일 부터 용역 완료 시 까지");
    setScopeText("");
    setIssueDate(new Date().toISOString().slice(0, 10));
    setAttachNote("용역계약 조건 1부.");
    setContractId(null);
    setQuotationId(null);
    setLinkLabel(null);
    setCustomTemplates([]);
    setMode("edit");
  };

  /** 계약서 삭제 — 대장 + 전자결재 문서를 함께 지운다(테스트 발송분·폐기 건 정리). */
  const removeAgreement = async (row: DocListRow) => {
    const warn =
      row.docStatus === "approved"
        ? `"${row.title}"\n\n승인 완료된 계약서입니다. 전자결재 문서도 함께 삭제되며 되돌릴 수 없습니다. 계속할까요?`
        : `"${row.title}"\n\n계약서와 전자결재 문서를 함께 삭제합니다. 계속할까요?`;
    if (!window.confirm(warn)) return;
    setDeleteBusy(row.docId);
    try {
      const res = await fetch(`/api/contracts/agreements/${encodeURIComponent(row.docId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "삭제 실패");
      loadDocs();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDeleteBusy(null);
    }
  };

  // 수동 발송(승인 후) 다이얼로그 — 수신 담당자·첨부 구성을 확정해 발송(① 확정).
  const [sendTarget, setSendTarget] = useState<DocListRow | null>(null);
  const [sendRecipients, setSendRecipients] = useState<LetterRecipient[]>([]);
  const [sendIncludeHwpx, setSendIncludeHwpx] = useState(true);
  const [sendIncludePdf, setSendIncludePdf] = useState(false);
  const [sendNote, setSendNote] = useState("");

  const openSendDialog = (row: DocListRow) => {
    setSendTarget(row);
    setSendRecipients([]);
    setSendIncludeHwpx(true);
    setSendIncludePdf(false);
    setSendNote("");
  };

  const runSend = async () => {
    if (!sendTarget) return;
    const recipients = sendRecipients.filter((r) => (r.email ?? "").includes("@"));
    if (!recipients.length) return alert("수신 담당자를 1명 이상 지정하세요(메일주소 필요).");
    if (!sendIncludeHwpx && !sendIncludePdf) return alert("첨부(HWPX/PDF)를 1개 이상 선택하세요.");
    setSendBusy(sendTarget.docId);
    try {
      const res = await fetch(`/api/contracts/agreements/${encodeURIComponent(sendTarget.docId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: recipients.map((r) => ({
            name: r.name,
            deptName: r.deptName,
            title: r.title,
            email: r.email,
            phone: r.phone,
            facilityName: r.facilityName,
            facilityId: r.facilityId,
          })),
          includeHwpx: sendIncludeHwpx,
          includePdf: sendIncludePdf,
          note: sendNote || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "발송 실패");
      alert("발송되었습니다.");
      setSendTarget(null);
      loadDocs();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSendBusy(null);
    }
  };

  // ══════════ 렌더 ══════════

  if (mode === "list") {
    return (
      <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
        <CdPageHeader
          title="계약서 작성"
          actions={
            <div className="flex items-center gap-2">
              <a href="/contracts/agreements/templates" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5" /> 양식 기준 관리
              </a>
              <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5" onClick={resetForNew}>
                <Plus className="w-3.5 h-3.5" /> 새 계약서
              </button>
            </div>
          }
        />
        {/* 목록은 표시 항목이 많아 메뉴 전체 폭을 쓴다(작성 화면만 1032px 지면 규칙 적용) */}
        <div className="cd-card rounded-3xl p-5 flex flex-col gap-3 w-full">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                className="cd-input text-sm w-72"
                style={{ paddingLeft: 32 }}
                placeholder="계약명·발주처 검색"
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadDocs()}
              />
            </div>
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-xs cd-text-faint" onClick={loadDocs} title="새로고침">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <span className="ml-auto text-[11px] cd-text-faint">{docs.length}건</span>
          </div>
          {listLoading ? (
            <div className="p-8 text-center text-sm cd-text-faint">불러오는 중...</div>
          ) : docs.length === 0 ? (
            <div className="p-8 text-center text-sm cd-text-faint">작성된 계약서가 없습니다. [새 계약서]로 시작하세요.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="py-2 pr-3 font-medium">계약명</th>
                    <th className="py-2 pr-3 font-medium">발주처</th>
                    <th className="py-2 pr-3 font-medium">분류</th>
                    <th className="py-2 pr-3 font-medium text-right">공급가</th>
                    <th className="py-2 pr-3 font-medium">기안자</th>
                    <th className="py-2 pr-3 font-medium">작성 / 승인</th>
                    <th className="py-2 pr-3 font-medium">결재</th>
                    <th className="py-2 pr-3 font-medium">발송</th>
                    <th className="py-2 font-medium text-right">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((row) => {
                    const editable = row.docStatus === "draft" || row.docStatus === "rejected";
                    const canSend = row.sendStatus === "approved" || row.sendStatus === "failed";
                    return (
                      <tr key={row.docId} className="border-b cd-border-c last:border-b-0">
                        <td className="py-2.5 pr-3 cd-text font-medium">
                          {row.title || "(무제)"}
                          {row.docNo ? <span className="cd-text-faint text-[11px] ml-1.5">{row.docNo}</span> : null}
                        </td>
                        <td className="py-2.5 pr-3 cd-text">{row.ordererName ?? "—"}</td>
                        <td className="py-2.5 pr-3 cd-text-faint">
                          {[row.serviceType, row.serviceSubtype].filter(Boolean).join(" · ") || "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-right cd-text">{won(row.amountSupply)}</td>
                        <td className="py-2.5 pr-3 cd-text-faint">{row.drafterName ?? "—"}</td>
                        <td className="py-2.5 pr-3 whitespace-nowrap text-[11px] leading-[1.55]">
                          <div className="cd-text-faint">작성 : {shortDate(row.createdAt)}</div>
                          <div className={row.sentAt ? "cd-text" : "cd-text-faint"}>
                            {row.sentAt ? `발송 : ${shortDate(row.sentAt)}` : row.completedAt ? `승인 : ${shortDate(row.completedAt)}` : "발송 : —"}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <StatusPill kind={row.docStatus === "approved" ? "ok" : row.docStatus === "rejected" ? "bad" : row.docStatus === "in_progress" ? "busy" : "idle"}>
                            {DOC_STATUS_LABEL[row.docStatus] ?? row.docStatus}
                          </StatusPill>
                        </td>
                        <td className="py-2.5 pr-3">
                          {row.sendStatus ? (
                            <StatusPill
                              kind={row.sendStatus === "sent" ? "ok" : row.sendStatus === "failed" ? "bad" : row.sendStatus === "sending" ? "busy" : "idle"}
                              title={row.sentAt ?? undefined}
                            >
                              {row.sendStatus === "approved" ? "발송 대기" : AGREEMENT_SEND_STATUS_LABEL[row.sendStatus]}
                            </StatusPill>
                          ) : (
                            <span className="cd-text-faint text-[11px]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {editable && (
                            <a className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[11px] inline-flex items-center gap-1 mr-1" href={`/contracts/agreements?docId=${encodeURIComponent(row.docId)}`}>
                              <Pencil className="w-3 h-3" /> 편집
                            </a>
                          )}
                          {/* 승인 완료면 산출물이 아직 S3 에 없어도 온디맨드 렌더로 받을 수 있다
                              (발송 전에는 pdfKey/hwpxKey 가 비어 있다 — 발송 시 생성·보관).
                              아이콘은 전자결재 문서 뷰어와 동일 규격(HWPX 37px / PDF 32px — 종횡비 보정) */}
                          {(row.pdfKey || row.docStatus === "approved") && (
                            <a className="inline-flex items-center justify-center align-middle mr-0.5" style={{ width: 37, height: 37 }} href={`/api/contracts/agreements/${encodeURIComponent(row.docId)}/hwpx`} title="HWPX 다운로드(한글 원본)">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src="/icons/hwpxico.png?v=4" alt="HWPX" style={{ width: 37, height: 37, objectFit: "contain" }} />
                            </a>
                          )}
                          {(row.pdfKey || row.docStatus === "approved") && (
                            <a className="inline-flex items-center justify-center align-middle mr-1" style={{ width: 32, height: 32 }} href={`/api/contracts/agreements/${encodeURIComponent(row.docId)}/pdf`} target="_blank" rel="noreferrer" title="PDF 열기">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src="/icons/pdfico.png" alt="PDF" style={{ width: 32, height: 32, objectFit: "contain" }} />
                            </a>
                          )}
                          {canSend && (
                            <button type="button" className="cd-btn cd-btn-primary rounded-lg px-2.5 py-1.5 text-[11px] inline-flex items-center gap-1 disabled:opacity-50 align-middle" disabled={sendBusy === row.docId} onClick={() => openSendDialog(row)}>
                              <Send className="w-3 h-3" /> {sendBusy === row.docId ? "발송 중" : row.sendStatus === "failed" ? "재발송" : "발주처 발송"}
                            </button>
                          )}
                          {row.sendStatus === "sent" && (
                            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] inline-flex items-center gap-1 align-middle" onClick={() => openSendDialog(row)} title="같은 계약서를 다시 발송합니다">
                              <Send className="w-3 h-3" /> 재발송
                            </button>
                          )}
                          <button
                            type="button"
                            className="cd-btn rounded-lg border cd-border-c px-2 py-1.5 text-[11px] inline-flex items-center align-middle ml-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] disabled:opacity-40"
                            disabled={deleteBusy === row.docId}
                            title="계약서 삭제(전자결재 문서도 함께 삭제)"
                            onClick={() => removeAgreement(row)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 발주처 발송 다이얼로그 — 수신 담당자·첨부 구성 확정(① 수동 발송 확정) */}
        {sendTarget && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={() => setSendTarget(null)}>
            <div className="cdash cd-fields-white rounded-2xl cd-solid-bg shadow-2xl w-full max-w-[640px] flex flex-col overflow-hidden" data-theme={theme} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center px-5 py-3 border-b cd-border-c">
                <span className="text-sm font-bold cd-text">발주처 발송 — {sendTarget.title}</span>
                <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setSendTarget(null)}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
                <RecipientPicker
                  label="수신 담당자 *"
                  hint="발주처 담당자를 검색해 추가하세요(주소록·명함 데이터). 목록에 없으면 직접 입력으로 추가합니다."
                  list={sendRecipients}
                  onChange={setSendRecipients}
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] cd-text-faint">첨부 구성 — 초안 협의는 편집 가능한 HWPX 가 기본입니다</span>
                  <label className="flex items-center gap-2 text-[12.5px] cd-text">
                    <input type="checkbox" checked={sendIncludeHwpx} onChange={(e) => setSendIncludeHwpx(e.target.checked)} />
                    계약서 HWPX (한글 편집본 — 기본)
                  </label>
                  <label className="flex items-center gap-2 text-[12.5px] cd-text">
                    <input type="checkbox" checked={sendIncludePdf} onChange={(e) => setSendIncludePdf(e.target.checked)} />
                    계약서 PDF (열람본)
                  </label>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] cd-text-faint">추가 안내 문구 (선택 — 메일 본문에 삽입)</span>
                  <textarea className="cd-input text-[12.5px] min-h-[64px]" value={sendNote} onChange={(e) => setSendNote(e.target.value)} placeholder="예: 5조 지급 조건은 협의 결과를 반영했습니다. 확인 부탁드립니다." />
                </label>
                <p className="text-[11px] cd-text-faint">
                  발신은 기안자 계정 메일로 나가며, 결재선의 참조/열람자가 내부 참조(Cc)로 함께 받습니다.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t cd-border-c">
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold" onClick={() => setSendTarget(null)}>
                  취소
                </button>
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={sendBusy != null} onClick={runSend}>
                  <Send className="w-3.5 h-3.5" /> {sendBusy ? "발송 중..." : "발송"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <div className="flex flex-col gap-5 min-h-0">
        <CdPageHeader
          title="계약서 작성"
          actions={
            <div className="flex items-center gap-2">
              <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold" onClick={() => { setMode("list"); router.replace("/contracts/agreements"); }}>
                목록으로
              </button>
              <DeleteDraftButton docId={docId} meta={editMeta} label="기안 삭제" />
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
              {/* 좌: 작성 카드들 — 폭은 견적·공문 작성(1032px)과 동일 */}
              <div className="flex-1 min-w-0 max-w-[1032px] flex flex-col gap-4 w-full">
                {/* 기본 정보 */}
                <div className="cd-card rounded-3xl p-5 flex flex-col gap-3.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                      <FileSignature className="w-4 h-4 cd-text-primary" /> 기본 정보
                    </h3>
                    <a href="/contracts/agreements/templates" className="ml-auto text-[11px] cd-text-faint hover:cd-text flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> 양식 기준 관리
                    </a>
                  </div>

                  {/* 연동 선택 */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] cd-text-faint">연동 (선택) — 수주 견적·기존 계약에서 자동 채움</span>
                    {linkLabel ? (
                      <div className="flex items-center gap-2 rounded-xl border cd-border-c px-3 py-2">
                        <Link2 className="w-3.5 h-3.5 cd-text-primary" />
                        <span className="text-[12.5px] cd-text truncate flex-1">{linkLabel}</span>
                        <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => { setContractId(null); setQuotationId(null); setLinkLabel(null); }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          className="cd-input text-sm w-full"
                          style={{ paddingLeft: 32 }}
                          placeholder="계약명·발주처·견적번호 검색 후 선택 (직접 입력 시 생략)"
                          value={srcQ}
                          onFocus={() => setSrcOpen(true)}
                          onBlur={() => setTimeout(() => setSrcOpen(false), 180)}
                          onChange={(e) => setSrcQ(e.target.value)}
                        />
                        {srcOpen && (srcContracts.length > 0 || srcQuotes.length > 0) && (
                          <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border cd-border-c cd-solid-bg shadow-xl p-1.5">
                            {srcQuotes.length > 0 && <div className="px-2 py-1 text-[10.5px] cd-text-faint">수주 확정 견적</div>}
                            {srcQuotes.map((q) => (
                              <button key={q.quoteId} type="button" className="w-full text-left rounded-lg px-2.5 py-1.5 hover:cd-tint-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => applyQuote(q)}>
                                <span className="text-[12.5px] cd-text">{q.title ?? "(무제)"}</span>
                                <span className="text-[11px] cd-text-faint ml-1.5">{q.quoteNo} · {q.facilityName ?? "—"} · {won(q.totalAmount)}</span>
                              </button>
                            ))}
                            {srcContracts.length > 0 && <div className="px-2 py-1 text-[10.5px] cd-text-faint">기존 계약</div>}
                            {srcContracts.map((c) => (
                              <button key={c.contractId} type="button" className="w-full text-left rounded-lg px-2.5 py-1.5 hover:cd-tint-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => applyContract(c)}>
                                <span className="text-[12.5px] cd-text">{c.title || "(무제)"}</span>
                                <span className="text-[11px] cd-text-faint ml-1.5">
                                  {[c.ordererName || c.siteName || "—", c.serviceType, c.contractDate?.slice(0, 10)].filter(Boolean).join(" · ")}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">계약명 *</span>
                      <input className="cd-input text-sm" value={subject} placeholder="예: ○○(주) ○○사업소 통합환경 허가재검토 용역" onChange={(e) => setSubject(e.target.value)} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">용역 대분류</span>
                        <select className="cd-select" value={serviceType} onChange={(e) => { setServiceType(e.target.value); setServiceSubtype(SERVICE_OPTIONS.find((o) => o.type === e.target.value)?.subtypes[0] ?? ""); }}>
                          {SERVICE_OPTIONS.map((o) => (
                            <option key={o.type} value={o.type}>{o.type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">세분류</span>
                        <select className="cd-select" value={serviceSubtype} onChange={(e) => setServiceSubtype(e.target.value)}>
                          {subtypeOptions.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">계약서 양식 — 세분류의 표준 셋 자동 선택</span>
                      <div className="flex items-center gap-2">
                        <div className={`flex-1 rounded-xl border cd-border-c px-3 py-2 text-[12.5px] ${template ? "cd-text" : "text-[color:var(--cd-danger,#FA896B)]"}`}>
                          {template ? (
                            <>
                              {template.name}
                              {template.seeded ? <span className="cd-text-faint text-[10.5px] ml-1.5">(기본 시드)</span> : null}
                              {template.kind === "custom" ? <span className="cd-text-faint text-[10.5px] ml-1.5">(발주처 자체양식)</span> : null}
                            </>
                          ) : (
                            "이 세분류의 표준 셋 미지정 — 기준 관리에서 등록하세요"
                          )}
                        </div>
                      </div>
                      {customTemplates.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          <span className="text-[10.5px] cd-text-faint">이 발주처 자체양식:</span>
                          {customTemplates.map((t) => (
                            <button
                              key={t.templateId}
                              type="button"
                              className={`text-[11px] rounded-full border px-2 py-0.5 ${template?.templateId === t.templateId ? "cd-fill-primary" : "cd-border-c hover:cd-tint-primary"}`}
                              onClick={() => {
                                fetch(`/api/contracts/agreements/templates?templateId=${encodeURIComponent(t.templateId)}`, { cache: "no-store" })
                                  .then((r) => (r.ok ? r.json() : null))
                                  .then((d) => d?.template && setTemplate(d.template));
                              }}
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">체결일</span>
                        <AutoDateInput className="cd-input text-sm" value={issueDate} onChange={setIssueDate} />
                      </label>
                      {hasClausePage && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] cd-text-faint">첨부 표기</span>
                          <input className="cd-input text-sm" value={attachNote} onChange={(e) => setAttachNote(e.target.value)} />
                        </label>
                      )}
                    </div>
                  </div>
                </div>

                {/* 발주처 정보 */}
                <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <Building2 className="w-4 h-4 cd-text-primary" /> 발주처 (계약 상대방)
                    <span className="text-[10.5px] font-normal cd-text-faint">사업장을 검색해 선택하면 주소·사업자번호가 자동 채움됩니다</span>
                  </h3>
                  <FacilityRecipientPicker list={ordererList} onChange={onOrdererChange} onNewFacility={() => setFacilityModal(true)} />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">상호(법인명) *</span>
                      <input className="cd-input text-sm" value={orderer.name} onChange={(e) => setOrderer((p) => ({ ...p, name: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">대표자 — 날인란 표기(수동 입력)</span>
                      <input className="cd-input text-sm" value={orderer.ceo} placeholder="예: 홍길동" onChange={(e) => setOrderer((p) => ({ ...p, ceo: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-[11px] cd-text-faint">주소</span>
                      <input className="cd-input text-sm" value={orderer.address} onChange={(e) => setOrderer((p) => ({ ...p, address: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">사업자등록번호</span>
                      <input className="cd-input text-sm" value={orderer.bizNo} onChange={(e) => setOrderer((p) => ({ ...p, bizNo: e.target.value }))} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] cd-text-faint">전화번호</span>
                      <input className="cd-input text-sm" value={orderer.phone} onChange={(e) => setOrderer((p) => ({ ...p, phone: e.target.value }))} />
                    </label>
                  </div>
                </div>

                {/* 금액·지급 조건 */}
                <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 cd-text-primary" /> 계약금액 · 대금 지급 조건
                    <span className="text-[10.5px] font-normal cd-text-faint">지급 단계는 갑지 문구와 「지급방법」 조문 양쪽에 자동 반영됩니다</span>
                  </h3>
                  {/* 좌: 금액 요약 + 단계 추가 / 우: 지급 단계 탭페이지 (2026-08-11 사용자 요청 — 세로 나열의 공간 낭비 제거) */}
                  <div className="flex flex-col md:flex-row gap-4 items-start">
                    <div className="w-full md:w-[280px] shrink-0 flex flex-col gap-2.5">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">공급가 (VAT 별도) *</span>
                        <AmountInput
                          className="cd-input text-sm text-right"
                          value={amountSupply || ""}
                          onChange={(v) => {
                            const supply = Number(v) || 0;
                            setAmountSupply(supply);
                            setPayments((prev) => distributePayments(supply, prev));
                          }}
                        />
                      </label>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">세액 (10%)</span>
                        <div className="cd-input text-sm text-right opacity-70">{won(amounts.vat)}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] cd-text-faint">합계 (VAT 포함)</span>
                        <div className="cd-input text-sm text-right opacity-70">{won(amounts.total)}</div>
                      </div>
                      {amounts.supply > 0 && <p className="text-[11px] cd-text-faint">{amountLine(amounts.supply)}</p>}
                      <button
                        type="button"
                        className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-[11.5px] cd-text-faint"
                        onClick={() => {
                          setPayments((prev) => [...prev, { label: "잔금", ratio: null, amount: 0, condition: "" }]);
                          setPayTab(payments.length);
                        }}
                      >
                        ＋ 지급 단계 추가
                      </button>
                      {amounts.supply > 0 && payments.reduce((a, p) => a + p.amount, 0) !== amounts.supply && (
                        <p className="text-[11px] text-[color:var(--cd-danger,#FA896B)]">
                          지급 단계 합계 {won(payments.reduce((a, p) => a + p.amount, 0))} ≠ 공급가 {won(amounts.supply)}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 w-full rounded-2xl border cd-border-c p-3.5 flex flex-col gap-3">
                      {/* 단계 탭 — 활성=그라데이션, 비활성=불투명 흰색(업무추진계획 세그먼트 패턴) */}
                      <div className="inline-flex self-start rounded-xl border cd-border-c overflow-hidden text-[12px] font-semibold flex-wrap">
                        {payments.map((p, i) => (
                          <button
                            key={i}
                            type="button"
                            className={`px-3.5 py-2 ${i > 0 ? "border-l cd-border-c" : ""} ${
                              payTab === i ? "cd-fill-primary text-white" : "cd-solid-bg cd-text-muted"
                            }`}
                            onClick={() => setPayTab(i)}
                          >
                            {p.label || `단계 ${i + 1}`}
                            {p.ratio != null ? ` ${p.ratio}%` : ""}
                          </button>
                        ))}
                        {payments.length === 0 && <span className="px-3 py-2 text-[12px] cd-text-faint">좌측 [지급 단계 추가]로 시작하세요.</span>}
                      </div>
                      {payments[Math.min(payTab, payments.length - 1)] && (() => {
                        const i = Math.min(payTab, payments.length - 1);
                        const p = payments[i];
                        return (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] cd-text-faint">단계 명칭</span>
                              <input className="cd-input text-sm" value={p.label} placeholder="착수금" onChange={(e) => setPayments((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))} />
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <label className="flex flex-col gap-1">
                                <span className="text-[11px] cd-text-faint">비율 (%)</span>
                                <input
                                  className="cd-input text-sm text-right"
                                  value={p.ratio != null ? String(p.ratio) : ""}
                                  placeholder="30"
                                  onChange={(e) => {
                                    const ratio = e.target.value === "" ? null : Number(e.target.value) || 0;
                                    setPayments((prev) => distributePayments(amounts.supply, prev.map((x, xi) => (xi === i ? { ...x, ratio } : x))));
                                  }}
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-[11px] cd-text-faint">금액 (원)</span>
                                <AmountInput
                                  className="cd-input text-sm text-right"
                                  value={p.amount || ""}
                                  onChange={(v) => setPayments((prev) => prev.map((x, xi) => (xi === i ? { ...x, ratio: null, amount: Number(v) || 0 } : x)))}
                                />
                              </label>
                            </div>
                            <label className="flex flex-col gap-1 md:col-span-2">
                              <span className="text-[11px] cd-text-faint">지급 시점 문구</span>
                              <input className="cd-input text-sm" value={p.condition} placeholder="예: 계약 완료 후 현금 지급" onChange={(e) => setPayments((prev) => prev.map((x, xi) => (xi === i ? { ...x, condition: e.target.value } : x)))} />
                            </label>
                            <div className="md:col-span-2 flex justify-end">
                              <button
                                type="button"
                                className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] flex items-center gap-1"
                                onClick={() => {
                                  setPayments((prev) => prev.filter((_, xi) => xi !== i));
                                  setPayTab((t) => Math.max(0, Math.min(t, payments.length - 2)));
                                }}
                              >
                                <Trash2 className="w-3 h-3" /> 이 단계 삭제
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {/* 기간·용역범위 */}
                <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
                  <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 cd-text-primary" /> 계약기간 · 용역범위
                  </h3>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">계약기간 문구</span>
                    <input className="cd-input text-sm" value={periodText} onChange={(e) => setPeriodText(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">용역범위(업무범위) — 갑지·「업무범위」 조문에 삽입됩니다</span>
                    <textarea className="cd-input text-[12.5px] min-h-[110px]" value={scopeText} placeholder={"예: 회로정면(S/E) 1기 등 인허가 대상설비 List 시설이 반영된 통합환경관리계획서 작성 및 통합환경 변경허가 취득"} onChange={(e) => setScopeText(e.target.value)} />
                  </label>
                </div>

                {/* 조문 편집 */}
                {hasClausePage && (
                  <div className="cd-card rounded-3xl p-5 flex flex-col gap-2.5">
                    <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                      <ListPlus className="w-4 h-4 cd-text-primary" /> 용역계약 조건 (조문)
                      <span className="text-[10.5px] font-normal cd-text-faint">번호는 순서대로 자동 부여 — 삽입·삭제해도 어긋나지 않습니다</span>
                    </h3>
                    {/* 좌: 조 목록 / 우: 선택 조 편집 — 세로 스크롤 최소화(2026-08-11 사용자 요청) */}
                    <div className="flex flex-col md:flex-row gap-4 items-start">
                      <div className="w-full md:w-[220px] shrink-0 flex flex-col gap-1.5">
                        <div className="flex flex-col gap-1 max-h-[420px] overflow-y-auto pr-1">
                          {clauses.map((c, i) => (
                            <button
                              key={c.id}
                              type="button"
                              className={`rounded-lg px-2.5 py-1.5 text-left text-[12px] border flex items-center gap-1.5 ${
                                clauseTab === i ? "cd-fill-primary text-white border-transparent font-semibold" : "cd-solid-bg cd-border-c cd-text-muted"
                              }`}
                              onClick={() => setClauseTab(i)}
                            >
                              <span className={`font-mono text-[10.5px] shrink-0 ${clauseTab === i ? "opacity-80" : "cd-text-faint"}`}>{i + 1}</span>
                              <span className="truncate">{c.title || "(제목 없음)"}</span>
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11.5px] cd-text-faint"
                          onClick={() => {
                            insertClause(clauses.length - 1);
                            setClauseTab(clauses.length);
                          }}
                        >
                          ＋ 조항 추가
                        </button>
                      </div>

                      <div className="flex-1 min-w-0 w-full rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2">
                        {clauses[Math.min(clauseTab, clauses.length - 1)] && (() => {
                          const i = Math.min(clauseTab, clauses.length - 1);
                          const c = clauses[i];
                          return (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-mono cd-text-faint w-14 shrink-0">제 {i + 1} 조</span>
                                <input className="cd-input text-sm flex-1 font-medium" value={c.title} onChange={(e) => updateClause(i, { title: e.target.value })} />
                                <button type="button" className="cd-text-faint hover:cd-text disabled:opacity-30" disabled={i === 0} title="위로" onClick={() => { moveClause(i, -1); setClauseTab(i - 1); }}>
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button type="button" className="cd-text-faint hover:cd-text disabled:opacity-30" disabled={i === clauses.length - 1} title="아래로" onClick={() => { moveClause(i, 1); setClauseTab(i + 1); }}>
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                                <button type="button" className="cd-text-faint hover:cd-text" title="아래에 조항 삽입" onClick={() => { insertClause(i); setClauseTab(i + 1); }}>
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="삭제" onClick={() => { removeClause(i); setClauseTab(Math.max(0, i - 1)); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {c.binding === "payment" ? (
                                <div className="rounded-lg cd-tint-primary px-3 py-2 text-[11.5px] whitespace-pre-wrap">
                                  {payments.length
                                    ? paymentClauseBody(payments, template?.spec.terms ?? { orderer: "발주자", contractor: "과업수행자" })
                                    : "지급 단계를 입력하면 본문이 자동 생성됩니다."}
                                  <div className="text-[10px] cd-text-faint mt-1">위 「계약금액 · 대금 지급 조건」에서 자동 생성 — 직접 수정하려면 조를 삭제하고 새 조항으로 작성하세요.</div>
                                </div>
                              ) : (
                                <textarea
                                  className="cd-input text-[12px] min-h-[260px] leading-relaxed"
                                  value={c.body}
                                  placeholder="조문 본문 — {{contract.scope}} 같은 토큰은 입력값으로 치환됩니다"
                                  onChange={(e) => updateClause(i, { body: e.target.value })}
                                />
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 우: 결재선 (QuoteBoard 이식) */}
              <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
                <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 cd-text-primary" /> 결재선 (검토)
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
                {line.length === 0 && <p className="text-[12px] cd-text-faint">임원·부서장 등 검토자를 결재선에 추가하세요.</p>}
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
                  <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={openPreview} title="현재 내용을 계약서 PDF 로 미리보기">
                    <FileText className="w-3.5 h-3.5" /> {busy === "preview" ? "생성 중..." : "미리보기"}
                  </button>
                  <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50" disabled={busy != null} onClick={() => send("submit")}>
                    <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
                  </button>
                </div>
                <p className="text-[10.5px] cd-text-faint">
                  승인 완료 후 목록에서 [발주처 발송] 버튼으로 담당자에게 발송합니다(자동 발송 없음). 초안은 기본 HWPX 첨부로 발송됩니다.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* PDF 미리보기 모달 */}
      {previewOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={() => setPreviewOpen(false)}>
          <div className="rounded-2xl cd-solid-bg shadow-2xl w-full max-w-[1100px] h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center px-4 py-2.5 border-b cd-border-c">
              <span className="text-sm font-bold cd-text">계약서 미리보기</span>
              <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={() => setPreviewOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 bg-[color:var(--cd-surface)]">
              {previewUrl ? (
                <iframe title="계약서 미리보기" src={previewUrl} className="w-full h-full" />
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
            onOrdererChange([r]);
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
