"use client";

// 설문 문항 1개의 편집 카드 — 유형·제목·설명·필수·보기·척도 설정.
// 상위(SurveyBuilderBoard)가 문항 배열을 들고 있고, 이 컴포넌트는 변경분만 콜백으로 올린다.

import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2, X } from "lucide-react";
import { CdBadge, CdCheckbox, CdInput, CdSelect, CdTextarea } from "@/components/cdash";
import { CHOICE_TYPES, DEFAULT_SCALE, QUESTION_TYPE_LABELS } from "@/lib/survey/defaults";
import type { QuestionOption, QuestionType, SurveyQuestion } from "@/lib/survey/types";

export interface DraftQuestion extends Omit<SurveyQuestion, "surveyId" | "seq"> {}

interface Props {
  question: DraftQuestion;
  index: number;
  total: number;
  readOnly: boolean;
  onChange: (patch: Partial<DraftQuestion>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}

export function QuestionEditor({ question, index, total, readOnly, onChange, onRemove, onMove }: Props) {
  const isChoice = CHOICE_TYPES.includes(question.qtype);
  const isSection = question.qtype === "section";

  const setOption = (i: number, patch: Partial<QuestionOption>) => {
    const options = question.options.map((o, oi) => (oi === i ? { ...o, ...patch } : o));
    onChange({ options });
  };

  const addOption = () => {
    const next: QuestionOption = { value: `o${Date.now().toString(36)}`, label: "" };
    onChange({ options: [...question.options, next] });
  };

  const removeOption = (i: number) => {
    onChange({ options: question.options.filter((_, oi) => oi !== i) });
  };

  return (
    <div className="rounded-2xl border cd-border-c cd-card-bg p-5">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-1">
          <GripVertical className="w-4 h-4 cd-text-faint" aria-hidden="true" />
          <span className="text-xs cd-text-faint">{index + 1}</span>
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <CdSelect
              label="유형"
              className="w-52"
              value={question.qtype}
              disabled={readOnly}
              onChange={(e) => {
                const qtype = e.target.value as QuestionType;
                const patch: Partial<DraftQuestion> = { qtype };
                // 보기가 필요한 유형으로 바꿀 때 빈 보기 2개를 미리 깔아 준다(빈 저장 400 방지).
                if (CHOICE_TYPES.includes(qtype) && question.options.length < 2) {
                  patch.options = [
                    ...question.options,
                    ...Array.from({ length: 2 - question.options.length }, (_, i) => ({
                      value: `o${Date.now().toString(36)}${i}`,
                      label: "",
                    })),
                  ];
                }
                if (qtype === "scale" && question.config.max == null) {
                  patch.config = { ...question.config, ...DEFAULT_SCALE };
                }
                if (qtype === "section") patch.isRequired = false;
                onChange(patch);
              }}
            >
              {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </CdSelect>

            {!isSection && (
              <CdCheckbox
                className="pb-2"
                label="필수 응답"
                checked={question.isRequired}
                disabled={readOnly}
                onChange={(e) => onChange({ isRequired: e.target.checked })}
              />
            )}
            {isSection && <CdBadge tone="idle">응답 없이 안내만 표시</CdBadge>}
          </div>

          <CdInput
            label={isSection ? "안내 제목" : "문항"}
            value={question.title}
            disabled={readOnly}
            placeholder={isSection ? "예) 환경 부문" : "질문을 입력하세요"}
            onChange={(e) => onChange({ title: e.target.value })}
          />

          <CdTextarea
            label="설명(선택)"
            rows={2}
            value={question.helpText ?? ""}
            disabled={readOnly}
            placeholder="응답자에게 보여줄 보충 설명"
            onChange={(e) => onChange({ helpText: e.target.value })}
          />

          {isChoice && (
            <div className="flex flex-col gap-2">
              <span className="cd-label">보기</span>
              {question.options.map((o, i) => (
                <div key={o.value} className="flex items-center gap-2">
                  <input
                    className="cd-input flex-1"
                    value={o.label}
                    disabled={readOnly}
                    placeholder={`보기 ${i + 1}`}
                    onChange={(e) => setOption(i, { label: e.target.value })}
                    aria-label={`보기 ${i + 1}`}
                  />
                  {!readOnly && question.options.length > 2 && (
                    <button
                      type="button"
                      className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]"
                      title="보기 삭제"
                      onClick={() => removeOption(i)}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm cd-text-primary"
                    onClick={addOption}
                  >
                    <Plus className="w-4 h-4" /> 보기 추가
                  </button>
                  <CdCheckbox
                    label="기타 직접 입력 허용"
                    checked={!!question.config.allowOther}
                    onChange={(e) => onChange({ config: { ...question.config, allowOther: e.target.checked } })}
                  />
                  {question.qtype === "multi" && (
                    <label className="inline-flex items-center gap-2 text-sm cd-text-muted">
                      최대 선택
                      <input
                        type="number"
                        min={0}
                        max={question.options.length}
                        className="cd-input w-20"
                        value={question.config.maxSelect ?? 0}
                        onChange={(e) =>
                          onChange({ config: { ...question.config, maxSelect: Number(e.target.value) || undefined } })
                        }
                      />
                      <span className="cd-text-faint text-xs">0 = 제한 없음</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {question.qtype === "scale" && (
            <div className="flex flex-wrap items-end gap-3">
              <CdInput
                label="최저 점수"
                type="number"
                className="w-28"
                min={0}
                max={1}
                value={question.config.min ?? DEFAULT_SCALE.min}
                disabled={readOnly}
                onChange={(e) => onChange({ config: { ...question.config, min: Number(e.target.value) } })}
              />
              <CdInput
                label="최고 점수"
                type="number"
                className="w-28"
                min={3}
                max={10}
                value={question.config.max ?? DEFAULT_SCALE.max}
                disabled={readOnly}
                onChange={(e) => onChange({ config: { ...question.config, max: Number(e.target.value) } })}
              />
              <CdInput
                label="최저 라벨"
                className="w-44"
                value={question.config.minLabel ?? ""}
                disabled={readOnly}
                placeholder="전혀 중요하지 않음"
                onChange={(e) => onChange({ config: { ...question.config, minLabel: e.target.value } })}
              />
              <CdInput
                label="최고 라벨"
                className="w-44"
                value={question.config.maxLabel ?? ""}
                disabled={readOnly}
                placeholder="매우 중요함"
                onChange={(e) => onChange({ config: { ...question.config, maxLabel: e.target.value } })}
              />
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)] disabled:opacity-40"
              title="위로"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)] disabled:opacity-40"
              title="아래로"
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]"
              title="문항 삭제"
              onClick={onRemove}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
