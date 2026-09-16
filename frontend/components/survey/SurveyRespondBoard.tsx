"use client";

// 사내 설문 응답 화면 — 전 직원용. 문항 유형별 입력 + 필수 검증 후 1회 제출.
// 이미 응답한 설문은 제출 폼 대신 완료 안내를 보여준다(수정 제출은 받지 않는다).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { CdBadge, CdButton, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import { OTHER_VALUE } from "@/lib/survey/defaults";
import { formatPeriod } from "@/lib/survey/display";
import type { AnswerMap, SurveyDetail, SurveyQuestion } from "@/lib/survey/types";

interface LoadState {
  survey: SurveyDetail;
  open: boolean;
  myResponse: { responseId: string; submittedAt: string } | null;
}

/** "__other__:자유문구" 에서 자유문구만. */
function otherText(raw: unknown): string {
  const s = String(raw ?? "");
  return s.startsWith(`${OTHER_VALUE}:`) ? s.slice(OTHER_VALUE.length + 1) : "";
}

export function SurveyRespondBoard({ surveyId }: { surveyId: string }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();

  const [state, setState] = useState<LoadState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/survey/surveys/${surveyId}/responses`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "설문을 불러오지 못했습니다.");
        setState(data as LoadState);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [surveyId]);

  const questions = state?.survey.questions ?? [];
  const answerable = useMemo(() => questions.filter((q) => q.qtype !== "section"), [questions]);

  const setAnswer = useCallback((questionId: string, value: AnswerMap[string]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }, []);

  const missing = useMemo(
    () =>
      answerable.filter((q) => {
        if (!q.isRequired) return false;
        const v = answers[q.questionId];
        if (v == null) return true;
        if (Array.isArray(v)) return v.length === 0;
        if (typeof v === "string") return v.trim() === "" || v === `${OTHER_VALUE}:`;
        return false;
      }),
    [answerable, answers]
  );

  const submit = useCallback(async () => {
    if (missing.length > 0) {
      toast(`필수 문항 ${missing.length}개가 비어 있습니다.`, "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/survey/surveys/${surveyId}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, source: "web" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "제출하지 못했습니다.");
      setDone(true);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }, [answers, missing.length, surveyId, toast]);

  if (error) {
    return (
      <div className="cdash min-h-screen p-6" data-theme={theme}>
        <div className="rounded-2xl border cd-border-c cd-card-bg p-8 text-center mx-auto" style={{ maxWidth: 560 }}>
          <p className="cd-text mb-4">{error}</p>
          <CdButton onClick={() => router.push("/survey/internal")}>설문 목록으로</CdButton>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="cdash min-h-screen p-6 flex items-center justify-center" data-theme={theme}>
        <span className="inline-flex items-center gap-2 text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </span>
      </div>
    );
  }

  const { survey } = state;
  const already = done || !!state.myResponse;

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <div className="mx-auto" style={{ maxWidth: 760 }}>
        <CdPageHeader
          breadcrumbs={[{ label: "설문" }, { label: "사내 설문", href: "/survey/internal" }, { label: survey.title }]}
          title={survey.title}
          meta={
            <span className="inline-flex items-center gap-2 text-xs cd-text-faint">
              {formatPeriod(survey) || "상시 접수"}
              <span>·</span>
              {answerable.length}개 문항
              {survey.isAnonymous && <CdBadge tone="idle">익명</CdBadge>}
            </span>
          }
          actions={
            <CdButton variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push("/survey/internal")}>
              목록
            </CdButton>
          }
        />

        {survey.description && (
          <div className="rounded-2xl border cd-border-c cd-card-bg p-5 mb-5 text-sm cd-text whitespace-pre-wrap">
            {survey.description}
          </div>
        )}

        {already ? (
          <div className="rounded-2xl border cd-border-c cd-card-bg p-8 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--cd-success)" }} />
            <p className="font-semibold cd-text mb-1">응답이 제출되었습니다</p>
            <p className="text-sm cd-text-muted mb-5">참여해 주셔서 감사합니다. 제출한 응답은 수정할 수 없습니다.</p>
            <CdButton variant="soft" onClick={() => router.push("/survey/internal")}>
              설문 목록으로
            </CdButton>
          </div>
        ) : !state.open ? (
          <div className="rounded-2xl border cd-border-c cd-card-bg p-8 text-center">
            <p className="cd-text mb-1">지금은 응답을 받지 않습니다.</p>
            <p className="text-sm cd-text-muted">{formatPeriod(survey) ? `접수 기간: ${formatPeriod(survey)}` : "설문이 마감되었습니다."}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {questions.map((q, i) => (
              <QuestionField
                key={q.questionId}
                question={q}
                index={answerable.findIndex((a) => a.questionId === q.questionId)}
                value={answers[q.questionId]}
                onChange={(v) => setAnswer(q.questionId, v)}
                invalid={missing.some((m) => m.questionId === q.questionId)}
              />
            ))}

            <div className="flex items-center gap-3 pt-2 pb-10">
              <CdButton variant="primary" disabled={submitting} onClick={() => void submit()}>
                {submitting ? "제출 중…" : "응답 제출"}
              </CdButton>
              <span className="text-xs cd-text-faint">제출 후에는 수정할 수 없습니다.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionField({
  question: q,
  index,
  value,
  onChange,
  invalid,
}: {
  question: SurveyQuestion;
  index: number;
  value: AnswerMap[string];
  onChange: (v: AnswerMap[string]) => void;
  invalid: boolean;
}) {
  if (q.qtype === "section") {
    return (
      <div className="pt-4">
        <h2 className="text-base font-semibold cd-text">{q.title}</h2>
        {q.helpText && <p className="text-sm cd-text-muted mt-1 whitespace-pre-wrap">{q.helpText}</p>}
      </div>
    );
  }

  const selected = Array.isArray(value) ? value : [];
  const single = typeof value === "string" ? value : "";

  return (
    <div
      className="rounded-2xl border cd-card-bg p-5"
      style={{ borderColor: invalid ? "var(--cd-error)" : "var(--cd-border)" }}
    >
      <div className="mb-3">
        <h3 className="font-semibold cd-text">
          <span className="cd-text-faint mr-2">{index + 1}.</span>
          {q.title}
          {q.isRequired && <span className="cd-error-text ml-1">*</span>}
        </h3>
        {q.helpText && <p className="text-sm cd-text-muted mt-1 whitespace-pre-wrap">{q.helpText}</p>}
      </div>

      {q.qtype === "single" && (
        <div className="flex flex-col gap-2">
          {q.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-2 text-sm cd-text cursor-pointer">
              <input
                type="radio"
                name={q.questionId}
                className="accent-[var(--cd-primary)]"
                checked={single.split(":", 1)[0] === o.value}
                onChange={() => onChange(o.value)}
              />
              {o.label}
            </label>
          ))}
          {q.config.allowOther && (
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm cd-text cursor-pointer">
                <input
                  type="radio"
                  name={q.questionId}
                  className="accent-[var(--cd-primary)]"
                  checked={single.startsWith(OTHER_VALUE)}
                  onChange={() => onChange(`${OTHER_VALUE}:`)}
                />
                기타
              </label>
              <input
                className="cd-input flex-1"
                value={otherText(single)}
                placeholder="직접 입력"
                onChange={(e) => onChange(`${OTHER_VALUE}:${e.target.value}`)}
                aria-label="기타 직접 입력"
              />
            </div>
          )}
        </div>
      )}

      {q.qtype === "multi" && (
        <div className="flex flex-col gap-2">
          {q.options.map((o) => {
            const on = selected.some((v) => String(v).split(":", 1)[0] === o.value);
            return (
              <label key={o.value} className="inline-flex items-center gap-2 text-sm cd-text cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[var(--cd-primary)]"
                  checked={on}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => String(v).split(":", 1)[0] !== o.value))
                  }
                />
                {o.label}
              </label>
            );
          })}
          {q.config.maxSelect ? (
            <span className="text-xs cd-text-faint">최대 {q.config.maxSelect}개 선택</span>
          ) : null}
        </div>
      )}

      {q.qtype === "scale" && (
        <div className="flex flex-wrap items-center gap-2">
          {q.config.minLabel && <span className="text-xs cd-text-faint mr-1">{q.config.minLabel}</span>}
          {Array.from({ length: (q.config.max ?? 5) - (q.config.min ?? 1) + 1 }, (_, i) => (q.config.min ?? 1) + i).map((n) => {
            const on = Number(value) === n;
            return (
              <button
                key={n}
                type="button"
                className={`cd-action w-11 h-11 border text-sm font-semibold ${on ? "cd-soft-primary cd-text-primary" : "cd-border-c cd-text-muted"}`}
                onClick={() => onChange(n)}
                aria-pressed={on}
              >
                {n}
              </button>
            );
          })}
          {q.config.maxLabel && <span className="text-xs cd-text-faint ml-1">{q.config.maxLabel}</span>}
        </div>
      )}

      {q.qtype === "text" && (
        <input
          className="cd-input w-full"
          value={single}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
          aria-label={q.title}
        />
      )}

      {q.qtype === "longtext" && (
        <textarea
          className="cd-input w-full"
          rows={4}
          value={single}
          maxLength={5000}
          onChange={(e) => onChange(e.target.value)}
          aria-label={q.title}
        />
      )}
    </div>
  );
}
