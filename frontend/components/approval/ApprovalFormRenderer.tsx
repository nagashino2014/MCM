"use client";

// 전자결재 양식 렌더러 — fields(필드 스키마)를 다우식 라벨셀+입력셀 표 레이아웃으로 렌더한다.
// 같은 row 의 필드는 한 행에 배치되고 span(1~3)이 행 내 폭 비중이 된다.
// values/onChange 를 주면 제어 입력(기안 화면), 없으면 내부 상태(미리보기)로 동작한다.
// 설계: docs/e-approval-blueprint.md §3·§5. 표(table) 필드는 행 추가/삭제+합계 자동.

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Users, X } from "lucide-react";
import { ApprovalDocHead, type DocHeadInfo } from "@/components/approval/ApprovalDocHead";
import { OrgPickerModal } from "@/components/approval/OrgPickerModal";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AutoTimeInput } from "@/components/ui/AutoTimeInput";
import { MailEditor } from "@/components/mail/MailEditor";
import {
  parseTimeRange,
  timeRangeMinutes,
  type ApprovalFieldDef,
  type ApprovalTableColumn,
  type ApprovalTimeRange,
} from "@/lib/approval/fields";
import { findInCatalog, type LeaveTypeItem } from "@/lib/approval/leave-types";

type Values = Record<string, unknown>;

interface RendererProps {
  fields: ApprovalFieldDef[];
  values?: Values;
  onChange?: (key: string, value: unknown) => void;
  /** 문서 헤더(다우식 양식 상단 — 제목·기안 정보 표·신청/승인란). */
  header?: DocHeadInfo;
  readOnly?: boolean;
}

const fmtComma = (v: unknown): string => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return isNaN(n) || String(v ?? "").trim() === "" ? "" : n.toLocaleString("ko-KR");
};

export function ApprovalFormRenderer({ fields, values, onChange, header, readOnly }: RendererProps) {
  const [local, setLocal] = useState<Values>({});
  const vals = values ?? local;
  // 자동 채움(fillMap)은 선택 1회에 set 을 연속 호출한다 — 제어 모드의 onChange 구현은
  // 함수형 setState 로 이전 값을 보존해야 한다(기안 화면 주의).
  const set = (key: string, value: unknown) => {
    if (onChange) onChange(key, value);
    else setLocal((prev) => ({ ...prev, [key]: value }));
  };

  const rows = useMemo(() => {
    const map = new Map<number, ApprovalFieldDef[]>();
    for (const f of fields) {
      const r = map.get(f.row) ?? [];
      r.push(f);
      map.set(f.row, r);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, fs]) => fs);
  }, [fields]);

  return (
    // 결재 문서는 고정 가로폭에 맞춰 가운데 정렬한다. 브라우저 창 너비를 그대로 따라가면
    // 넓은 화면에서 한 줄이 지나치게 길어져 읽기 어렵다. 세로는 제한하지 않는다.
    // A4(210mm)로 시작했으나 실사용에서 좁다는 피드백 → 30% 확대(273mm).
    <div className="flex flex-col gap-3 w-full mx-auto" style={{ maxWidth: "273mm" }}>
      {header && <ApprovalDocHead info={header} />}
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--cd-form-line-strong)" }}>
        {rows.map((rowFields, ri) => (
          <div
            key={ri}
            className="flex flex-col md:flex-row"
            style={{ borderTop: ri > 0 ? "1px solid var(--cd-form-line)" : undefined }}
          >
            {rowFields.map((f) => (
              <FieldCell
                key={f.key}
                field={f}
                value={vals[f.key]}
                onSet={(v) => set(f.key, v)}
                onFill={set}
                readOnly={readOnly}
                allFields={fields}
                allValues={vals}
              />
            ))}
          </div>
        ))}
        {rows.length === 0 && <p className="p-5 text-sm cd-text-faint">필드가 없습니다.</p>}
      </div>
    </div>
  );
}

const normOption = (s: string) => s.replace(/[\s&·・\-_/()]/g, "").toLowerCase();

/**
 * 자동 채움 값을 대상 필드 타입에 맞게 구조화한다 — 업체 필드에는 사업장 id 까지 넘겨
 * 재검색 없이 '확정 선택' 상태가 되게 하고, 선택형은 옵션과 느슨 매칭한다
 * (매칭 실패 시 빈 값으로 둬 사용자가 직접 고를 수 있게 한다).
 */
function buildFillValue(target: ApprovalFieldDef | undefined, text: string, ref?: { facilityId?: string | null }): unknown {
  if (!target) return text;
  const matchOption = (opts: string[]): string => {
    if (!opts.length) return text;
    if (opts.includes(text)) return text;
    const n = normOption(text);
    return opts.find((o) => {
      const a = normOption(o);
      return a === n || a.includes(n) || n.includes(a);
    }) ?? "";
  };
  switch (target.type) {
    case "company_select":
      return { name: text, facilityId: ref?.facilityId || undefined, manual: !ref?.facilityId };
    case "contract_select":
      return { title: text };
    case "select":
    case "radio":
      return matchOption(target.options ?? []);
    case "checkbox": {
      const hit = matchOption(target.options ?? []);
      return hit ? [hit] : [];
    }
    default:
      return text;
  }
}

/**
 * 자동 채움(fillMap)으로 값이 확정된 필드인지 — 소스(업체·계약)가 검색으로 확정 선택됐고
 * 그 규칙이 이 필드를 대상으로 하며 값이 실제로 채워진 경우. 이런 필드는 입력을 잠근다
 * (계약을 고르면 업체명·용역분류는 손댈 필요가 없다). 직접 입력 모드이거나 매칭 실패로
 * 값이 비면 잠그지 않아 수기 입력이 가능하다.
 */
