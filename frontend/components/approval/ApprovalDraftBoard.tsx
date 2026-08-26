"use client";

// 전자결재 기안 작성 — 양식 렌더러(제어) + 제목/긴급 + 결재선 편집(조직도 선택) + 임시저장/상신.
// 값은 field_key 기반 구조화 저장(field_values). 결재선은 순차 단계 리스트(합의/승인)로 구성한다.
// 설계: docs/e-approval-blueprint.md §5-2.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Paperclip, Send, Save, Trash2, Users, Eye, BookmarkPlus, ShieldCheck, AlertTriangle, Info, Ban, Link2, CreditCard } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { parseTimeRange, timeRangeMinutes, type ApprovalFieldDef } from "@/lib/approval/fields";
import { autofillFromRefDoc, compareWithRefDoc } from "@/lib/approval/ref-link";
import { findInCatalog, type LeaveTypeItem } from "@/lib/approval/leave-types";
import { OvertimeConsentModal } from "@/components/approval/OvertimeConsentModal";
import { DeleteDraftButton, RejectedBanner, toEditDocMeta, type EditDocMeta } from "@/components/approval/DraftEditNotice";
import AttachmentPreviewModal from "@/components/approval/AttachmentPreviewModal";
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_ALLOWED_TEXT, formatBytes, isAllowedAttachment, type DocAttachment,
} from "@/lib/approval/attachments";
import type { OvertimeConsent } from "@/lib/approval/overtime-consent";
import { CardPickerModal, type CardPickerItem } from "@/components/finance/CardPickerModal";
import { ReceiptPickerModal, type ReceiptPickerItem } from "@/components/finance/ReceiptPickerModal";
import "@/components/cdash/cdash.css";

// 카드 내역 자동 기입 대상 양식(P1) — 지출 내역 표(마이그 116)의 key/사용일시 열 key.
// corporate=법인카드(card_transactions)·personal=개인카드 영수증 스톡(personal_receipts) 버튼 노출.
// 지출결의서는 법인/개인 양식이 분리(202)되어 각자 해당 소스만 불러온다(FRM-P1 확정).
// 설계: docs/barobill-finance-blueprint.md §4 F1/F2.
const CARD_EXPENSE_FORMS: Record<string, { tableKey: string; dateKey: string; corporate: boolean; personal: boolean }> = {
  "frm-expense-report": { tableKey: "expenses", dateKey: "used_on", corporate: true, personal: false },
  "frm-expense-personal": { tableKey: "expenses", dateKey: "used_on", corporate: false, personal: true },
  "frm-biz-trip-report": { tableKey: "trip_expenses", dateKey: "spent_on", corporate: true, personal: true },
};

interface FormInfo {
  formId: string;
  name: string;
  fields: ApprovalFieldDef[];
  /** 선행 양식(127) — 지정 시 선행 문서 연결 UI 를 표시한다(예: 출장보고서 → 출장신청). */
  refFormId: string | null;
}

/** 선행 문서 후보/연결 값 — /api/approval/docs?box=ref-candidates 응답 형태. */
interface RefDocInfo {
  docId: string;
  docNo: string | null;
  title: string;
  formId: string;
  formName: string;
  status: string;
  submittedAt: string | null;
  fieldValues: Record<string, unknown>;
}

/** ISO 날짜에 n일 더한 ISO(달력일, 로컬 계산·타임존 무관). */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 두 ISO 날짜 사이 달력일수(양끝 포함, from~to). */
function dayCount(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86400000) + 1;
}

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

/** 조직도 모달이 대상하는 슬롯 — 결재선(합의/승인) 또는 참조/열람. */
type OrgTarget = "agree" | "approve" | "ref" | "view";

interface PrecheckFinding {
  level: "block" | "warn" | "info";
  message: string;
  source: string;
}
interface PrecheckResult {
  findings: PrecheckFinding[];
  similar: { title: string; status: string; reason: string | null; note: string }[];
  llmAvailable: boolean | null;
  llmError?: string | null;
}

