"use client";

// 설문 편집 — 사내/외부 공용. 탭: 설정 · 문항 · (외부)구글 폼 · (사내)집계.
// 설정은 변경 즉시 디바운스 자동저장(PATCH), 문항은 배열 전체 교체(PUT)라 "문항 저장" 버튼으로 명시 저장한다.
// 응답이 1건이라도 들어오면 문항은 잠긴다(기존 답과 문항 대응이 깨지므로 — 복제 후 수정 안내).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Check,
  Download,
  ExternalLink,
  Eye,
  ImageIcon,
  Link2,
  Loader2,
  Plus,
  Settings2,
  ListChecks,
} from "lucide-react";
import {
  CdBadge,
  CdButton,
  CdCheckbox,
  CdDateInput,
  CdInput,
  CdPageHeader,
  CdTabs,
  CdTextarea,
  useCdashTheme,
  useCdToast,
} from "@/components/cdash";
import { DEFAULT_SCALE } from "@/lib/survey/defaults";
import { buildFormScript, scriptFileName } from "@/lib/survey/gas";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/survey/display";
import type { SurveyDetail, SurveyKind, SurveyNoticeRow, SurveyStatus } from "@/lib/survey/types";
import { QuestionEditor, type DraftQuestion } from "./QuestionEditor";
import { SurveyResultsPanel } from "./SurveyResultsPanel";

const AUTOSAVE_DELAY = 1200;

type TabKey = "settings" | "questions" | "google" | "results";

interface Department {
  deptId: string;
  deptName: string;
  memberCount: number;
}

function newQuestion(): DraftQuestion {
  return {
    questionId: crypto.randomUUID(),
    qtype: "single",
    title: "",
    helpText: null,
    isRequired: false,
    options: [
      { value: `o${Date.now().toString(36)}a`, label: "" },
      { value: `o${Date.now().toString(36)}b`, label: "" },
    ],
    config: {},
  };
}

