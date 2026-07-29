"use client";

import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { ExtractionRule, ExtractionRange, Locator, ResultType } from "@/lib/ieps/types";
import { BUILTIN_RULES } from "@/lib/ieps/defaults";

interface Props {
  rule: ExtractionRule | null;
  extractionRange: ExtractionRange;
  onSave: (rule: ExtractionRule) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const LOCATORS: { id: Locator; label: string }[] = [
  { id: "rightOfKeyword", label: "키워드 우측 텍스트" },
  { id: "leftOfKeyword", label: "키워드 좌측 텍스트" },
  { id: "sameRowNext", label: "같은 행 다음 셀" },
  { id: "nextLine", label: "다음 줄 텍스트" },
  { id: "regex", label: "정규식 매칭" },
];

const RESULT_TYPES: { id: ResultType; label: string }[] = [
  { id: "string", label: "문자열" },
  { id: "number", label: "숫자" },
  { id: "date", label: "날짜" },
  { id: "codeName", label: "코드+명칭" },
];

export function RuleEditModal({ rule, extractionRange, onSave, onDelete, onClose }: Props) {
  const isEdit = !!rule;
  const isBuiltin = !!(rule && BUILTIN_RULES.find((r) => r.id === rule.id));

  const [label, setLabel] = useState(rule?.label ?? "");
  const [pageStart, setPageStart] = useState(
    rule?.pageRange?.[0] ?? extractionRange.startPage ?? 1
  );
  const [pageEnd, setPageEnd] = useState(
    rule?.pageRange?.[1] ?? extractionRange.endPage ?? 10
  );
  const [keyword, setKeyword] = useState(rule?.keyword ?? "");
  const [auxKeyword, setAuxKeyword] = useState(rule?.auxKeyword ?? "");
  const [locator, setLocator] = useState<Locator>(rule?.locator ?? "rightOfKeyword");
  const [regex, setRegex] = useState(rule?.regex ?? "");
  const [resultType, setResultType] = useState<ResultType>(rule?.resultType ?? "string");
  const [required, setRequired] = useState(!!rule?.required);
  const [note, setNote] = useState(rule?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const validate = (): string | null => {
    const trimLabel = label.trim();
    if (!trimLabel) return "항목명을 입력하세요.";
    const ps = Number(pageStart);
    const pe = Number(pageEnd);
    if (!Number.isFinite(ps) || !Number.isFinite(pe) || ps < 1 || pe < 1) {
      return "유효한 페이지 범위를 입력하세요.";
    }
    if (pe < ps) return "종료 페이지는 시작 페이지 이상이어야 합니다.";
    if (extractionRange.mode === "partial") {
      const rs = extractionRange.startPage ?? 1;
      const re = extractionRange.endPage ?? 10;
      if (ps < rs || pe > re) {
        return "페이지 범위는 카드의 추출 범위 " + rs + "~" + re + "p 안이어야 합니다.";
      }
    }
    if (locator !== "regex" && !keyword.trim()) return "검색 키워드를 입력하세요.";
    if (locator === "regex" && !regex.trim()) return "정규식 패턴을 입력하세요.";
    return null;
  };

  const handleSave = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const id = rule?.id ?? "u_" + Date.now().toString(36);
    const next: ExtractionRule = {
      id,
      label: label.trim(),
      keyword: keyword.trim() || null,
      auxKeyword: auxKeyword.trim() || null,
      locator,
      regex: locator === "regex" ? regex.trim() || null : null,
      pageRange: [Number(pageStart), Number(pageEnd)],
      resultType,
      required,
      note: note.trim() || null,
      builtin: rule?.builtin ?? false,
    };
    onSave(next);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cd-card rounded-3xl w-[560px] max-w-[92vw] p-6 flex flex-col gap-5 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold cd-text text-lg">
              {isEdit ? "추출 항목 편집 - " + (rule?.label ?? "") : "추출 항목 추가"}
            </h3>
            <p className="text-xs cd-text-faint font-medium mt-1">
              {isEdit
                ? "기존 항목 규칙을 수정합니다. 기본 9개 항목도 동일한 방식으로 편집할 수 있습니다."
                : "검토결과서 PDF에서 자동 추출할 새 항목 규칙을 정의합니다."}
            </p>
          </div>
          <button
            type="button"
            className="cd-btn cd-btn-ghost rounded-xl w-9 h-9 flex items-center justify-center cd-text-muted"
            onClick={onClose}
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="항목명">
            <input
              className="cd-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: 대표자"
              autoFocus
            />
          </Field>

          <Field label="페이지 범위">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                className="cd-input w-24 text-center"
                value={pageStart}
                onChange={(e) => setPageStart(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className="cd-text-faint text-xs">~</span>
              <input
                type="number"
                min={1}
                className="cd-input w-24 text-center"
                value={pageEnd}
                onChange={(e) => setPageEnd(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className="text-[11px] cd-text-faint font-medium">페이지</span>
              {extractionRange.mode === "partial" && (
                <span className="text-[10px] cd-text-faint ml-auto">
                  카드 추출 범위 {extractionRange.startPage}~{extractionRange.endPage}p 이내
                </span>
              )}
            </div>
          </Field>

          <Field label="검색 키워드">
            <input
              className="cd-input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="예: 대표자"
            />
          </Field>

          <Field label="보조 키워드 (선택)">
            <input
              className="cd-input"
              value={auxKeyword}
              onChange={(e) => setAuxKeyword(e.target.value)}
              placeholder="동일 행 또는 페이지에 함께 등장할 보강 키워드"
            />
          </Field>

          <Field label="추출 위치 규칙">
            <select
              className="cd-select"
              value={locator}
              onChange={(e) => setLocator(e.target.value as Locator)}
            >
              {LOCATORS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          {locator === "regex" && (
            <Field label="정규식 패턴">
              <input
                className="cd-input font-mono"
                value={regex}
                onChange={(e) => setRegex(e.target.value)}
                placeholder="예: \d{3}-\d{2}-\d{5}"
              />
            </Field>
          )}

          <Field label="결과 형식">
            <select
              className="cd-select"
              value={resultType}
              onChange={(e) => setResultType(e.target.value as ResultType)}
            >
              {RESULT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-center justify-between cd-surface-bg border cd-border-c rounded-xl px-4 py-3">
            <div>
              <div className="text-xs font-bold cd-text-muted">필수 항목</div>
              <div className="text-[11px] cd-text-faint mt-0.5">
                활성 시 OCR 실패 항목을 검수 대기열에 자동 등록
              </div>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />
              <span className="switch-slider" />
            </label>
          </div>

          <Field label="메모 (선택)">
            <textarea
              className="cd-textarea"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="운영 메모, 예외 케이스 설명"
            />
          </Field>

          {error && (
            <div className="text-xs font-bold cd-error-text cd-error-bg border cd-error-border rounded-xl px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t cd-border-c">
          {isEdit && !isBuiltin ? (
            <button
              type="button"
              className="text-xs font-bold cd-error-text hover:opacity-70 flex items-center gap-1"
              onClick={() => rule && onDelete(rule.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
              삭제
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted"
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm"
              onClick={handleSave}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}