function isAutoFilled(f: ApprovalFieldDef, allFields: ApprovalFieldDef[], allValues: Values): boolean {
  const cur = allValues[f.key];
  const empty = cur == null || (typeof cur === "string" && cur.trim() === "") || (typeof cur === "object" && !Object.values(cur as Record<string, unknown>).some(Boolean));
  if (empty) return false;
  return allFields.some((src) => {
    if (!src.fillMap?.some((r) => r.target === f.key)) return false;
    const sv = allValues[src.key];
    if (!sv || typeof sv !== "object") return false;
    const o = sv as { contractId?: string; facilityId?: string; manual?: boolean };
    return !o.manual && Boolean(o.contractId || o.facilityId);
  });
}

function FieldCell({
  field: f,
  value,
  onSet,
  onFill,
  readOnly,
  allFields,
  allValues,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  onFill: (key: string, value: unknown) => void;
  readOnly?: boolean;
  allFields: ApprovalFieldDef[];
  allValues: Values;
}) {
  const span = Math.max(1, Math.min(3, f.span ?? 1));
  if (f.type === "static") {
    return (
      <div className="px-3 py-2.5 text-[11.5px] cd-text-faint whitespace-pre-wrap" style={{ flex: span }}>
        {f.content ?? ""}
      </div>
    );
  }
  const autoFilled = !readOnly && isAutoFilled(f, allFields, allValues);
  return (
    <div className="flex min-w-0 border-t md:border-t-0 md:border-l first:border-l-0 first:border-t-0 cd-border-c" style={{ flex: span }}>
      <div className="w-32 shrink-0 px-2.5 py-2.5 text-[12px] font-bold cd-surface-bg cd-text flex items-center">
        <span>
          {f.required && <span className="text-[color:var(--cd-danger,#FA896B)] mr-0.5">*</span>}
          {f.label}
          {autoFilled && <span className="ml-1 text-[10px] font-medium cd-text-primary">자동</span>}
        </span>
      </div>
      <div className="flex-1 min-w-0 px-2.5 py-2 flex items-center">
        <FieldInput
          field={f}
          value={value}
          onSet={onSet}
          onFill={onFill}
          readOnly={readOnly || autoFilled}
          allFields={allFields}
          allValues={allValues}
        />
      </div>
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onSet,
  onFill,
  readOnly,
  allFields,
  allValues,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  onFill: (key: string, value: unknown) => void;
  readOnly?: boolean;
  allFields: ApprovalFieldDef[];
  allValues: Values;
}) {
  const dis = readOnly === true;
  const base = "cd-input w-full text-[12.5px]";
  switch (f.type) {
    case "text":
    case "dept_select": {
      const ph = f.placeholder ?? (f.type === "dept_select" ? "부서 입력" : undefined);
      return (
        <input className={base} disabled={dis} placeholder={ph} value={String(value ?? "")} onChange={(e) => onSet(e.target.value)} />
      );
    }
    case "user_select":
      return <UserSelectInput field={f} value={value} onSet={onSet} readOnly={dis} />;
    case "multitext":
      return <RichTextInput value={value} onSet={onSet} readOnly={dis} />;
    case "number":
      return (
        <input
          className={`${base} text-right`}
          disabled={dis}
          inputMode="decimal"
          placeholder={f.placeholder}
          value={String(value ?? "")}
          onChange={(e) => onSet(e.target.value)}
        />
      );
    case "currency":
      return (
        <div className="flex items-center gap-1 w-full">
          <input
            className={`${base} text-right`}
            disabled={dis}
            inputMode="numeric"
            value={String(value ?? "")}
            onChange={(e) => onSet(e.target.value.replace(/[^\d]/g, ""))}
          />
          <span className="text-[11px] cd-text-faint shrink-0">원</span>
        </div>
      );
    case "select":
      return (
        <select className="cd-select" style={{ width: "100%" }} disabled={dis} value={String(value ?? "")} onChange={(e) => onSet(e.target.value)}>
          <option value="">선택</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="flex items-center gap-3 flex-wrap text-[12.5px] cd-text">
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" disabled={dis} checked={value === o} onChange={() => onSet(o)} />
              {o}
            </label>
          ))}
        </div>
      );
    case "checkbox": {
      const arr = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex items-center gap-3 flex-wrap text-[12.5px] cd-text">
          {(f.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                disabled={dis}
                checked={arr.includes(o)}
                onChange={(e) => onSet(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "date":
      return <AutoDateInput className={base} disabled={dis} value={String(value ?? "")} onChange={(next) => onSet(next)} />;
    case "time":
      // 24시간 HHMM 연속 입력(예: 1900) → 자동으로 19:00 완성. 저장 형식(HH:MM)은 기존과 동일.
      return <AutoTimeInput className={base} disabled={dis} value={String(value ?? "")} onChange={(next) => onSet(next)} />;
    case "time_range":
      return <TimeRangeInput value={value} onSet={onSet} readOnly={dis} />;
    case "period": {
      const v = (value ?? {}) as { from?: string; to?: string };
      return (
        <div className="flex items-center gap-1.5 w-full">
          <AutoDateInput className={base} disabled={dis} value={v.from ?? ""} onChange={(from) => onSet({ ...v, from })} />
          <span className="cd-text-faint shrink-0">~</span>
          <AutoDateInput className={base} disabled={dis} value={v.to ?? ""} onChange={(to) => onSet({ ...v, to })} />
        </div>
      );
    }
    case "company_select":
      return <CompanySelectInput field={f} value={value} onSet={onSet} onFill={onFill} readOnly={dis} allFields={allFields} />;
    case "contract_select": {
      // 같은 양식에 업체 검색(company_select) 필드가 있고 업체가 선택돼 있으면, 키워드 검색 대신
      // 그 업체와 계약한 최근 3년 이내 계약 리스트를 보여준다(없으면 기존 키워드 검색 유지).
      const companyField = allFields.find((x) => x.type === "company_select");
      const cv = companyField ? (allValues[companyField.key] as CompanyValue | undefined) : undefined;
      const companyFacility =
        cv && typeof cv === "object" && cv.facilityId && !cv.manual ? { facilityId: cv.facilityId, name: cv.name ?? "" } : null;
      return (
        <ContractSelectInput
          field={f}
          value={value}
          onSet={onSet}
          onFill={onFill}
          readOnly={dis}
          companyFacility={companyFacility}
          allFields={allFields}
        />
      );
    }
    case "contact_select":
      return <ContactSelectInput field={f} value={value} onSet={onSet} readOnly={dis} />;
    case "leave_type":
      return <LeaveTypeInput value={value} onSet={onSet} readOnly={dis} />;
    case "asset_select":
      return <AssetSelectInput field={f} value={value} onSet={onSet} readOnly={dis} />;
    case "table":
      return <TableInput field={f} value={value} onSet={onSet} readOnly={dis} />;
    default:
      return <input className={base} disabled={dis} value={String(value ?? "")} onChange={(e) => onSet(e.target.value)} />;
  }
}

// ── 여러 줄(multitext) 리치 입력 — 메일 본문 에디터(MailEditor) 재사용(G3) ──
// 값은 HTML 문자열로 저장한다. 구버전 플레인텍스트 값은 시드 시 escape+<br> 변환으로 호환.

const looksLikeHtml = (s: string) => /<[a-z][^>]*>/i.test(s);
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toEditorHtml = (v: unknown): string => {
  const s = String(v ?? "");
  if (!s) return "";
  return looksLikeHtml(s) ? s : escapeHtml(s).replace(/\n/g, "<br>");
};
/** 표시 전 최소 새니타이즈 — script·인라인 이벤트·javascript: 제거(에디터 산출물엔 원래 없음). */
const sanitizeHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

function RichTextInput({ value, onSet, readOnly }: { value: unknown; onSet: (v: unknown) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);
  useEffect(() => {
    // 최초 1회 + 외부 값 변경(드래프트 로드·자동 채움) 시드. 입력 중(포커스)에는 덮지 않는다.
    const el = ref.current;
    if (!el) return;
    const html = sanitizeHtml(toEditorHtml(value));
    if (!seeded.current || (document.activeElement !== el && el.innerHTML !== html)) {
      el.innerHTML = html;
      seeded.current = true;
    }
  }, [value]);
  const handleInput = () => {
    const el = ref.current;
    if (!el) return;
    // 텍스트·이미지·표가 전혀 없으면 빈 값으로 저장(필수 검증이 빈 HTML 을 통과하지 않도록)
    const emptyish = !el.innerText.trim() && !el.querySelector("img,table,hr");
    onSet(emptyish ? "" : el.innerHTML);
  };
  if (readOnly) {
    return (
      <div
        className="cd-mail-editor w-full min-h-[40px] rounded-lg border cd-border-c bg-white px-3 py-2 text-sm text-black"
        style={{ lineHeight: 1.6 }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(toEditorHtml(value)) }}
      />
    );
  }
  return (
    <div className="w-full min-w-0 py-1">
      <MailEditor ref={ref} onInput={handleInput} minHeightPx={150} />
    </div>
  );
}

/**
 * 시간 범위 입력 — 시작·종료를 각각 HHMM 연속 입력(1830 → 18:30)으로 받는다.
 * 저장 값: { start, end }(각 "HH:MM"). 구버전 자유 텍스트("18:00 ~ 19:30") 값도 파싱해 표시한다.
 * 종료가 시작보다 이르면 자정을 넘긴 근무로 보고 소요 시간을 계산한다(22:00~01:00 = 3시간).
 */
function TimeRangeInput({ value, onSet, readOnly }: { value: unknown; onSet: (v: unknown) => void; readOnly?: boolean }) {
  const v: ApprovalTimeRange = parseTimeRange(value);
  const minutes = timeRangeMinutes(value);
  const base = "cd-input w-full text-[12.5px]";
  return (
    <div className="flex items-center gap-1.5 w-full">
      <AutoTimeInput
        className={base}
        disabled={readOnly}
        placeholder="시작 HHMM"
        value={v.start ?? ""}
        onChange={(start) => onSet({ ...v, start })}
      />
      <span className="cd-text-faint shrink-0">~</span>
      <AutoTimeInput
        className={base}
        disabled={readOnly}
        placeholder="종료 HHMM"
        value={v.end ?? ""}
        onChange={(end) => onSet({ ...v, end })}
      />
      {minutes != null && (
        <span className="text-[11px] cd-text-faint shrink-0 whitespace-nowrap">
          {Math.floor(minutes / 60)}시간{minutes % 60 > 0 ? ` ${minutes % 60}분` : ""}
        </span>
      )}
    </div>
  );
}

/**
 * 업체 검색 입력 — 계약 등록 모달과 동일하게 /api/facilities?q= 자동완성(2자 이상, 디바운스).
 * '미계약 업체(직접 입력)' 체크 시 검색 없이 자유 입력으로 전환된다.
 * 저장 값: { name, facilityId?, manual? } — 미계약 여부까지 구조화 저장되어 집계 가능.
 * fillMap 이 정의돼 있으면 선택 시 소스 속성(주소/대표자/전화/사업자번호/지역)을 대상 필드에 주입한다.
 */
interface CompanyValue {
  name?: string;
  facilityId?: string;
  manual?: boolean;
}

interface FacilityOption {
  facilityId: string;
  companyName: string;
  businessRegistrationNo?: string | null;
  siteAddress?: string | null;
  representativeName?: string | null;
  phoneNumber?: string | null;
  regionSido?: string | null;
  regionSigungu?: string | null;
}

function CompanySelectInput({
  field: f,
  value,
  onSet,
  onFill,
  readOnly,
  allFields,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  onFill: (key: string, value: unknown) => void;
  readOnly?: boolean;
  allFields: ApprovalFieldDef[];
}) {
  const v: CompanyValue =
    value && typeof value === "object" ? (value as CompanyValue) : { name: String(value ?? "") };
  const [options, setOptions] = useState<FacilityOption[]>([]);

  useEffect(() => {
    const q = (v.name ?? "").trim();
    // 직접 입력 모드·이미 선택됨·2자 미만이면 검색하지 않는다
    if (v.manual || v.facilityId || q.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "15", sort: "name" });
        const res = await fetch(`/api/facilities?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: FacilityOption[] };
        setOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setOptions([]);
      }
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [v.name, v.manual, v.facilityId]);

  const pick = (o: FacilityOption) => {
    onSet({ name: o.companyName, facilityId: o.facilityId, manual: false });
    for (const rule of f.fillMap ?? []) {
      const val =
        rule.source === "region"
          ? [o.regionSido, o.regionSigungu].filter(Boolean).join(" ")
          : String((o as unknown as Record<string, unknown>)[rule.source] ?? "");
      if (val) onFill(rule.target, buildFillValue(allFields.find((x) => x.key === rule.target), val));
    }
    setOptions([]);
  };

  return (
    <div className="w-full relative">
      <div className="flex items-center gap-2.5 flex-wrap">
        <input
          className="cd-input flex-1 min-w-[160px] text-[12.5px]"
          disabled={readOnly}
          placeholder={f.placeholder ?? (v.manual ? "업체명 직접 입력" : "업체명 검색(2자 이상)")}
          value={v.name ?? ""}
          onChange={(e) => onSet({ ...v, name: e.target.value, facilityId: undefined })}
        />
        <label className="flex items-center gap-1.5 text-[11.5px] cd-text cursor-pointer shrink-0" title="계약·등록되지 않은 컨택 중 업체는 직접 입력합니다">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={v.manual === true}
            onChange={(e) => {
              onSet({ name: v.name ?? "", manual: e.target.checked, facilityId: undefined });
              setOptions([]);
            }}
          />
          미계약 업체(직접 입력)
        </label>
      </div>
      {v.facilityId && !v.manual && <p className="text-[10.5px] cd-text-primary mt-0.5">선택됨: {v.name}</p>}
      {options.length > 0 && !v.facilityId && !v.manual && !readOnly && (
        <div className="absolute z-10 top-full mt-1 left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-52 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.facilityId}
              type="button"
              className="w-full px-3 py-2 text-left text-[12.5px] hover:bg-[color:var(--cd-surface)]"
              onClick={() => pick(o)}
            >
              <span className="cd-text">{o.companyName}</span>
              <span className="ml-2 text-[10.5px] cd-text-faint">{o.businessRegistrationNo ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 계약 검색 입력 — /api/contracts?q= (RBAC 가시성 스코프 적용) 자동완성.
 * '미등록 용역(직접 입력)' 체크 시 자유 입력(컨택 중 업체의 제안서 등 계약 前 업무 대응).
 * 저장 값: { title, contractId?, manual? }. fillMap 으로 업체명·용역분류·계약일 등 자동 채움.
 * 같은 양식에서 업체가 선택돼 있으면(companyFacility) 키워드 검색 대신 그 업체의
 * 최근 3년 이내 계약 리스트를 포커스 시 보여준다(입력 텍스트는 리스트 내 필터로 동작).
 */
interface ContractValue {
  title?: string;
  contractId?: string;
  manual?: boolean;
}

interface ContractOption {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  /** 계약상대 업체의 사업장 id — 업체명 자동 채움 시 함께 넘겨 '확정 선택' 상태로 만든다. */
  counterpartyFacilityId?: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  contractDate: string | null;
  contractAmount: number | null;
}

/** 오늘로부터 n년 전 ISO 날짜(YYYY-MM-DD) — 최근 3년 계약 필터 기준. */
function isoYearsAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function ContractSelectInput({
  field: f,
  value,
  onSet,
  onFill,
  readOnly,
  companyFacility,
  allFields,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  onFill: (key: string, value: unknown) => void;
  readOnly?: boolean;
  companyFacility: { facilityId: string; name: string } | null;
  allFields: ApprovalFieldDef[];
}) {
  const v: ContractValue =
    value && typeof value === "object" ? (value as ContractValue) : { title: String(value ?? "") };
  const [options, setOptions] = useState<ContractOption[]>([]);
  // 업체 연동 모드 — 선택 업체의 최근 3년 계약 리스트(포커스 시 표시)
  const [companyList, setCompanyList] = useState<ContractOption[] | null>(null);
  const [focused, setFocused] = useState(false);
  const linkedFacilityId = companyFacility?.facilityId ?? null;

  // 키워드 검색 모드(업체 미연동 시에만)
  useEffect(() => {
    const q = (v.title ?? "").trim();
    if (linkedFacilityId || v.manual || v.contractId || q.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "15" });
        const res = await fetch(`/api/contracts?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: ContractOption[] };
        setOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setOptions([]);
      }
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [v.title, v.manual, v.contractId, linkedFacilityId]);

  // 업체 연동 모드 — 업체가 바뀌면 최근 3년 계약을 미리 로드해 둔다
  useEffect(() => {
    if (!linkedFacilityId) {
      setCompanyList(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({
          facilityId: linkedFacilityId,
          dateFrom: isoYearsAgo(3),
          sort: "date",
          limit: "50",
        });
        const res = await fetch(`/api/contracts?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: ContractOption[] };
        setCompanyList(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setCompanyList(null);
      }
    })();
    return () => controller.abort();
  }, [linkedFacilityId]);

  const pick = (o: ContractOption) => {
    onSet({ title: o.contractTitle, contractId: o.contractId, manual: false });
    for (const rule of f.fillMap ?? []) {
      const raw = (o as unknown as Record<string, unknown>)[rule.source];
      const val = rule.source === "contractAmount" && raw != null ? Number(raw).toLocaleString("ko-KR") : String(raw ?? "");
      if (!val) continue;
      const target = allFields.find((x) => x.key === rule.target);
      // 업체명 채움에는 계약상대의 사업장 id 를 실어 보낸다(업체 필드가 다시 검색을 띄우지 않도록).
      const ref = rule.source === "counterpartyName" ? { facilityId: o.counterpartyFacilityId ?? null } : undefined;
      onFill(rule.target, buildFillValue(target, val, ref));
    }
    setOptions([]);
    setFocused(false);
  };

  // 표시할 리스트 — 연동 모드: 최근 3년 계약(입력 텍스트로 필터), 검색 모드: 키워드 결과
  const listToShow: ContractOption[] = (() => {
    if (v.contractId || v.manual || readOnly) return [];
    if (linkedFacilityId) {
      if (!focused || !companyList) return [];
      const q = (v.title ?? "").trim().toLowerCase();
      return q ? companyList.filter((o) => o.contractTitle.toLowerCase().includes(q)) : companyList;
    }
    return options;
  })();

  return (
    <div className="w-full relative">
      <div className="flex items-center gap-2.5 flex-wrap">
        <input
          className="cd-input flex-1 min-w-[160px] text-[12.5px]"
          disabled={readOnly}
          placeholder={
            f.placeholder ??
            (v.manual
              ? "용역명 직접 입력"
              : linkedFacilityId
                ? `${companyFacility?.name ?? "선택 업체"}의 최근 3년 계약에서 선택`
                : "계약(용역명·업체명) 검색(2자 이상)")
          }
          value={v.title ?? ""}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // 리스트 항목 클릭(mousedown→click)이 끝난 뒤 닫히도록 지연
            setTimeout(() => setFocused(false), 180);
          }}
          onChange={(e) => onSet({ ...v, title: e.target.value, contractId: undefined })}
        />
        <label className="flex items-center gap-1.5 text-[11.5px] cd-text cursor-pointer shrink-0" title="계약 전 업무(제안서·발표자료 등)는 직접 입력합니다">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={v.manual === true}
            onChange={(e) => {
              onSet({ title: v.title ?? "", manual: e.target.checked, contractId: undefined });
              setOptions([]);
            }}
          />
          미등록 용역(직접 입력)
        </label>
      </div>
      {v.contractId && !v.manual && <p className="text-[10.5px] cd-text-primary mt-0.5">선택됨: {v.title}</p>}
      {linkedFacilityId && !v.contractId && !v.manual && companyList && companyList.length === 0 && (
        <p className="text-[10.5px] cd-text-faint mt-0.5">
          {companyFacility?.name}의 최근 3년 계약이 없습니다 — 직접 입력을 사용하세요.
        </p>
      )}
      {listToShow.length > 0 && !readOnly && (
        <div className="absolute z-10 top-full mt-1 left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-52 overflow-y-auto">
          {listToShow.map((o) => (
            <button
              key={o.contractId}
              type="button"
              className="w-full px-3 py-2 text-left text-[12.5px] hover:bg-[color:var(--cd-surface)]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <span className="cd-text">{o.contractTitle}</span>
              <span className="ml-2 text-[10.5px] cd-text-faint">
                {o.counterpartyName}
                {o.contractDate ? ` · ${o.contractDate}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 접견인(사업장 담당자) 검색 입력 — 명함 촬영·사업장 담당자 정보로 쌓인
 * facility_contact_people 리스트에서 키워드(성명·업체명)로 검색해 복수 선택한다.
 * 선택한 담당자는 입력 창 우측에 태그로 배치되며, 다시 검색해 추가할 수 있다.
 * 저장 값: { id, name, title?, facilityName? }[] — 구버전 text 값(문자열)은 그대로 표시(호환).
 */
interface ContactPersonValue {
  id: number;
  name: string;
  title?: string | null;
  facilityName?: string | null;
}

interface ContactOption {
  id: number;
  personName: string;
  title: string | null;
  facilityId: string;
  facilityName: string | null;
  departmentName: string | null;
}

function ContactSelectInput({
  field: f,
  value,
  onSet,
  readOnly,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const people: ContactPersonValue[] = Array.isArray(value)
    ? (value as ContactPersonValue[]).filter((p) => p && p.name)
    : [];
  const legacyText = !Array.isArray(value) && typeof value === "string" ? value : "";
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<ContactOption[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, limit: "15" });
        const res = await fetch(`/api/approval/contacts?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: ContactOption[] };
        setOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setOptions([]);
      }
    }, 160);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [q]);

  const pick = (o: ContactOption) => {
    if (!people.some((p) => p.id === o.id)) {
      onSet([...people, { id: o.id, name: o.personName, title: o.title, facilityName: o.facilityName }]);
    }
    setQ("");
    setOptions([]);
  };

  const tagLabel = (p: ContactPersonValue) =>
    `${p.name}${p.title ? ` ${p.title}` : ""}${p.facilityName ? ` (${p.facilityName})` : ""}`;

  if (readOnly) {
    return (
      <div className="w-full flex items-center gap-1.5 flex-wrap text-[12.5px] cd-text">
        {people.length > 0
          ? people.map((p) => (
              <span key={p.id} className="inline-flex items-center rounded-full cd-tint-primary px-2.5 py-1 text-[11.5px]">
                {tagLabel(p)}
              </span>
            ))
          : legacyText || <span className="cd-text-faint">-</span>}
      </div>
    );
  }

  return (
    <div className="w-full relative">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input
          className="cd-input flex-1 min-w-[180px] text-[12.5px]"
          placeholder={f.placeholder ?? "담당자 검색(성명·업체명, 2자 이상)"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {people.map((p) => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2.5 py-1 text-[11.5px] shrink-0">
            {tagLabel(p)}
            <button type="button" title="제거" onClick={() => onSet(people.filter((x) => x.id !== p.id))}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {legacyText && people.length === 0 && (
          <span className="text-[11px] cd-text-faint shrink-0" title="이전 방식(직접 입력)으로 저장된 값입니다">
            기존 입력: {legacyText}
          </span>
        )}
      </div>
      {options.length > 0 && (
        <div className="absolute z-10 top-full mt-1 left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-52 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full px-3 py-2 text-left text-[12.5px] hover:bg-[color:var(--cd-surface)]"
              onClick={() => pick(o)}
            >
              <span className="cd-text">
                {o.personName}
                {o.title ? <span className="cd-text-faint text-[11px]"> {o.title}</span> : null}
              </span>
              <span className="ml-2 text-[10.5px] cd-text-faint">
                {o.facilityName ?? ""}
                {o.departmentName ? ` · ${o.departmentName}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 휴가 종류 입력 — 사규 경조 규정 카탈로그(LEAVE_ENTITLEMENTS)에서 optgroup 으로 렌더.
 * 선택 시 규정상 부여일수(경조·출산·조의)나 차감 안내(연차·반차)를 배지로 즉시 표시한다.
 * 저장 값: 선택 key(문자열). 구버전 label 값도 findLeaveItem 이 매칭한다.
 */
function LeaveTypeInput({ value, onSet, readOnly }: { value: unknown; onSet: (v: unknown) => void; readOnly?: boolean }) {
  const [catalog, setCatalog] = useState<LeaveTypeItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/approval/leave-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.types) setCatalog(d.types);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const item = findInCatalog(catalog, value);
  const groups = useMemo(() => {
    const map = new Map<string, LeaveTypeItem[]>();
    for (const it of catalog) map.set(it.group, [...(map.get(it.group) ?? []), it]);
    return [...map.entries()];
  }, [catalog]);

  const badge = (() => {
    if (!item) return null;
    if (item.deduct === "full") return { text: "연차 1일 차감", tone: "primary" as const };
    if (item.deduct === "half") return { text: "연차 0.5일 차감", tone: "primary" as const };
    if (item.days != null) return { text: `부여 휴가 ${item.days}일`, tone: "ok" as const };
    return { text: "실사용 기간만큼 (연차 미차감)", tone: "muted" as const };
  })();

  return (
    <div className="flex items-center gap-2 flex-wrap w-full">
      <select
        className="cd-select"
        style={{ width: 210 }}
        disabled={readOnly}
        value={item?.key ?? ""}
        onChange={(e) => onSet(e.target.value)}
      >
        <option value="">선택</option>
        {groups.map(([g, items]) => (
          <optgroup key={g} label={g}>
            {items.map((it) => (
              <option key={it.key} value={it.key}>
                {it.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {badge && (
        <span
          className={`text-[11.5px] rounded-full px-2.5 py-1 shrink-0 ${
            badge.tone === "ok"
              ? "border border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
              : badge.tone === "primary"
                ? "cd-tint-primary"
                : "border cd-border-c cd-text-faint"
          }`}
        >
          {badge.text}
        </span>
      )}
    </div>
  );
}

/**
 * 예약 자산 선택 입력 — 자산 마스터(reservable_assets)에서 활성 자산을 로드해 선택한다.
 * 옵션을 양식에 하드코딩하지 않으므로 자산 관리 화면의 등록·비활성이 즉시 반영된다.
 * 저장 값: { assetId, name } — 구버전 문자열 값(옵션 하드코딩 시절)은 이름으로 폴백 표시.
 */
interface AssetValue {
  assetId?: string;
  name?: string;
}

function AssetSelectInput({
  field: f,
  value,
  onSet,
  readOnly,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const v: AssetValue = value && typeof value === "object" ? (value as AssetValue) : { name: String(value ?? "") };
  const [assets, setAssets] = useState<Array<{ assetId: string; name: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ activeOnly: "1" });
    if (f.assetKind) params.set("kind", f.assetKind);
    fetch(`/api/assets?${params.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.assets)) {
          setAssets(d.assets.map((a: { assetId: string; name: string }) => ({ assetId: a.assetId, name: a.name })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [f.assetKind]);

  // 레거시 문자열 값·비활성 자산 값은 목록에 없어도 표시가 유지되어야 한다(기존 문서 열람).
  const currentId = v.assetId ?? (v.name ? `name:${v.name}` : "");
  const hasCurrent = v.assetId
    ? assets.some((a) => a.assetId === v.assetId)
    : false;

  return (
    <select
      className="cd-select"
      style={{ width: "100%" }}
      disabled={readOnly}
      value={currentId}
      onChange={(e) => {
        const id = e.target.value;
        if (!id) {
          onSet(null);
          return;
        }
        const a = assets.find((x) => x.assetId === id);
        onSet(a ? { assetId: a.assetId, name: a.name } : null);
      }}
    >
      <option value="">선택</option>
      {!hasCurrent && currentId && (
        <option value={currentId} disabled>
          {v.name ?? v.assetId}
        </option>
      )}
      {assets.map((a) => (
        <option key={a.assetId} value={a.assetId}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

/**
 * 사용자 선택 입력 — 조직도 모달(OrganizationTree)에서 인원을 클릭해 선택한다.
 * 저장 값: { employeeId, name } (multiple 이면 배열) — 이름이 아닌 employee_id 기준 저장.
 */
interface PersonValue {
  employeeId: string;
  name: string;
}

function UserSelectInput({
  field: f,
  value,
  onSet,
  readOnly,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const [orgModal, setOrgModal] = useState(false);
  const people: PersonValue[] = Array.isArray(value)
    ? (value as PersonValue[]).filter((p) => p && p.employeeId)
    : value && typeof value === "object" && (value as PersonValue).employeeId
      ? [value as PersonValue]
      : [];

  const commit = (next: PersonValue[]) => {
    if (f.multiple) onSet(next);
    else onSet(next[0] ?? null);
  };

  return (
    <div className="w-full flex items-center gap-1.5 flex-wrap">
      {people.map((p) => (
        <span key={p.employeeId} className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2.5 py-1 text-[11.5px]">
          {p.name}
          {!readOnly && (
            <button type="button" title="제거" onClick={() => commit(people.filter((x) => x.employeeId !== p.employeeId))}>
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11.5px] flex items-center gap-1"
          onClick={() => setOrgModal(true)}
        >
          <Users className="w-3.5 h-3.5" /> 조직도에서 선택
        </button>
      )}
      {people.length === 0 && readOnly && <span className="text-[12px] cd-text-faint">-</span>}
      <OrgPickerModal
        open={orgModal}
        title={`${f.label} — 조직도에서 선택${f.multiple ? " (복수 가능)" : ""}`}
        hint={`인원을 클릭하면 선택됩니다.${f.multiple ? " 여러 명을 이어서 선택한 뒤 닫으세요." : ""}`}
        onClose={() => setOrgModal(false)}
        onSelect={(emp) => {
          const next = f.multiple
            ? people.some((p) => p.employeeId === emp.employeeId)
              ? people
              : [...people, { employeeId: emp.employeeId, name: emp.name }]
            : [{ employeeId: emp.employeeId, name: emp.name }];
          commit(next);
          if (!f.multiple) setOrgModal(false);
        }}
      />
    </div>
  );
}

/** 표(반복 행) 입력 — 행 추가/삭제 + sumColumn 합계 자동. 값은 행 객체 배열로 저장된다.
 *  people 열은 조직도 복수 선택({employeeId,name,position}[] 저장, 성명/직함 태그 표시). */
function TableInput({
  field: f,
  value,
  onSet,
  readOnly,
}: {
  field: ApprovalFieldDef;
  value: unknown;
  onSet: (v: unknown) => void;
  readOnly?: boolean;
}) {
  const cols = f.tableColumns ?? [];
  const emptyRow = () => Object.fromEntries(cols.map((c) => [c.key, ""]));
  const rows: Record<string, unknown>[] = useMemo(() => {
    const arr = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    const min = Math.max(1, f.minRows ?? 1);
    if (arr.length >= min) return arr;
    return [...arr, ...Array.from({ length: min - arr.length }, emptyRow)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, f.minRows, cols.length]);

  const update = (ri: number, key: string, v: unknown) => {
    const next = rows.map((r, i) => (i === ri ? { ...r, [key]: v } : r));
    onSet(next);
  };
  // people 열 조직도 모달 대상(행·열) — 모달은 표당 1개만 렌더한다
  const [peopleTarget, setPeopleTarget] = useState<{ ri: number; colKey: string } | null>(null);
  // link 열 — URL 확정(blur) 시 페이지 제목·판매 단가를 수집해 fillTarget/fillPriceTarget 열에 자동 채움.
  // fetch 완료 시점의 최신 행을 봐야 하므로 ref 경유(수집 중 다른 셀 수정 유실 방지).
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [linkBusy, setLinkBusy] = useState<string | null>(null); // `${ri}:${colKey}`
  // 자동 수집이 차단된 행 안내(쿠팡·네이버·G마켓 등 상용 봇 방어 — 2026-08-26 실측: Chromium 렌더로도 불가)
  const [linkFailRows, setLinkFailRows] = useState<number[]>([]);
  const fetchLinkTitle = async (ri: number, col: ApprovalTableColumn) => {
    const url = String(rowsRef.current[ri]?.[col.key] ?? "").trim();
    const target = col.fillTarget;
    const priceTarget = col.fillPriceTarget;
    if ((!target && !priceTarget) || !/^https?:\/\//i.test(url)) return;
    const empty = (key?: string) => !!key && !String(rowsRef.current[ri]?.[key] ?? "").trim();
    if (!empty(target) && !empty(priceTarget)) return; // 둘 다 입력됨 — 덮지 않음(수동 우선)
    setLinkBusy(`${ri}:${col.key}`);
    let filled = false;
    try {
      const res = await fetch(`/api/approval/link-preview?url=${encodeURIComponent(url)}`);
      const data = (await res.json().catch(() => ({}))) as { title?: string | null; price?: string | null };
      const title = typeof data.title === "string" ? data.title.trim() : "";
      const price = typeof data.price === "string" ? data.price.trim() : "";
      const patch: Record<string, unknown> = {};
      if (title && target && empty(target)) patch[target] = title;
      if (price && priceTarget && empty(priceTarget)) patch[priceTarget] = price;
      if (Object.keys(patch).length) {
        filled = true;
        onSet(rowsRef.current.map((r, i) => (i === ri ? { ...r, ...patch } : r)));
      }
    } catch {
      // 수집 실패(차단 사이트 등)는 정상 경로 — 수동 입력 폴백
    }
    setLinkBusy(null);
    setLinkFailRows((prev) => {
      const has = prev.includes(ri);
      if (filled) return has ? prev.filter((x) => x !== ri) : prev;
      return has ? prev : [...prev, ri];
    });
  };
  const peopleAt = (ri: number, colKey: string): TablePerson[] => {
    const v = rows[ri]?.[colKey];
    return Array.isArray(v) ? (v as TablePerson[]).filter((p) => p && p.employeeId) : [];
  };
  const sum = f.sumColumn
    ? rows.reduce((a, r) => a + (Number(String(r[f.sumColumn!] ?? "").replace(/[^\d.-]/g, "")) || 0), 0)
    : null;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className="border cd-border-c px-2 py-1.5 cd-surface-bg cd-text font-bold whitespace-nowrap">
                {c.label}
              </th>
            ))}
            {!readOnly && <th className="border-0 w-7" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map((c) => (
                <td key={c.key} className="border cd-border-c p-0 align-middle">
                  {c.type === "rowno" ? (
                    <div className="px-1.5 py-1.5 text-center cd-text-faint">{ri + 1}</div>
                  ) : c.type === "link" ? (
                    readOnly ? (
                      String(r[c.key] ?? "").trim() ? (
                        <a
                          className="block px-1.5 py-1.5 text-[12px] underline truncate max-w-[200px] text-[color:var(--cd-primary,#5D87FF)]"
                          href={String(r[c.key])}
                          target="_blank"
                          rel="noreferrer"
                          title={String(r[c.key])}
                        >
                          {String(r[c.key])}
                        </a>
                      ) : (
                        <div className="px-1.5 py-1.5" />
                      )
                    ) : (
                      <input
                        type="text"
                        className="w-full bg-transparent px-1.5 py-1.5 text-[12px] cd-text outline-none"
                        placeholder={linkBusy === `${ri}:${c.key}` ? "품명 수집 중…" : "https:// (붙여넣으면 품명 자동)"}
                        value={String(r[c.key] ?? "")}
                        onChange={(e) => update(ri, c.key, e.target.value)}
                        onBlur={() => void fetchLinkTitle(ri, c)}
                      />
                    )
                  ) : c.type === "select" ? (
                    <select
                      className="w-full bg-transparent px-1.5 py-1.5 text-[12px] cd-text outline-none"
                      disabled={readOnly}
                      value={String(r[c.key] ?? "")}
                      onChange={(e) => update(ri, c.key, e.target.value)}
                    >
                      <option value="">선택</option>
                      {(c.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : c.type === "date" ? (
                    <AutoDateInput
                      className="w-full bg-transparent px-1.5 py-1.5 text-[12px] cd-text outline-none"
                      disabled={readOnly}
                      value={String(r[c.key] ?? "")}
                      onChange={(next) => update(ri, c.key, next)}
                    />
                  ) : c.type === "time" ? (
                    <AutoTimeInput
                      className="w-full bg-transparent px-1.5 py-1.5 text-[12px] cd-text outline-none"
                      disabled={readOnly}
                      value={String(r[c.key] ?? "")}
                      onChange={(next) => update(ri, c.key, next)}
                    />
                  ) : c.type === "people" ? (
                    <div className="px-1.5 py-1 flex items-center gap-1 flex-wrap">
                      {peopleAt(ri, c.key).map((p) => (
                        <span key={p.employeeId} className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2 py-0.5 text-[11px] shrink-0">
                          {p.name}
                          {p.position ? `/${p.position}` : ""}
                          {!readOnly && (
                            <button
                              type="button"
                              title="제거"
                              onClick={() => update(ri, c.key, peopleAt(ri, c.key).filter((x) => x.employeeId !== p.employeeId))}
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </span>
                      ))}
                      {/* 구버전 텍스트 값(문자열) 호환 표시 */}
                      {typeof r[c.key] === "string" && String(r[c.key]).trim() !== "" && (
                        <span className="text-[11.5px] cd-text">{String(r[c.key])}</span>
                      )}
                      {!readOnly && (
                        <button
                          type="button"
                          className="cd-btn rounded-md border cd-border-c px-1.5 py-0.5 text-[10.5px] flex items-center gap-1 shrink-0"
                          title="조직도에서 선택(복수 가능)"
                          onClick={() => setPeopleTarget({ ri, colKey: c.key })}
                        >
                          <Users className="w-3 h-3" /> 선택
                        </button>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      inputMode={c.type === "currency" || c.type === "number" ? "numeric" : undefined}
                      className={`w-full bg-transparent px-1.5 py-1.5 text-[12px] cd-text outline-none ${
                        c.type === "currency" || c.type === "number" ? "text-right" : ""
                      }`}
                      disabled={readOnly}
                      value={String(r[c.key] ?? "")}
                      onChange={(e) => update(ri, c.key, e.target.value)}
                    />
                  )}
                </td>
              ))}
              {!readOnly && (
                <td className="w-7 text-center">
                  <button
                    type="button"
                    className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
                    title="행 삭제"
                    onClick={() => onSet(rows.filter((_, i) => i !== ri))}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {sum != null && (
            <tr>
              {cols.map((c, ci) => (
                <td key={c.key} className="border cd-border-c px-2 py-1.5 font-bold cd-text text-right">
                  {ci === 0 ? "합계" : c.key === f.sumColumn ? `${fmtComma(sum)} 원` : ""}
                </td>
              ))}
              {!readOnly && <td className="border-0" />}
            </tr>
          )}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          className="mt-1.5 text-[11.5px] cd-text-primary flex items-center gap-1"
          onClick={() => onSet([...rows, emptyRow()])}
        >
          <Plus className="w-3.5 h-3.5" /> 행 추가
        </button>
      )}
      {!readOnly && linkFailRows.length > 0 && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
          {linkFailRows.map((ri) => ri + 1).join(", ")}행 링크: 이 쇼핑몰은 자동 수집을 차단합니다(쿠팡·네이버쇼핑·G마켓 등) — 품명·단가를 직접 입력해 주세요.
        </p>
      )}
      <OrgPickerModal
        open={peopleTarget != null}
        title="동행자 선택 — 조직도에서 선택 (복수 가능)"
        hint="인원을 클릭하면 태그로 추가됩니다. 여러 명을 이어서 선택한 뒤 닫으세요."
        onClose={() => setPeopleTarget(null)}
        onSelect={(emp) => {
          if (!peopleTarget) return;
          const cur = peopleAt(peopleTarget.ri, peopleTarget.colKey);
          if (cur.some((p) => p.employeeId === emp.employeeId)) return;
          update(peopleTarget.ri, peopleTarget.colKey, [
            ...cur,
            { employeeId: emp.employeeId, name: emp.name, position: emp.positionName ?? undefined },
          ]);
        }}
      />
    </div>
  );
}

/** 표 people 열 저장 값 — 성명/직함 태그 표시용(조직도 스냅샷 기준). */
interface TablePerson {
  employeeId: string;
  name: string;
  position?: string;
}