export function ApprovalDraftBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const formId = sp.get("formId") ?? "";
  const editDocId = sp.get("docId");

  const [form, setForm] = useState<FormInfo | null>(null);
  const [docId, setDocId] = useState<string | null>(editDocId);
  const [title, setTitle] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [line, setLine] = useState<LineStep[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "submit" | null>(null);
  const [orgModal, setOrgModal] = useState<OrgTarget | null>(null);
  const [presets, setPresets] = useState<LinePreset[]>([]);
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // 재편집 문서의 상태·반려 사유·삭제 권한(서버 판정) — 반려 배너와 기안 삭제 버튼 노출용.
  const [editMeta, setEditMeta] = useState<EditDocMeta | null>(null);
  // 첨부 미리보기(2026-08-25) — 항목을 누르면 상신 전에도 내용을 확인한다(영수증 증빙 등).
  const [previewItem, setPreviewItem] = useState<DocAttachment | null>(null);
  // 첨부서류(문서 공통 — 공문과 같은 field_values.file_attachments 규약).
  // 지출결의·출장보고·교육훈련·휴가처럼 증빙이 필요한 양식에서 쓴다.
  const [fileAttachments, setFileAttachments] = useState<DocAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // 선행 문서 연관(127) — 양식에 선행 양식이 지정된 경우(신청서→보고서)
  const [refDoc, setRefDoc] = useState<RefDocInfo | null>(null);
  const [refCandidates, setRefCandidates] = useState<RefDocInfo[]>([]);
  const [refModal, setRefModal] = useState(false);
  // 선행 양식 필드 스키마 — 자동 완성의 라벨 매칭용(예: service_class↔contract_class '용역분류')
  const [refFormFields, setRefFormFields] = useState<ApprovalFieldDef[]>([]);
  // 휴가신청 양식이면 본인 잔여 연차 배지 + 휴가 종류 카탈로그(기간 자동화)
  const [leaveRemaining, setLeaveRemaining] = useState<{ granted: number; used: number; remaining: number } | null>(null);
  const [leaveCatalog, setLeaveCatalog] = useState<LeaveTypeItem[]>([]);
  const [leaveHint, setLeaveHint] = useState<string | null>(null);
  const isLeaveForm = form?.formId === "frm-leave-request";
  // 결근사유서(FRM-P1) — 내 열린 제출 요청 배너 + 결근 기간 자동 채움.
  const isAbsenceForm = form?.formId === "frm-absence-statement";
  const [absenceRequests, setAbsenceRequests] = useState<
    { requestId: string; dateFrom: string; dateTo: string; note: string | null }[]
  >([]);
  // 초과근무 신청 양식이면 신청 주의 사용량(기존 신청+근태 실적)을 조회해 주 12h 초과를 경고한다.
  const [otUsage, setOtUsage] = useState<{ weekStart: string; weekEnd: string; requestedMinutes: number; attendanceOvertimeMinutes: number; limitMinutes: number } | null>(null);
  const [otHint, setOtHint] = useState<string | null>(null);
  const isOvertimeForm = form?.formId === "frm-overtime-request";
  const otFrom = isOvertimeForm ? ((values.work_period ?? {}) as { from?: string }).from : undefined;
  // 12h 초과 상신 동의(전자서명) — 모달에서 받은 동의는 ref 로 들고 있다가 persist 시 field_values 에 병합한다.
  const [consentModal, setConsentModal] = useState(false);
  const otConsentRef = useRef<OvertimeConsent | null>(null);
  // 법인카드 내역 불러오기(P1) — 지출결의서·출장보고서 한정.
  const [cardPicker, setCardPicker] = useState(false);
  const cardExpenseTarget = form ? CARD_EXPENSE_FORMS[form.formId] : undefined;
  const cardExistingIds = useMemo(() => {
    if (!cardExpenseTarget) return [] as string[];
    const rows = values[cardExpenseTarget.tableKey];
    if (!Array.isArray(rows)) return [] as string[];
    return rows
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>)._cardTxnId : null))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }, [cardExpenseTarget, values]);

  /** 선택된 매입건을 지출 내역 표 행으로 변환해 append(빈 행은 정리). */
  const appendCardRows = useCallback(
    (items: CardPickerItem[]) => {
      if (!cardExpenseTarget) return;
      const { tableKey, dateKey } = cardExpenseTarget;
      setValues((prev) => {
        const current = Array.isArray(prev[tableKey]) ? ([...(prev[tableKey] as unknown[])] as Record<string, unknown>[]) : [];
        const nonEmpty = current.filter((row) =>
          row && typeof row === "object" ? Object.values(row).some((v) => String(v ?? "").trim() !== "") : false,
        );
        const added = items.map((item) => ({
          [dateKey]: item.useDate,
          category: item.formOption ?? "", // 자동 분류 실패 건은 빈 값 → 사용자가 표에서 선택
          vendor: item.storeName ?? "",
          amount: String(item.amountTotal),
          detail: "", // 지출 목적 — 사용자 입력 몫
          _cardTxnId: item.cardTxnId, // 상신 시 서버가 doc_id 귀속·분류 학습에 사용
        }));
        return { ...prev, [tableKey]: [...nonEmpty, ...added] };
      });
    },
    [cardExpenseTarget],
  );

  // 개인카드 영수증 불러오기(accounting-expansion P1) — 법인카드와 같은 표 대상, _receiptId 메타.
  const [receiptPicker, setReceiptPicker] = useState(false);
  const receiptExistingIds = useMemo(() => {
    if (!cardExpenseTarget) return [] as string[];
    const rows = values[cardExpenseTarget.tableKey];
    if (!Array.isArray(rows)) return [] as string[];
    return rows
      .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>)._receiptId : null))
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }, [cardExpenseTarget, values]);

  /** 선택된 영수증을 표 행으로 추가 + 증빙 PDF 를 첨부서류에 자동 추가(결재자 원본 확인용). */
  const appendReceiptRows = useCallback(
    (items: ReceiptPickerItem[]) => {
      if (!cardExpenseTarget) return;
      const { tableKey, dateKey } = cardExpenseTarget;
      setValues((prev) => {
        const current = Array.isArray(prev[tableKey]) ? ([...(prev[tableKey] as unknown[])] as Record<string, unknown>[]) : [];
        const nonEmpty = current.filter((row) =>
          row && typeof row === "object" ? Object.values(row).some((v) => String(v ?? "").trim() !== "") : false,
        );
        const added = items.map((item) => ({
          [dateKey]: item.paidDate ?? "",
          category: item.formOption ?? "",
          vendor: item.storeName ?? "",
          amount: String(item.totalAmount),
          detail: "", // 지출 목적 — 사용자 입력 몫
          _receiptId: item.receiptId, // 상신 시 서버가 doc_id 귀속·분류 학습에 사용
        }));
        return { ...prev, [tableKey]: [...nonEmpty, ...added] };
      });
      // 영수증 PDF 는 이미 스토리지에 있으므로 재업로드 없이 첨부 목록에 key 로 참조(중복 추가 방지).
      setFileAttachments((prev) => {
        const known = new Set(prev.map((a) => a.key));
        const adds = items.filter((i) => !known.has(i.pdfKey)).map((i) => ({ name: i.pdfName, key: i.pdfKey, size: 0 }));
        return adds.length ? [...prev, ...adds] : prev;
      });
    },
    [cardExpenseTarget],
  );

  // 시간 범위(time_range) → 신청시간 자동 계산. 범위가 실제로 바뀔 때만 채우므로
  // 휴게시간 제외 등으로 사용자가 신청시간을 수기 조정하면 그 값이 유지된다.
  // (문서 수정 진입 시의 최초 로드도 덮어쓰지 않는다 — 첫 실행은 기준값만 기록한다.)
  const otRangeKey = isOvertimeForm ? form?.fields.find((f) => f.type === "time_range")?.key : undefined;
  const otRangeValue = otRangeKey ? values[otRangeKey] : undefined;
  const otRangeSigRef = useRef<string | undefined>(undefined);
  /** 직전 휴가 종류 key — 종류가 바뀌었을 때만 기간·일수를 새 규정으로 재설정한다. */
  const prevLeaveTypeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isOvertimeForm || !otRangeKey) return;
    const minutes = timeRangeMinutes(otRangeValue);
    const sig = minutes == null ? "" : String(minutes);
    const first = otRangeSigRef.current === undefined;
    if (otRangeSigRef.current === sig) return;
    otRangeSigRef.current = sig;
    if (first || minutes == null) return;
    const hours = String(Math.round((minutes / 60) * 100) / 100);
    setValues((prev) => (String(prev.apply_hours ?? "") === hours ? prev : { ...prev, apply_hours: hours }));
  }, [isOvertimeForm, otRangeKey, otRangeValue]);

  // 신청 시작일이 속한 주의 사용량 조회(시작일이 바뀔 때만).
  useEffect(() => {
    if (!isOvertimeForm || !otFrom || !/^\d{4}-\d{2}-\d{2}$/.test(otFrom)) {
      setOtUsage(null);
      return;
    }
    let cancelled = false;
    const q = docId ? `&excludeDocId=${encodeURIComponent(docId)}` : "";
    fetch(`/api/approval/overtime/week-usage?date=${otFrom}${q}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setOtUsage(d?.usage ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOvertimeForm, otFrom, docId]);

  // 사용량 + 신청 시간 → 힌트 갱신 + 기사용/잔여시간 자동 채움(수기 수정 가능).
  useEffect(() => {
    if (!isOvertimeForm || !otUsage) {
      setOtHint(null);
      return;
    }
    const fmtH = (min: number) => {
      const h = Math.round((min / 60) * 10) / 10;
      return Number.isInteger(h) ? String(h) : h.toFixed(1);
    };
    // 기사용 = 같은 주의 기존 신청 합과 근태 실적 중 큰 값(신청이 아직 근태에 안 잡힌 미래 주 대응).
    const usedMin = Math.max(otUsage.requestedMinutes, otUsage.attendanceOvertimeMinutes);
    const applyMin = Number(values.apply_hours) > 0 ? Math.round(Number(values.apply_hours) * 60) : 0;
    const remainMin = Math.max(0, otUsage.limitMinutes - usedMin - applyMin);
    const autoUsed = fmtH(usedMin);
    const autoRemain = fmtH(remainMin);
    if (String(values.used_hours ?? "") !== autoUsed || String(values.remain_hours ?? "") !== autoRemain) {
      setValues((prev) => ({ ...prev, used_hours: autoUsed, remain_hours: autoRemain }));
    }
    if (applyMin === 0) {
      setOtHint(`이번 주(${otUsage.weekStart}~) 기사용 ${fmtH(usedMin)}h · 한도 ${fmtH(otUsage.limitMinutes)}h`);
    } else if (usedMin + applyMin > otUsage.limitMinutes) {
      setOtHint(
        `⚠ 주 12시간 초과 — 기사용 ${fmtH(usedMin)}h + 신청 ${fmtH(applyMin)}h = ${fmtH(usedMin + applyMin)}h (한도 ${fmtH(otUsage.limitMinutes)}h). ` +
          `승인 후 실제 근태와 대조해 초과분이 인정되면 특별휴가(대체휴가)로 산정됩니다.`
      );
    } else {
      setOtHint(`이번 주 기사용 ${fmtH(usedMin)}h + 신청 ${fmtH(applyMin)}h · 잔여 ${fmtH(remainMin)}h`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOvertimeForm, otUsage, values.apply_hours, values.used_hours, values.remain_hours]);

  useEffect(() => {
    if (!isLeaveForm) {
      setLeaveRemaining(null);
      setLeaveCatalog([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/approval/leave?me=1&year=${new Date().getFullYear()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.summary) setLeaveRemaining(d.summary);
      })
      .catch(() => {});
    fetch("/api/approval/leave-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.types) setLeaveCatalog(d.types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLeaveForm]);

  // 연차수당(FRM-P5) — 잔여 연차일수 × 1일 통상임금 = 지급 대상액 자동 계산.
  // 직전 자동값과 같을 때만 덮어써 수기 조정을 보존한다(초과근무 신청시간 패턴).
  const leavePayAutoRef = useRef<string | null>(null);
  useEffect(() => {
    if (form?.formId !== "frm-annual-leave-pay") return;
    const days = Number(String(values.remaining_days ?? "").replace(/[^\d.]/g, ""));
    const wage = Number(String(values.daily_wage ?? "").replace(/[^\d]/g, ""));
    if (!days || !wage) return;
    const auto = String(Math.round(days * wage));
    const cur = String(values.total_amount ?? "").replace(/[^\d]/g, "");
    if (cur && cur !== leavePayAutoRef.current && leavePayAutoRef.current != null) return; // 수기 조정 보존
    if (cur === auto) {
      leavePayAutoRef.current = auto;
      return;
    }
    leavePayAutoRef.current = auto;
    setValues((prev) => ({ ...prev, total_amount: auto }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.formId, values.remaining_days, values.daily_wage]);

  // 결근사유서 — 내 열린 제출 요청 조회(202). 새 문서이고 기간이 비어 있으면 첫 요청 기간을 채운다.
  useEffect(() => {
    if (!isAbsenceForm) {
      setAbsenceRequests([]);
      return;
    }
    let cancelled = false;
    fetch("/api/approval/absence-requests?mine=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.requests)) return;
        setAbsenceRequests(d.requests);
        const first = d.requests[0];
        if (first && !editDocId) {
          setValues((prev) => {
            const cur = (prev.absence_period ?? {}) as { from?: string; to?: string };
            if (String(cur.from ?? "").trim()) return prev;
            return { ...prev, absence_period: { from: first.dateFrom, to: first.dateTo } };
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAbsenceForm, editDocId]);

  // 휴가 기간 ↔ 사용일수 ↔ 부여일수 연동(§LM-P2) — 달력일 기준.
  // 부여일수 고정(경조·조의 등): 시작일 입력 → 종료일 자동(days-1 가산)·사용일수=days.
  // 반차: 하루 안에서 쓰므로 종료일=시작일, 사용일수 0.5(서버 차감과 일치).
  // 가변(연차·공가(예비군)·병가): 시작+종료 입력 → 사용일수 자동 카운팅(연차 잔여만 안내).
  // ⚠ 휴가 종류를 바꾸면 이전 종류 기준으로 남아 있던 기간·일수를 새 규정으로 다시 맞춘다
  //   (2026-08-10 사용자 리포트 — 5일 경조에서 연차로 바꿔도 5일 범위가 그대로 남았다).
  useEffect(() => {
    if (!isLeaveForm || leaveCatalog.length === 0) {
      setLeaveHint(null);
      return;
    }
    const item = findInCatalog(leaveCatalog, values.leave_type);
    if (!item) {
      prevLeaveTypeRef.current = null;
      setLeaveHint(null);
      return;
    }
    // 첫 평가(문서 로드·임시저장 이어쓰기)는 변경으로 보지 않는다 — 저장된 값을 지우면 안 된다.
    const typeChanged = prevLeaveTypeRef.current !== null && prevLeaveTypeRef.current !== item.key;
    prevLeaveTypeRef.current = item.key;

    const period = (values.leave_period ?? {}) as { from?: string; to?: string };
    const from = period.from;
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setLeaveHint(item.days != null ? `${item.label} — 부여 ${item.days}일 (시작일을 입력하면 종료일이 자동 설정됩니다)` : null);
      return;
    }
    if (item.deduct === "half") {
      // 반차: 종료일=시작일 고정, 사용일수 0.5
      if (period.to !== from || String(values.use_days ?? "") !== "0.5") {
        setValues((prev) => ({ ...prev, leave_period: { from, to: from }, use_days: "0.5" }));
      }
      setLeaveHint(`${item.label} — 0.5일 차감(하루 안에서 사용)`);
    } else if (item.days != null) {
      // 고정 부여일수: 종료일·사용일수 자동(상한 강제)
      const to = addDays(from, item.days - 1);
      const changed = to !== period.to || String(values.use_days ?? "") !== String(item.days);
      if (changed) setValues((prev) => ({ ...prev, leave_period: { from, to }, use_days: String(item.days) }));
      setLeaveHint(`${item.label} — 부여 ${item.days}일 · 종료일 자동 설정(${to})`);
    } else if (typeChanged) {
      // 고정·반차 → 가변 전환: 이전 종료일이 남지 않게 하루로 초기화하고 사용자가 다시 지정한다.
      setValues((prev) => ({ ...prev, leave_period: { from, to: from }, use_days: "1" }));
      setLeaveHint(`${item.label} — 종료일을 지정하면 사용일수가 계산됩니다`);
    } else {
      // 가변: 종료일이 있으면 사용일수 카운팅
      if (period.to && /^\d{4}-\d{2}-\d{2}$/.test(period.to)) {
        const cnt = dayCount(from, period.to);
        if (cnt <= 0) {
          setLeaveHint("종료일이 시작일보다 빠릅니다.");
          return;
        }
        if (String(values.use_days ?? "") !== String(cnt)) setValues((prev) => ({ ...prev, use_days: String(cnt) }));
        const over =
          item.deduct && leaveRemaining && cnt > leaveRemaining.remaining
            ? ` · ⚠ 잔여 연차(${leaveRemaining.remaining}일) 초과`
            : "";
        setLeaveHint(`사용 ${cnt}일${over}`);
      } else {
        setLeaveHint(`${item.label} — 시작·종료일을 입력하면 사용일수가 계산됩니다`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeaveForm, leaveCatalog, values.leave_type, values.leave_period, leaveRemaining]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (editDocId) {
          const res = await fetch(`/api/approval/docs/${encodeURIComponent(editDocId)}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
          if (cancelled) return;
          const d = data.doc;
          setEditMeta(toEditDocMeta(d));
          setForm({ formId: d.formId, name: d.formName, fields: d.fields, refFormId: d.formRefFormId ?? null });
          setTitle(d.title ?? "");
          setUrgent(!!d.urgent);
          setValues(d.fieldValues ?? {});
          setFileAttachments(Array.isArray(d.fieldValues?.file_attachments) ? d.fieldValues.file_attachments : []);
          if (d.refDoc) setRefDoc(d.refDoc as RefDocInfo);
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
        } else {
          if (!formId) throw new Error("양식이 지정되지 않았습니다. 전자결재 홈에서 '새 기안'으로 진입하세요.");
          const res = await fetch(`/api/approval/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error ?? "양식을 불러오지 못했습니다.");
          if (cancelled) return;
          setForm({ formId: data.form.formId, name: data.form.name, fields: data.form.fields, refFormId: data.form.refFormId ?? null });
          setTitle(data.form.name);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId, editDocId]);

  // 선행 문서 후보 + 선행 양식 스키마(자동 완성 라벨 매칭용) 로드
  useEffect(() => {
    const refFormId = form?.refFormId;
    if (!refFormId) {
      setRefCandidates([]);
      setRefFormFields([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/approval/docs?box=ref-candidates&formId=${encodeURIComponent(refFormId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.docs)) setRefCandidates(d.docs);
      })
      .catch(() => {});
    fetch(`/api/approval/forms/${encodeURIComponent(refFormId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.form?.fields)) setRefFormFields(d.form.fields);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [form?.refFormId]);

  // 선행 문서 불일치 검사 — 선택 시점 + 이후 입력 시점 모두 재계산되는 상시 배너(업체명·방문일시·계약명)
  const refMismatches = useMemo(() => {
    if (!form || !refDoc) return [];
    return compareWithRefDoc(form.fields, values, refDoc.fieldValues);
  }, [form, refDoc, values]);

  const pickRefDoc = (c: RefDocInfo) => {
    setRefDoc(c);
    setRefModal(false);
    if (!form) return;
    // 자동 완성 — 선행 문서와 겹치는 요소(같은 key·같은 라벨·업체/계약)를 선행 값으로 채운다.
    // 이미 입력된 필드는 덮지 않는다(다르면 아래 불일치 경고가 알림).
    const { next, filledLabels } = autofillFromRefDoc(form.fields, values, c.fieldValues, refFormFields);
    if (filledLabels.length) setValues(next);
    // 선택 시점 즉시 경고 — 자동 완성 후에도 남는 불일치(기존 입력 값)를 바로 알린다.
    const miss = compareWithRefDoc(form.fields, next, c.fieldValues);
    const parts: string[] = [];
    if (filledLabels.length) parts.push(`선행 문서에서 자동 입력된 항목: ${filledLabels.join(", ")}`);
    if (miss.length) {
      parts.push(
        `입력 값이 선행 문서와 일치하지 않습니다:\n${miss
          .map((m) => `· ${m.label} — 선행: ${m.refText} / 현재: ${m.curText}`)
          .join("\n")}\n연결은 유지됩니다. 값을 확인하세요.`
      );
    }
    if (parts.length) alert(parts.join("\n\n"));
  };

  // 결재선 프리셋 목록 로드
  useEffect(() => {
    let cancelled = false;
    fetch("/api/approval/line-presets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.presets)) setPresets(d.presets);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openOrgModal = (target: OrgTarget) => setOrgModal(target);

  const applyPreset = (p: LinePreset) => {
    setLine(
      p.steps.map((s) => ({
        stepType: s.stepType === "agree" ? "agree" : "approve",
        assigneeUserId: s.assigneeUserId,
        assigneeName: s.assigneeName ?? "",
        assigneePosition: s.assigneePosition,
      }))
    );
    setWatchers(p.watchers.map((w) => ({ userId: w.userId, name: w.name ?? "", kind: w.kind === "view" ? "view" : "ref" })));
  };

  const saveAsPreset = async () => {
    if (line.length === 0) {
      alert("저장할 결재선이 없습니다.");
      return;
    }
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
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "프리셋 저장 실패");
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

  // 저장/상신 공용 POST — action 별 body 구성. 저장은 docId 반환.
  // docIdOverride: save 직후 같은 턴에서 submit 할 때 — setDocId 는 비동기라 클로저의
  // docId 가 stale 이어서 새 문서가 하나 더 생기는 버그 방지(공문 보드 실사고와 동일 패턴).
  const persist = useCallback(
    async (action: "save" | "submit", docIdOverride?: string): Promise<{ docId: string; docNo?: string | null }> => {
      if (!form) throw new Error("양식이 없습니다.");
      const res = await fetch("/api/approval/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          docId: docIdOverride ?? docId,
          formId: form.formId,
          title,
          urgent,
          // 12h 초과 동의(전자서명)는 모달에서 ref 로 받으므로 여기서 병합한다(상신 시 서버가 유효성 강제).
          // 첨부는 양식 필드가 아니라 문서 공통 항목이라 field_values 에 같은 키로 싣는다(공문과 동일 규약).
          fieldValues: {
            ...values,
            ...(otConsentRef.current ? { _overtime_consent: otConsentRef.current } : {}),
            ...(fileAttachments.length ? { file_attachments: fileAttachments } : {}),
          },
          line,
          watchers: watchers.map((w) => ({ userId: w.userId, kind: w.kind })),
          refDocId: refDoc?.docId ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setDocId(data.docId);
      return { docId: data.docId, docNo: data.docNo };
    },
    [form, docId, title, urgent, values, fileAttachments, line, watchers, refDoc]
  );

  /** 첨부 업로드 — DnD/파일 선택 공용. 결재자가 뷰어에서 열 수 있는 형식만 받는다. */
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const rejected = list.filter((f) => !isAllowedAttachment(f.name));
    if (rejected.length) {
      alert(`첨부할 수 없는 형식입니다 — ${rejected.map((f) => f.name).join(", ")}\n허용 형식: ${ATTACHMENT_ALLOWED_TEXT}`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of list) fd.append("files", f);
      const res = await fetch("/api/approval/attachments", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "첨부 업로드 실패");
      setFileAttachments((prev) => [...prev, ...((data as { items?: DocAttachment[] }).items ?? [])]);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }, []);

  const validateForSubmit = useCallback((): boolean => {
    if (!form) return false;
    const missing = form.fields
      .filter((f) => f.required && f.type !== "static")
      .filter((f) => {
        const v = values[f.key];
        if (v == null) return true;
        // 시간 범위는 한쪽만 있으면 소요 시간을 알 수 없어 미입력으로 본다.
        if (f.type === "time_range") {
          const r = parseTimeRange(v);
          return !r.start || !r.end;
        }
        if (typeof v === "string") return !v.trim();
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === "object") return Object.values(v as Record<string, unknown>).every((x) => !String(x ?? "").trim());
        return false;
      });
    if (missing.length) {
      alert(`필수 항목을 입력하세요: ${missing.map((f) => f.label).join(", ")}`);
      return false;
    }
    if (line.length === 0) {
      alert("결재선에 결재자를 1명 이상 추가하세요.");
      return false;
    }
    return true;
  }, [form, values, line]);

  const send = useCallback(
    async (action: "save" | "submit") => {
      if (!form) return;
      if (action === "submit" && !validateForSubmit()) return;
      // 초과근무 신청 — 주 12h 초과면 특별휴가 전환 동의(전자서명) 없이는 상신을 열지 않는다(서버도 강제).
      if (action === "submit" && isOvertimeForm && otUsage) {
        const usedMin = Math.max(otUsage.requestedMinutes, otUsage.attendanceOvertimeMinutes);
        const applyMin = Number(values.apply_hours) > 0 ? Math.round(Number(values.apply_hours) * 60) : 0;
        const over = usedMin + applyMin > otUsage.limitMinutes;
        // 이 주에 대한 유효한 동의가 이미 있는가(모달에서 받은 것 or 편집 재진입 시 문서에 남은 것).
        const saved = (values._overtime_consent ?? null) as OvertimeConsent | null;
        const hasConsent =
          otConsentRef.current?.weekStart === otUsage.weekStart ||
          (saved && typeof saved === "object" && saved.weekStart === otUsage.weekStart);
        if (over && !hasConsent) {
          setConsentModal(true);
          return;
        }
      }
      // 선행 문서 미연결 안내(비차단) — 연관 가능한 선행 문서가 있는데 연결하지 않은 채 상신하는 경우
      if (action === "submit" && form.refFormId && !refDoc && refCandidates.length > 0) {
        const label = refCandidates[0].formName;
        if (
          !window.confirm(
            `연관 가능한 선행 문서(${label}) ${refCandidates.length}건이 있습니다.\n연결하지 않고 상신하시겠습니까?\n(취소를 누르면 상단 '선행 문서 선택'으로 연결할 수 있습니다)`
          )
        ) {
          return;
        }
      }
      // 불일치 경고(비차단) — 연결된 선행 문서와 입력 값이 다르면 상신 전 마지막으로 확인
      if (action === "submit" && refDoc && refMismatches.length > 0) {
        if (
          !window.confirm(
            `연결된 선행 문서와 입력 값이 일치하지 않습니다:\n${refMismatches
              .map((m) => `· ${m.label} — 선행: ${m.refText} / 현재: ${m.curText}`)
              .join("\n")}\n그래도 상신하시겠습니까?`
          )
        ) {
          return;
        }
      }
      setBusy(action);
      try {
        const saved = await persist("save");
        if (action === "save") return;
        // 상신 전 규칙 사전검토(항상 자동)
        const preRes = await fetch(`/api/approval/docs/${encodeURIComponent(saved.docId)}/precheck`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ llm: false }),
        });
        const pre = (await preRes.json().catch(() => ({}))) as PrecheckResult;
        const findings = Array.isArray(pre.findings) ? pre.findings : [];
        setPrecheck({ findings, similar: [], llmAvailable: null });
        const blocks = findings.filter((f) => f.level === "block");
        if (blocks.length) {
          alert(`상신할 수 없습니다:\n${blocks.map((b) => `· ${b.message}`).join("\n")}`);
          return;
        }
        const warns = findings.filter((f) => f.level === "warn");
        if (warns.length && !window.confirm(`아래 경고가 있습니다. 그래도 상신하시겠습니까?\n${warns.map((w) => `· ${w.message}`).join("\n")}`)) {
          return;
        }
        const done = await persist("submit", saved.docId);
        alert(`상신되었습니다. 문서번호: ${done.docNo}`);
        router.push("/approval");
      } catch (err) {
        alert((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [form, validateForSubmit, persist, router, refDoc, refCandidates, refMismatches, isOvertimeForm, otUsage, values]
  );

  // AI 검토(수동, 비용 통제) — 저장 후 LLM 사전검토+유사 문서.
  const aiReview = useCallback(async () => {
    if (!form) return;
    setAiBusy(true);
    try {
      const saved = await persist("save");
      const res = await fetch(`/api/approval/docs/${encodeURIComponent(saved.docId)}/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as PrecheckResult;
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "AI 검토 실패");
      setPrecheck({
        findings: Array.isArray(data.findings) ? data.findings : [],
        similar: Array.isArray(data.similar) ? data.similar : [],
        llmAvailable: data.llmAvailable ?? null,
        llmError: data.llmError ?? null,
      });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAiBusy(false);
    }
  }, [form, persist]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        eyebrow="Approval · Draft"
        title={form ? `기안 작성 — ${form.name}` : "기안 작성"}
        subtitle="입력 값은 항목별 데이터로 저장되어 결재 완료 후 분류·집계에 활용됩니다."
        actions={
          <div className="flex items-center gap-2">
            <DeleteDraftButton docId={docId} meta={editMeta} />
            <Link href="/approval" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> 전자결재 홈
            </Link>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : error ? (
        <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>
      ) : form ? (
        <>
        <div className="max-w-[1032px]">
          <RejectedBanner meta={editMeta} />
        </div>
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          {/* 본문 카드는 렌더러 고정폭(273mm ≈ 1032px)에 맞춘다 — 공문·견적서 작성 화면과 동일 규칙.
              제한이 없으면 넓은 화면에서 양식 좌우로 빈 여백만 커진다. */}
          <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 max-w-[1032px] flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-[11px] cd-text-faint flex flex-col gap-1 flex-1 min-w-[260px]">
                제목
                <input className="cd-input" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="flex items-center gap-1.5 text-[12px] cd-text cursor-pointer mt-4">
                <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> 긴급
              </label>
              {leaveRemaining && (
                <span className="mt-4 text-[11.5px] rounded-full px-2.5 py-1 cd-tint-primary" title={`부여 ${leaveRemaining.granted} · 사용 ${leaveRemaining.used}`}>
                  올해 잔여 연차 {leaveRemaining.remaining}일
                </span>
              )}
              {leaveHint && (
                <span
                  className={`mt-4 text-[11.5px] rounded-full px-2.5 py-1 ${
                    leaveHint.includes("⚠") || leaveHint.includes("빠릅니다")
                      ? "border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
                      : "border border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
                  }`}
                >
                  {leaveHint}
                </span>
              )}
              {otHint && (
                <span
                  className={`mt-4 text-[11.5px] rounded-full px-2.5 py-1 ${
                    otHint.includes("⚠")
                      ? "border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
                      : "border border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
                  }`}
                >
                  {otHint}
                </span>
              )}
            </div>
            {/* 선행 문서 연결(127) — 신청서→보고서 연관. 배너는 렌더러 위에 상시 표시된다. */}
            {form.refFormId && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 flex flex-col gap-1.5 ${refDoc ? "cd-border-c" : "border-dashed cd-border-c"}`}
                style={refDoc && refMismatches.length > 0 ? { borderColor: "var(--cd-warning,#FFAE1F)" } : undefined}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Link2 className="w-4 h-4 cd-text-primary shrink-0" />
                  {refDoc ? (
                    <>
                      <span className="text-[12.5px] cd-text">
                        선행 문서: <b>{refDoc.docNo ? `${refDoc.docNo} · ` : ""}{refDoc.title}</b>
                      </span>
                      <span className="text-[10.5px] cd-text-faint">
                        {refDoc.formName} · {refDoc.status === "approved" ? "승인 완료" : "결재 진행 중"}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5">
                        <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px]" onClick={() => setRefModal(true)}>
                          변경
                        </button>
                        <button
                          type="button"
                          className="cd-btn rounded-lg border cd-border-c px-2.5 py-1 text-[11px] cd-text-faint"
                          onClick={() => setRefDoc(null)}
                        >
                          연결 해제
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-[12.5px] cd-text">선행 문서 미연결</span>
                      {refCandidates.length > 0 && (
                        <span className="text-[11.5px]" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
                          최근 기안한 {refCandidates[0].formName} {refCandidates.length}건이 있습니다 — 해당 건이면 연결하세요.
                        </span>
                      )}
                      <button
                        type="button"
                        className="ml-auto cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-[11.5px] flex items-center gap-1.5"
                        onClick={() => setRefModal(true)}
                      >
                        <Link2 className="w-3.5 h-3.5" /> 선행 문서 선택
                      </button>
                    </>
                  )}
                </div>
                {refDoc && refMismatches.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {refMismatches.map((m, i) => (
                      <p key={i} className="text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        {m.label} 불일치 — 선행 문서: {m.refText} / 현재 입력: {m.curText}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* 결근사유서 제출 요청 배너(FRM-P1) — 요청 기간·메모 안내, 클릭으로 기간 채움 */}
            {isAbsenceForm && absenceRequests.length > 0 && (
              <div className="rounded-lg border cd-border-c cd-tint-primary px-3 py-2 flex flex-col gap-1">
                {absenceRequests.map((r) => (
                  <button
                    key={r.requestId}
                    type="button"
                    className="text-left text-[12px] cd-text flex items-center gap-2 flex-wrap"
                    title="클릭하면 결근 기간이 입력됩니다"
                    onClick={() => setValues((prev) => ({ ...prev, absence_period: { from: r.dateFrom, to: r.dateTo } }))}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cd-warning,#FFAE1F)" }} />
                    결근사유서 제출 요청 — {r.dateFrom}
                    {r.dateTo !== r.dateFrom ? ` ~ ${r.dateTo}` : ""}
                    {r.note ? <span className="cd-text-faint">({r.note})</span> : null}
                  </button>
                ))}
              </div>
            )}
            {/* 법인카드 내역·개인카드 영수증 불러오기(P1) — 지출 내역 표 자동 기입, 사용자는 지출 목적만 입력 */}
            {cardExpenseTarget && (
              <div className="flex items-center gap-2 flex-wrap">
                {cardExpenseTarget.corporate && (
                  <button
                    type="button"
                    className="cd-btn cd-btn-soft cd-btn-sm"
                    onClick={() => setCardPicker(true)}
                  >
                    <CreditCard className="w-3.5 h-3.5" /> 법인카드 내역 불러오기
                  </button>
                )}
                {cardExpenseTarget.personal && (
                  <button
                    type="button"
                    className="cd-btn cd-btn-soft cd-btn-sm"
                    onClick={() => setReceiptPicker(true)}
                  >
                    <CreditCard className="w-3.5 h-3.5" /> 개인카드 영수증 불러오기
                  </button>
                )}
                <span className="text-[11px] cd-text-faint">
                  선택하면 사용일시·상호·금액·분류가 자동 기입됩니다 — 지출 목적만 입력하세요
                </span>
              </div>
            )}
            <ApprovalFormRenderer
              fields={form.fields}
              values={values}
              onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
              // 기안 단계에서도 완성 문서와 같은 양식 제목을 보여준다(신청/승인란은 상신 후).
              header={{ formName: form.name }}
            />

            {/* 첨부서류 — 영수증·증빙 등. 결재자는 문서 뷰어의 [첨부서류] 탭에서 내용을 확인한다. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] cd-text-faint">
                첨부서류 — 결재자가 뷰어에서 열 수 있는 형식만 첨부할 수 있습니다 ({ATTACHMENT_ALLOWED_TEXT} · 1건 200MB 까지)
              </span>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <label
                  className={`rounded-xl border-2 border-dashed px-4 py-6 flex flex-col items-center justify-center gap-1.5 cursor-pointer text-center ${
                    dragOver ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  <Paperclip className="w-5 h-5 cd-text-faint" />
                  <span className="text-[12px] cd-text">{uploading ? "업로드 중..." : "파일을 끌어다 놓거나 클릭해 선택"}</span>
                  <span className="text-[10.5px] cd-text-faint">영수증·증빙·참고자료</span>
                  <input
                    type="file"
                    multiple
                    accept={ATTACHMENT_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="rounded-xl border cd-border-c p-2.5 min-h-[104px] flex flex-col gap-1 overflow-auto">
                  {fileAttachments.length === 0 ? (
                    <p className="text-[11.5px] cd-text-faint m-auto">첨부된 파일이 없습니다.</p>
                  ) : (
                    fileAttachments.map((f, i) => (
                      <div key={f.key} className="flex items-center gap-2 rounded-lg border cd-border-c px-2.5 py-1.5">
                        <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                        <button
                          type="button"
                          className="text-[12px] cd-text truncate flex-1 text-left hover:underline"
                          title={`${f.name} — 클릭해 미리보기`}
                          onClick={() => setPreviewItem(f)}
                        >
                          {f.name}
                        </button>
                        <span className="text-[10.5px] cd-text-faint shrink-0">{formatBytes(f.size)}</span>
                        <button
                          type="button"
                          className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                          title="첨부 제거"
                          onClick={() => setFileAttachments((prev) => prev.filter((_, xi) => xi !== i))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 결재선 */}
          <div className="cd-card rounded-3xl p-5 w-full xl:w-[320px] shrink-0 flex flex-col gap-3">
            <h3 className="font-bold cd-text text-sm flex items-center gap-2">
              <Users className="w-4 h-4 cd-text-primary" /> 결재선
              <span className="ml-auto text-[11px] font-normal cd-text-faint">기안 → 위에서 아래 순서</span>
            </h3>

            {/* 나의 결재선 프리셋 */}
            {presets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10.5px] cd-text-faint mr-0.5">불러오기</span>
                {presets.map((p) => (
                  <span key={p.presetId} className="inline-flex items-center rounded-full border cd-border-c overflow-hidden">
                    <button type="button" className="text-[11px] px-2 py-0.5 hover:cd-tint-primary" onClick={() => applyPreset(p)} title="이 결재선 불러오기">
                      {p.name}
                    </button>
                    <button type="button" className="text-[10px] px-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => deletePreset(p.presetId)} title="프리셋 삭제">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {line.length === 0 && <p className="text-[12px] cd-text-faint">아래 버튼으로 합의/승인 결재자를 추가하세요.</p>}
            <div className="flex flex-col gap-1.5">
              {line.map((s, i) => (
                <div key={`${s.assigneeUserId}-${i}`} className="rounded-xl border cd-border-c px-3 py-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono cd-text-faint w-4">{i + 1}</span>
                  <select
                    className="cd-select"
                    style={{ width: 70 }}
                    value={s.stepType}
                    onChange={(e) =>
                      setLine((prev) => prev.map((x, xi) => (xi === i ? { ...x, stepType: e.target.value as "agree" | "approve" } : x)))
                    }
                  >
                    <option value="agree">합의</option>
                    <option value="approve">승인</option>
                  </select>
                  <span className="text-[12.5px] cd-text truncate flex-1">
                    {s.assigneeName}
                    {s.assigneePosition ? <span className="cd-text-faint text-[11px]"> {s.assigneePosition}</span> : null}
                  </span>
                  <button
                    type="button"
                    className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                    title="제거"
                    onClick={() => setLine((prev) => prev.filter((_, xi) => xi !== i))}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-2 text-xs cd-text-faint flex-1" onClick={() => openOrgModal("approve")}>
                ＋ 결재자 추가
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-2.5 py-2 text-[11px] cd-text-faint flex items-center gap-1"
                onClick={saveAsPreset}
                title="현재 결재선·참조자를 프리셋으로 저장"
              >
                <BookmarkPlus className="w-3.5 h-3.5" /> 프리셋 저장
              </button>
            </div>
            <p className="text-[10.5px] cd-text-faint">
              결재자가 승인된 휴가 기간 중이면 지정된 대결자에게 자동 위임됩니다(대결 표기).
            </p>

            {/* 참조/열람자 */}
            <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
              <h4 className="font-bold cd-text text-[12.5px] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 cd-text-primary" /> 참조 · 열람
                <span className="ml-auto text-[10px] font-normal cd-text-faint">참조=완료 통보 · 열람=진행 중 열람</span>
              </h4>
              {watchers.length === 0 ? (
                <p className="text-[11px] cd-text-faint">필요 시 참조/열람자를 지정하세요(선택).</p>
              ) : (
                watchers.map((w, i) => (
                  <div key={`${w.userId}-${i}`} className="rounded-xl border cd-border-c px-3 py-1.5 flex items-center gap-2">
                    <select
                      className="cd-select"
                      style={{ width: 66 }}
                      value={w.kind}
                      onChange={(e) => setWatchers((prev) => prev.map((x, xi) => (xi === i ? { ...x, kind: e.target.value as "ref" | "view" } : x)))}
                    >
                      <option value="ref">참조</option>
                      <option value="view">열람</option>
                    </select>
                    <span className="text-[12px] cd-text truncate flex-1">{w.name}</span>
                    <button
                      type="button"
                      className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                      title="제거"
                      onClick={() => setWatchers((prev) => prev.filter((_, xi) => xi !== i))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
              <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint" onClick={() => openOrgModal("ref")}>
                ＋ 참조/열람자 추가
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("save")}
              >
                <Save className="w-3.5 h-3.5" /> {busy === "save" ? "저장 중..." : "임시저장"}
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null || aiBusy}
                onClick={aiReview}
                title="AI 사전검토 + 유사 과거 문서(수동)"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> {aiBusy ? "검토 중..." : "AI 검토"}
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                disabled={busy != null}
                onClick={() => send("submit")}
              >
                <Send className="w-3.5 h-3.5" /> {busy === "submit" ? "상신 중..." : "상신"}
              </button>
            </div>
          </div>
        </div>

        {/* 사전검토 결과 패널 */}
        {precheck && (
          <div className="cd-card rounded-3xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <h3 className="font-bold cd-text text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 cd-text-primary" /> 사전검토 결과
              </h3>
              {precheck.llmAvailable === false && (
                <span className="text-[11px] cd-text-faint">AI 검토 미설정 — 규칙 검사만 표시</span>
              )}
              <button type="button" className="ml-auto cd-btn cd-btn-soft text-[11px]" onClick={() => setPrecheck(null)}>
                닫기
              </button>
            </div>
            {precheck.findings.length === 0 && precheck.similar.length === 0 ? (
              <p className="text-[12.5px] cd-text-faint">지적 사항이 없습니다.</p>
            ) : (
              <>
                {precheck.findings.map((f, i) => {
                  const isBlock = f.level === "block";
                  const isWarn = f.level === "warn";
                  const color = isBlock
                    ? "var(--cd-danger,#FA896B)"
                    : isWarn
                      ? "var(--cd-warning,#FFAE1F)"
                      : "var(--cd-primary)";
                  const Icon = isBlock ? Ban : isWarn ? AlertTriangle : Info;
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-xl border cd-border-c px-3 py-2" style={{ borderColor: color }}>
                      <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color }} />
                      <div className="flex flex-col">
                        <span className="text-[12.5px] cd-text">{f.message}</span>
                        <span className="text-[10px] cd-text-faint">
                          {isBlock ? "차단" : isWarn ? "경고" : "참고"} · {f.source}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {precheck.similar.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    <span className="text-[11px] font-bold cd-text-faint">유사 과거 문서</span>
                    {precheck.similar.map((s, i) => (
                      <div key={i} className="rounded-xl border cd-border-c px-3 py-2">
                        <p className="text-[12px] cd-text">
                          <span
                            className="text-[10px] font-bold mr-1.5"
                            style={{ color: s.status === "rejected" ? "var(--cd-danger,#FA896B)" : "var(--cd-success,#13DEB9)" }}
                          >
                            {s.status === "rejected" ? "반려" : "승인"}
                          </span>
                          {s.title}
                        </p>
                        {s.reason && <p className="text-[11px] cd-text-faint">반려사유: {s.reason}</p>}
                        {s.note && <p className="text-[11px] cd-text-faint">※ {s.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {precheck.llmError && <p className="text-[11px] cd-text-faint">{precheck.llmError}</p>}
            <p className="text-[10.5px] cd-text-faint">
              AI·규칙 검토는 참고용입니다. 차단 항목 외에는 상신을 강제하지 않습니다(최종 판단은 기안자).
            </p>
          </div>
        )}
        </>
      ) : null}

      {/* 선행 문서 선택 모달(127) — 내가 기안한 선행 양식 문서 목록에서 선택 */}
      <CdModal open={refModal} onClose={() => setRefModal(false)} title="선행 문서 선택 — 최근 기안한 문서" size="md">
        <div className="flex flex-col gap-1.5">
          {refCandidates.length === 0 ? (
            <p className="text-[12.5px] cd-text-faint py-6 text-center">
              연결할 수 있는 선행 문서가 없습니다.
              <br />
              선행 문서(신청서)를 먼저 기안·상신한 뒤 보고서를 작성하세요.
            </p>
          ) : (
            refCandidates.map((c) => (
              <button
                key={c.docId}
                type="button"
                className={`text-left rounded-xl border px-3.5 py-2.5 flex items-center gap-2.5 ${
                  refDoc?.docId === c.docId ? "cd-tint-primary border-transparent" : "cd-border-c hover:bg-[color:var(--cd-surface)]"
                }`}
                onClick={() => pickRefDoc(c)}
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[12.5px] cd-text truncate">
                    {c.docNo ? <span className="font-mono text-[11px] cd-text-faint mr-1.5">{c.docNo}</span> : null}
                    {c.title}
                  </span>
                  <span className="text-[10.5px] cd-text-faint">
                    {c.formName}
                    {c.submittedAt ? ` · 상신 ${c.submittedAt.slice(0, 10)}` : ""}
                  </span>
                </div>
                <span
                  className={`text-[10.5px] rounded-full px-2 py-0.5 shrink-0 ${
                    c.status === "approved"
                      ? "border border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
                      : "border cd-border-c cd-text-faint"
                  }`}
                >
                  {c.status === "approved" ? "승인" : "진행 중"}
                </span>
              </button>
            ))
          )}
          <p className="text-[10px] cd-text-faint mt-1">
            선택하면 이 문서와 연관 관계가 설정됩니다. 업체명·방문일시·계약명이 입력 값과 다르면 경고가 표시됩니다.
          </p>
        </div>
      </CdModal>

      {/* 주 12h 초과 — 특별휴가 전환 동의(전자서명) 모달. 동의 즉시 상신을 이어간다. */}
      {otUsage && (
        <OvertimeConsentModal
          open={consentModal}
          weekStart={otUsage.weekStart}
          weekEnd={otUsage.weekEnd}
          totalMinutes={
            Math.max(otUsage.requestedMinutes, otUsage.attendanceOvertimeMinutes) +
            (Number(values.apply_hours) > 0 ? Math.round(Number(values.apply_hours) * 60) : 0)
          }
          excessMinutes={Math.max(
            0,
            Math.max(otUsage.requestedMinutes, otUsage.attendanceOvertimeMinutes) +
              (Number(values.apply_hours) > 0 ? Math.round(Number(values.apply_hours) * 60) : 0) -
              otUsage.limitMinutes
          )}
          limitMinutes={otUsage.limitMinutes}
          onClose={() => setConsentModal(false)}
          onAgree={(consent) => {
            otConsentRef.current = consent;
            setConsentModal(false);
            void send("submit");
          }}
        />
      )}

      {/* 법인카드 내역 불러오기 모달(P1) — 지출결의서(법인)·출장보고서 한정 */}
      {cardExpenseTarget?.corporate && form && (
        <CardPickerModal
          open={cardPicker}
          onClose={() => setCardPicker(false)}
          formId={form.formId}
          existingIds={cardExistingIds}
          onPick={appendCardRows}
        />
      )}

      {/* 개인카드 영수증 불러오기 모달(accounting-expansion P1) — 지출결의서(개인)·출장보고서 한정 */}
      {cardExpenseTarget?.personal && form && (
        <ReceiptPickerModal
          open={receiptPicker}
          onClose={() => setReceiptPicker(false)}
          formId={form.formId}
          existingIds={receiptExistingIds}
          onPick={appendReceiptRows}
        />
      )}

      {/* 첨부 미리보기 모달(2026-08-25) — 상신 전 첨부 내용 확인 */}
      {previewItem && <AttachmentPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />}

      {/* 조직도 선택 모달(공용, G3) */}
      <OrgPickerModal
        open={orgModal != null}
        title={orgModal === "ref" || orgModal === "view" ? "참조/열람자 추가 — 조직도에서 선택" : "결재자 추가 — 조직도에서 선택"}
        hint={
          orgModal === "ref" || orgModal === "view"
            ? "인원을 클릭하면 참조/열람자로 추가됩니다. 참조=완료 통보, 열람=진행 중 열람."
            : "인원을 클릭하면 결재선 맨 뒤에 추가됩니다. 타입(합의/승인)은 목록에서 변경하세요."
        }
        onClose={() => setOrgModal(null)}
        onSelect={(emp) => {
          if (!orgModal) return;
          if (!emp.userId) {
            alert(`${emp.name} 님은 아직 계정이 연결되지 않아 지정할 수 없습니다.`);
            return;
          }
          const userId = emp.userId;
          if (orgModal === "ref" || orgModal === "view") {
            const kind = orgModal;
            setWatchers((prev) =>
              prev.some((w) => w.userId === userId) ? prev : [...prev, { userId, name: emp.name, kind }]
            );
          } else {
            const stepType = orgModal;
            setLine((prev) =>
              prev.some((s) => s.assigneeUserId === userId)
                ? prev
                : [...prev, { stepType, assigneeUserId: userId, assigneeName: emp.name, assigneePosition: emp.positionName }]
            );
          }
        }}
      />
    </div>
  );
}