export function SurveyBuilderBoard({ surveyId, kind }: { surveyId: string; kind: SurveyKind }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isInternal = kind === "internal";
  const base = isInternal ? "/survey/internal" : "/survey/external";

  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(searchParams.get("tab") === "results" ? "results" : "settings");

  // 설정 폼 상태
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [audienceScope, setAudienceScope] = useState<"all" | "departments">("all");
  const [audienceDepts, setAudienceDepts] = useState<string[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  // 문항 상태
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [questionsDirty, setQuestionsDirty] = useState(false);
  const [savingQuestions, setSavingQuestions] = useState(false);

  // 외부 설문 — 구글 폼 연결
  const [formUrl, setFormUrl] = useState("");
  const [formEditUrl, setFormEditUrl] = useState("");
  const [notices, setNotices] = useState<SurveyNoticeRow[]>([]);
  const [creatingNotice, setCreatingNotice] = useState(false);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locked = (survey?.responseCount ?? 0) > 0;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/survey/surveys/${surveyId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "설문을 불러오지 못했습니다.");
      const s = data.survey as SurveyDetail;
      setSurvey(s);
      setTitle(s.title);
      setDescription(s.description ?? "");
      setPeriodStart(s.periodStart ?? "");
      setPeriodEnd(s.periodEnd ?? "");
      setIsAnonymous(s.isAnonymous);
      setAudienceScope(s.audience.scope);
      setAudienceDepts(s.audience.departments ?? []);
      setFormUrl(s.googleFormUrl ?? "");
      setFormEditUrl(s.googleFormEditUrl ?? "");
      setQuestions(s.questions.map(({ surveyId: _s, seq: _q, ...rest }) => rest));
      setQuestionsDirty(false);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [surveyId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 부서 목록 — 대상 지정에 쓴다(권한 없으면 조용히 비운다).
  useEffect(() => {
    if (!isInternal) return;
    void (async () => {
      try {
        const res = await fetch("/api/survey/departments", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setDepartments(data.departments as Department[]);
      } catch {
        /* 대상 지정은 선택 기능이라 실패해도 화면은 계속 쓸 수 있다 */
      }
    })();
  }, [isInternal]);

  const loadNotices = useCallback(async () => {
    try {
      const res = await fetch(`/api/survey/notices?surveyId=${surveyId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setNotices(data.notices as SurveyNoticeRow[]);
    } catch {
      /* 목록 조회 실패는 화면 이용을 막지 않는다 */
    }
  }, [surveyId]);

  useEffect(() => {
    if (!isInternal) void loadNotices();
  }, [isInternal, loadNotices]);

  // ── 설정 자동저장 ─────────────────────────────────
  const patch = useCallback(
    async (body: Record<string, unknown>, { silent = true } = {}) => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/survey/surveys/${surveyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "저장하지 못했습니다.");
        setSurvey((prev) => (prev ? { ...prev, ...(data.survey as SurveyDetail) } : prev));
        setSaveState("saved");
        if (!silent) toast("저장했습니다.", "success");
        return true;
      } catch (e) {
        setSaveState("error");
        toast((e as Error).message, "error");
        return false;
      }
    },
    [surveyId, toast]
  );

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      void patch({
        title,
        description,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        isAnonymous,
        audience: audienceScope === "departments" ? { scope: "departments", departments: audienceDepts } : { scope: "all" },
      });
    }, AUTOSAVE_DELAY);
  }, [patch, title, description, periodStart, periodEnd, isAnonymous, audienceScope, audienceDepts]);

  useEffect(() => {
    if (!survey) return;
    // 첫 로드 직후 값 세팅으로 저장이 트리거되지 않도록 원본과 비교한다.
    const changed =
      title !== survey.title ||
      description !== (survey.description ?? "") ||
      periodStart !== (survey.periodStart ?? "") ||
      periodEnd !== (survey.periodEnd ?? "") ||
      isAnonymous !== survey.isAnonymous ||
      audienceScope !== survey.audience.scope ||
      audienceDepts.join(",") !== (survey.audience.departments ?? []).join(",");
    if (changed) scheduleSave();
    // scheduleSave 는 값이 바뀔 때마다 새로 만들어지므로 의존성에서 뺀다(타이머 중복 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, periodStart, periodEnd, isAnonymous, audienceScope, audienceDepts, survey]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ── 문항 저장 ────────────────────────────────────
  const saveQuestions = useCallback(async () => {
    setSavingQuestions(true);
    try {
      const res = await fetch(`/api/survey/surveys/${surveyId}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "문항을 저장하지 못했습니다.");
      setQuestionsDirty(false);
      toast(`문항 ${questions.length}개를 저장했습니다.`, "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSavingQuestions(false);
    }
  }, [load, questions, surveyId, toast]);

  const mutateQuestions = useCallback((next: DraftQuestion[]) => {
    setQuestions(next);
    setQuestionsDirty(true);
  }, []);

  const changeStatus = useCallback(
    async (status: SurveyStatus) => {
      if (questionsDirty) {
        toast("문항을 먼저 저장하세요.", "error");
        return;
      }
      const ok = await patch({ status }, { silent: false });
      if (ok) await load();
    },
    [load, patch, questionsDirty, toast]
  );

  // ── 외부: .gs 다운로드 ───────────────────────────
  const downloadScript = useCallback(() => {
    if (!survey) return;
    const code = buildFormScript({ ...survey, questions: survey.questions });
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = scriptFileName(survey.title);
    a.click();
    URL.revokeObjectURL(url);
  }, [survey]);

  const createNotice = useCallback(async () => {
    setCreatingNotice(true);
    try {
      const res = await fetch("/api/survey/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId,
          name: `${survey?.title ?? "설문"} 배포 이미지`,
          layout: "phone",
          fields: {
            title: survey?.title ?? "",
            qrTargetUrl: formUrl || null,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "배포 이미지를 만들지 못했습니다.");
      router.push(`/survey/notices/${(data.notice as SurveyNoticeRow).noticeId}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setCreatingNotice(false);
    }
  }, [formUrl, router, survey?.title, surveyId, toast]);

  const tabs = useMemo(() => {
    const items: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
      { key: "settings", label: "설정", icon: <Settings2 className="w-4 h-4" /> },
      { key: "questions", label: "문항", icon: <ListChecks className="w-4 h-4" />, count: questions.length },
    ];
    if (!isInternal) items.push({ key: "google", label: "구글 폼·배포", icon: <Link2 className="w-4 h-4" /> });
    if (isInternal) items.push({ key: "results", label: "집계", icon: <BarChart3 className="w-4 h-4" />, count: survey?.responseCount ?? 0 });
    return items;
  }, [isInternal, questions.length, survey?.responseCount]);

  if (loadError) {
    return (
      <div className="cdash min-h-screen p-6" data-theme={theme}>
        <div className="rounded-2xl border cd-border-c cd-card-bg p-8 text-center">
          <p className="cd-text mb-4">{loadError}</p>
          <CdButton onClick={() => router.push(base)}>목록으로</CdButton>
        </div>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="cdash min-h-screen p-6 flex items-center justify-center" data-theme={theme}>
        <span className="inline-flex items-center gap-2 text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </span>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "설문" }, { label: isInternal ? "사내 설문" : "외부 설문", href: base }, { label: survey.title }]}
        title={survey.title}
        meta={
          <span className="inline-flex items-center gap-2">
            <CdBadge tone={STATUS_TONES[survey.status]}>{STATUS_LABELS[survey.status]}</CdBadge>
            {saveState === "saving" && (
              <span className="inline-flex items-center gap-1 text-xs cd-text-faint">
                <Loader2 className="w-3 h-3 animate-spin" /> 저장 중
              </span>
            )}
            {saveState === "saved" && (
              <span className="inline-flex items-center gap-1 text-xs cd-text-faint">
                <Check className="w-3 h-3" /> 저장됨
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex gap-2">
            <CdButton variant="ghost" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push(base)}>
              목록
            </CdButton>
            {isInternal && survey.status !== "draft" && (
              <CdButton variant="soft" icon={<Eye className="w-4 h-4" />} onClick={() => router.push(`${base}/${surveyId}/respond`)}>
                응답 화면
              </CdButton>
            )}
            {survey.status === "draft" && (
              <CdButton variant="primary" onClick={() => void changeStatus("open")}>
                응답 접수 시작
              </CdButton>
            )}
            {survey.status === "open" && (
              <CdButton variant="soft" onClick={() => void changeStatus("closed")}>
                마감
              </CdButton>
            )}
            {survey.status === "closed" && (
              <CdButton variant="soft" onClick={() => void changeStatus("open")}>
                접수 재개
              </CdButton>
            )}
          </div>
        }
      />

      <CdTabs items={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} className="mb-5" />

      {tab === "settings" && (
        <div className="rounded-2xl border cd-border-c cd-card-bg p-6 flex flex-col gap-5" style={{ maxWidth: 780 }}>
          <CdInput label="설문 제목" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <CdTextarea
            label="안내문"
            rows={3}
            hint="응답 화면 상단에 보여줄 설문 취지·처리 방침."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex flex-wrap gap-4">
            <CdDateInput label="접수 시작일" value={periodStart} onChange={setPeriodStart} className="w-44" />
            <CdDateInput label="접수 종료일" value={periodEnd} onChange={setPeriodEnd} className="w-44" />
            <span className="self-end pb-2 text-xs cd-text-faint">비우면 상시 접수</span>
          </div>

          <CdCheckbox
            label={isInternal ? "익명 설문 (집계에서 응답자를 표시하지 않음)" : "익명 설문 (구글 폼에서 이메일 수집 안 함)"}
            checked={isAnonymous}
            onChange={(e) => setIsAnonymous(e.target.checked)}
          />
          {isInternal && isAnonymous && (
            <p className="text-xs cd-text-faint -mt-3">
              중복 응답을 막기 위해 “누가 응답했는지”는 시스템에 남지만, 집계 화면과 다운로드에는 응답자가 나오지 않습니다.
            </p>
          )}

          {isInternal && (
            <div className="flex flex-col gap-2">
              <span className="cd-label">응답 대상</span>
              <div className="flex gap-4">
                <label className="inline-flex items-center gap-2 text-sm cd-text cursor-pointer">
                  <input
                    type="radio"
                    name="audience"
                    className="accent-[var(--cd-primary)]"
                    checked={audienceScope === "all"}
                    onChange={() => setAudienceScope("all")}
                  />
                  전 직원
                </label>
                <label className="inline-flex items-center gap-2 text-sm cd-text cursor-pointer">
                  <input
                    type="radio"
                    name="audience"
                    className="accent-[var(--cd-primary)]"
                    checked={audienceScope === "departments"}
                    onChange={() => setAudienceScope("departments")}
                  />
                  특정 부서
                </label>
              </div>
              {audienceScope === "departments" && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {departments.length === 0 ? (
                    <span className="text-xs cd-text-faint">부서 목록을 불러올 수 없습니다.</span>
                  ) : (
                    departments.map((d) => {
                      const on = audienceDepts.includes(d.deptId);
                      return (
                        <button
                          key={d.deptId}
                          type="button"
                          className={`cd-action text-sm px-3 py-1.5 border ${on ? "cd-soft-primary cd-text-primary" : "cd-border-c cd-text-muted"}`}
                          onClick={() =>
                            setAudienceDepts((prev) => (on ? prev.filter((x) => x !== d.deptId) : [...prev, d.deptId]))
                          }
                        >
                          {d.deptName} <span className="cd-text-faint">{d.memberCount}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "questions" && (
        <div className="flex flex-col gap-4" style={{ maxWidth: 900 }}>
          {locked && (
            <div className="rounded-2xl border cd-border-c cd-soft-warn px-5 py-3 text-sm cd-text">
              응답 {survey.responseCount}건이 접수되어 문항을 수정할 수 없습니다. 문항을 바꾸려면 목록에서 이 설문을 복제하세요.
            </div>
          )}
          {questions.map((q, i) => (
            <QuestionEditor
              key={q.questionId}
              question={q}
              index={i}
              total={questions.length}
              readOnly={locked}
              onChange={(p) => mutateQuestions(questions.map((x, xi) => (xi === i ? { ...x, ...p } : x)))}
              onRemove={() => mutateQuestions(questions.filter((_, xi) => xi !== i))}
              onMove={(delta) => {
                const j = i + delta;
                if (j < 0 || j >= questions.length) return;
                const next = [...questions];
                [next[i], next[j]] = [next[j], next[i]];
                mutateQuestions(next);
              }}
            />
          ))}
          {!locked && (
            <div className="flex items-center gap-2">
              <CdButton variant="soft" icon={<Plus className="w-4 h-4" />} onClick={() => mutateQuestions([...questions, newQuestion()])}>
                문항 추가
              </CdButton>
              <CdButton
                variant="soft"
                icon={<Plus className="w-4 h-4" />}
                onClick={() =>
                  mutateQuestions([
                    ...questions,
                    { ...newQuestion(), qtype: "scale", options: [], config: { ...DEFAULT_SCALE } },
                  ])
                }
              >
                척도 문항 추가
              </CdButton>
              <div className="flex-1" />
              <CdButton variant="primary" disabled={!questionsDirty || savingQuestions} onClick={() => void saveQuestions()}>
                {savingQuestions ? "저장 중…" : questionsDirty ? "문항 저장" : "저장됨"}
              </CdButton>
            </div>
          )}
        </div>
      )}

      {tab === "google" && (
        <div className="flex flex-col gap-5" style={{ maxWidth: 780 }}>
          <div className="rounded-2xl border cd-border-c cd-card-bg p-6 flex flex-col gap-4">
            <div>
              <h3 className="font-semibold cd-text mb-1">1) 구글 폼 만들기</h3>
              <p className="text-sm cd-text-muted">
                문항 탭에서 만든 초안을 Apps Script 코드로 내려받아 <code>script.google.com</code> 새 프로젝트에 붙여넣고
                <code> createSurveyForm</code> 을 실행하면 폼이 생성됩니다. 실행 로그의 응답 URL을 아래에 붙여 넣으세요.
              </p>
            </div>
            <div className="flex gap-2">
              <CdButton variant="soft" icon={<Download className="w-4 h-4" />} onClick={downloadScript}>
                Apps Script(.gs) 내려받기
              </CdButton>
              <CdButton
                variant="ghost"
                icon={<ExternalLink className="w-4 h-4" />}
                onClick={() => window.open("https://script.google.com/home/projects/create", "_blank", "noopener")}
              >
                Apps Script 열기
              </CdButton>
            </div>
          </div>

          <div className="rounded-2xl border cd-border-c cd-card-bg p-6 flex flex-col gap-4">
            <h3 className="font-semibold cd-text">2) 링크 연결</h3>
            <CdInput
              label="응답 URL (QR 대상)"
              value={formUrl}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
              onChange={(e) => setFormUrl(e.target.value)}
            />
            <CdInput
              label="편집 URL (선택)"
              value={formEditUrl}
              placeholder="https://docs.google.com/forms/d/.../edit"
              onChange={(e) => setFormEditUrl(e.target.value)}
            />
            <div className="flex gap-2">
              <CdButton
                variant="primary"
                onClick={() => void patch({ googleFormUrl: formUrl || null, googleFormEditUrl: formEditUrl || null }, { silent: false })}
              >
                링크 저장
              </CdButton>
              {survey.googleFormUrl && (
                <CdButton
                  variant="ghost"
                  icon={<ExternalLink className="w-4 h-4" />}
                  onClick={() => window.open(survey.googleFormUrl!, "_blank", "noopener")}
                >
                  폼 열기
                </CdButton>
              )}
            </div>
          </div>

          <div className="rounded-2xl border cd-border-c cd-card-bg p-6 flex flex-col gap-4">
            <div>
              <h3 className="font-semibold cd-text mb-1">3) QR 배포 이미지</h3>
              <p className="text-sm cd-text-muted">
                응답 URL을 QR로 변환해 배포 이미지를 만듭니다. 대상 기관 로고를 올리면 CI 색상을 검출해 상단 띠에 적용합니다.
              </p>
            </div>
            {notices.length > 0 && (
              <ul className="flex flex-col gap-2">
                {notices.map((n) => (
                  <li key={n.noticeId}>
                    <button
                      type="button"
                      className="w-full text-left rounded-xl border cd-border-c px-4 py-3 text-sm hover:cd-soft-primary"
                      onClick={() => router.push(`/survey/notices/${n.noticeId}`)}
                    >
                      <span className="font-medium cd-text">{n.name}</span>
                      <span className="ml-2 cd-text-faint text-xs">
                        {n.layout === "phone" ? "스마트폰 1080×1920" : "메일 1600×900"} · {n.updatedAt.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <CdButton
                variant="soft"
                icon={<ImageIcon className="w-4 h-4" />}
                disabled={creatingNotice}
                onClick={() => void createNotice()}
              >
                {creatingNotice ? "생성 중…" : "배포 이미지 새로 만들기"}
              </CdButton>
            </div>
          </div>
        </div>
      )}

      {tab === "results" && <SurveyResultsPanel surveyId={surveyId} />}
    </div>
  );
}
