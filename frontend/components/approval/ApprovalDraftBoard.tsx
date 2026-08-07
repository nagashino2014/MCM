"use client";

// 전자결재 기안 작성 — 양식 렌더러(제어) + 제목/긴급 + 결재선 편집(조직도 선택) + 임시저장/상신.
// 값은 field_key 기반 구조화 저장(field_values). 결재선은 순차 단계 리스트(합의/승인)로 구성한다.
// 설계: docs/e-approval-blueprint.md §5-2.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCheck, Send, Save, Trash2, Users, Eye, BookmarkPlus, ShieldCheck, AlertTriangle, Info, Ban, Link2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { parseTimeRange, timeRangeMinutes, type ApprovalFieldDef } from "@/lib/approval/fields";
import { autofillFromRefDoc, compareWithRefDoc } from "@/lib/approval/ref-link";
import { findInCatalog, type LeaveTypeItem } from "@/lib/approval/leave-types";
import { OvertimeConsentModal } from "@/components/approval/OvertimeConsentModal";
import type { OvertimeConsent } from "@/lib/approval/overtime-consent";
import "@/components/cdash/cdash.css";

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
  // 초과근무 신청 양식이면 신청 주의 사용량(기존 신청+근태 실적)을 조회해 주 12h 초과를 경고한다.
  const [otUsage, setOtUsage] = useState<{ weekStart: string; weekEnd: string; requestedMinutes: number; attendanceOvertimeMinutes: number; limitMinutes: number } | null>(null);
  const [otHint, setOtHint] = useState<string | null>(null);
  const isOvertimeForm = form?.formId === "frm-overtime-request";
  const otFrom = isOvertimeForm ? ((values.work_period ?? {}) as { from?: string }).from : undefined;
  // 12h 초과 상신 동의(전자서명) — 모달에서 받은 동의는 ref 로 들고 있다가 persist 시 field_values 에 병합한다.
  const [consentModal, setConsentModal] = useState(false);
  const otConsentRef = useRef<OvertimeConsent | null>(null);

  // 시간 범위(time_range) → 신청시간 자동 계산. 범위가 실제로 바뀔 때만 채우므로
  // 휴게시간 제외 등으로 사용자가 신청시간을 수기 조정하면 그 값이 유지된다.
  // (문서 수정 진입 시의 최초 로드도 덮어쓰지 않는다 — 첫 실행은 기준값만 기록한다.)
  const otRangeKey = isOvertimeForm ? form?.fields.find((f) => f.type === "time_range")?.key : undefined;
  const otRangeValue = otRangeKey ? values[otRangeKey] : undefined;
  const otRangeSigRef = useRef<string | undefined>(undefined);
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

  // 휴가 기간 ↔ 사용일수 ↔ 부여일수 연동(§LM-P2) — 달력일 기준.
  // 부여일수 고정(경조·조의 등): 시작일 입력 → 종료일 자동(days-1 가산)·사용일수=days.
  // 가변(연차·공가·병가): 시작+종료 입력 → 사용일수 자동 카운팅(초과 상한 없음, 연차 잔여만 안내).
  useEffect(() => {
    if (!isLeaveForm || leaveCatalog.length === 0) {
      setLeaveHint(null);
      return;
    }
    const item = findInCatalog(leaveCatalog, values.leave_type);
    if (!item) {
      setLeaveHint(null);
      return;
    }
    const period = (values.leave_period ?? {}) as { from?: string; to?: string };
    const from = period.from;
    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setLeaveHint(item.days != null ? `${item.label} — 부여 ${item.days}일 (시작일을 입력하면 종료일이 자동 설정됩니다)` : null);
      return;
    }
    if (item.days != null) {
      // 고정 부여일수: 종료일·사용일수 자동(상한 강제)
      const to = addDays(from, item.days - 1);
      const changed = to !== period.to || String(values.use_days ?? "") !== String(item.days);
      if (changed) setValues((prev) => ({ ...prev, leave_period: { from, to }, use_days: String(item.days) }));
      setLeaveHint(`${item.label} — 부여 ${item.days}일 · 종료일 자동 설정(${to})`);
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
          setForm({ formId: d.formId, name: d.formName, fields: d.fields, refFormId: d.formRefFormId ?? null });
          setTitle(d.title ?? "");
          setUrgent(!!d.urgent);
          setValues(d.fieldValues ?? {});
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
          fieldValues: otConsentRef.current ? { ...values, _overtime_consent: otConsentRef.current } : values,
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
    [form, docId, title, urgent, values, line, watchers, refDoc]
  );

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
          <Link href="/approval" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> 전자결재 홈
          </Link>
        }
      />

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : error ? (
        <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>
      ) : form ? (
        <>
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="cd-card rounded-3xl p-5 flex-1 min-w-0 flex flex-col gap-4">
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
            <ApprovalFormRenderer
              fields={form.fields}
              values={values}
              onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
              // 기안 단계에서도 완성 문서와 같은 양식 제목을 보여준다(신청/승인란은 상신 후).
              header={{ formName: form.name }}
            />
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
