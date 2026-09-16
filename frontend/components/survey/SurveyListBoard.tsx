"use client";

// 설문 목록 — 사내(/survey/internal) · 외부(/survey/external) 공용.
// 사내는 전 직원이 들어오는 화면이라 "참여할 설문"(내 대상)과 "설문 관리"(survey.manage)를 나눠 보여준다.
// 관리 권한 여부는 별도 API 없이 관리 목록(GET /api/survey/surveys) 의 403 으로 판정한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  ClipboardCheck,
  ClipboardList,
  Copy,
  ExternalLink,
  FilePlus2,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
} from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { SurveyKind, SurveyRow } from "@/lib/survey/types";
import { STATUS_LABELS, STATUS_TONES, formatPeriod, periodNote } from "@/lib/survey/display";

export function SurveyListBoard({ kind }: { kind: SurveyKind }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();

  const [surveys, setSurveys] = useState<SurveyRow[] | null>(null);
  const [mine, setMine] = useState<SurveyRow[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SurveyRow | null>(null);
  const [fStatus, setFStatus] = useState("");
  const [q, setQ] = useState("");

  const isInternal = kind === "internal";
  const base = isInternal ? "/survey/internal" : "/survey/external";

  const load = useCallback(async () => {
    // 관리 목록 — 권한이 없으면 403 이 정상 흐름이다(참여 화면만 쓰는 직원).
    try {
      const res = await fetch(`/api/survey/surveys?kind=${kind}`, { cache: "no-store" });
      if (res.status === 403) {
        setCanManage(false);
        setSurveys([]);
      } else {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "목록을 불러오지 못했습니다.");
        setCanManage(true);
        setSurveys(data.surveys as SurveyRow[]);
      }
    } catch (e) {
      toast((e as Error).message, "error");
      setSurveys([]);
    }
    if (isInternal) {
      try {
        const res = await fetch("/api/survey/my", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) setMine(data.surveys as SurveyRow[]);
        else setMine([]);
      } catch {
        setMine([]);
      }
    }
  }, [kind, isInternal, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (surveys ?? []).filter(
      (s) => (!fStatus || s.status === fStatus) && (!needle || s.title.toLowerCase().includes(needle))
    );
  }, [surveys, fStatus, q]);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/survey/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: isInternal ? "새 사내 설문" : "새 외부 설문" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "설문 생성 실패");
      router.push(`${base}/${(data.survey as SurveyRow).surveyId}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setCreating(false);
    }
  }, [base, isInternal, kind, router, toast]);

  const duplicate = useCallback(
    async (s: SurveyRow) => {
      setDuplicating(s.surveyId);
      try {
        const res = await fetch("/api/survey/surveys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copyFrom: s.surveyId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "설문 복제 실패");
        router.push(`${base}/${(data.survey as SurveyRow).surveyId}`);
      } catch (e) {
        toast((e as Error).message, "error");
        setDuplicating(null);
      }
    },
    [base, router, toast]
  );

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`/api/survey/surveys/${confirmDelete.surveyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error || "삭제 실패");
      toast("설문을 삭제했습니다.", "success");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [confirmDelete, load, toast]);

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "설문" }, { label: isInternal ? "사내 설문" : "외부 설문" }]}
        title={isInternal ? "사내 설문" : "외부 설문"}
        meta={
          canManage && surveys
            ? filtered.length === surveys.length
              ? `${surveys.length}건`
              : `${filtered.length}건 / 전체 ${surveys.length}건`
            : ""
        }
        actions={
          canManage ? (
            <div className="flex gap-2">
              {!isInternal && (
                <CdButton variant="soft" icon={<ImageIcon className="w-4 h-4" />} onClick={() => router.push("/survey/notices")}>
                  QR 배포 이미지
                </CdButton>
              )}
              <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} disabled={creating} onClick={() => void create()}>
                {creating ? "생성 중…" : "새 설문 작성"}
              </CdButton>
            </div>
          ) : undefined
        }
      />

      {/* 참여할 설문 — 사내 전용. 로그인 사용자가 대상이고 접수 중인 설문만 나온다. */}
      {isInternal && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold cd-text mb-3">참여할 설문</h2>
          {mine === null ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm cd-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
            </div>
          ) : mine.length === 0 ? (
            <div className="rounded-2xl border cd-border-c cd-card-bg px-5 py-6 text-sm cd-text-muted">
              지금 참여할 수 있는 설문이 없습니다.
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
              {mine.map((s) => (
                <button
                  key={s.surveyId}
                  type="button"
                  className="rounded-2xl border cd-border-c cd-card-bg p-5 text-left transition-colors hover:cd-soft-primary"
                  onClick={() => router.push(`${base}/${s.surveyId}/respond`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-semibold cd-text">{s.title}</span>
                    {s.respondedAt ? (
                      <CdBadge tone="success">응답 완료</CdBadge>
                    ) : (
                      <CdBadge tone="info">참여 가능</CdBadge>
                    )}
                  </div>
                  {s.description && <p className="mt-2 text-sm cd-text-muted line-clamp-2">{s.description}</p>}
                  <div className="mt-3 flex items-center gap-3 text-xs cd-text-faint">
                    <span>{formatPeriod(s) || "상시"}</span>
                    <span>{s.questionCount ?? 0}개 문항</span>
                    {s.isAnonymous && <span>익명</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!canManage ? null : (
        <section>
          {isInternal && <h2 className="text-sm font-semibold cd-text mb-3">설문 관리</h2>}

          {surveys !== null && surveys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <select className="cd-select" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="상태">
                <option value="">상태: 전체</option>
                <option value="draft">작성 중</option>
                <option value="open">응답 접수</option>
                <option value="closed">마감</option>
              </select>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
                <input
                  className="cd-input pl-8"
                  style={{ width: 240 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="제목 검색"
                  aria-label="제목 검색"
                />
              </div>
              {(fStatus || q) && (
                <CdButton size="sm" onClick={() => { setFStatus(""); setQ(""); }}>
                  초기화
                </CdButton>
              )}
            </div>
          )}

          {surveys === null ? (
            <div className="flex items-center gap-2 py-20 justify-center text-sm cd-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
            </div>
          ) : surveys.length === 0 ? (
            <CdEmptyState
              icon={isInternal ? <ClipboardCheck className="w-6 h-6" /> : <ExternalLink className="w-6 h-6" />}
              title="작성된 설문이 없습니다"
              description={
                isInternal
                  ? "직원 의견이 필요한 사안을 설문으로 만들어 보세요. 문항을 만들고 접수를 시작하면 전 직원이 앱에서 응답합니다."
                  : "외부 이해관계자용 설문 초안을 만들고, 구글 폼으로 발행한 뒤 QR 배포 이미지를 생성합니다."
              }
              action={
                <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} onClick={() => void create()}>
                  새 설문 작성
                </CdButton>
              }
            />
          ) : filtered.length === 0 ? (
            <CdEmptyState icon={<Search className="w-6 h-6" />} title="검색 조건에 맞는 설문이 없습니다" description="상태·제목 조건을 바꾸거나 초기화하세요." />
          ) : (
            <div className="rounded-2xl border cd-border-c cd-card-bg overflow-hidden" style={{ boxShadow: "var(--cd-shadow)" }}>
              <table className="w-full text-sm">
                <thead className="cd-table-head">
                  <tr className="text-left text-xs cd-text-muted">
                    <th className="px-5 py-3 font-semibold">설문 제목</th>
                    <th className="px-4 py-3 font-semibold">상태</th>
                    <th className="px-4 py-3 font-semibold">기간</th>
                    <th className="px-4 py-3 font-semibold">문항</th>
                    <th className="px-4 py-3 font-semibold">{isInternal ? "응답" : "구글 폼"}</th>
                    <th className="px-4 py-3 font-semibold">최근 수정</th>
                    <th className="px-4 py-3 font-semibold w-28"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.surveyId}
                      className="cursor-pointer transition-colors hover:cd-soft-primary"
                      style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}
                      onClick={() => router.push(`${base}/${s.surveyId}`)}
                    >
                      <td className="px-5 py-3.5 font-semibold cd-text">{s.title}</td>
                      <td className="px-4 py-3.5">
                        <CdBadge tone={STATUS_TONES[s.status]}>{STATUS_LABELS[s.status]}</CdBadge>
                      </td>
                      <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">
                        {formatPeriod(s) || "상시"}
                        {periodNote(s) && <span className="ml-1 text-xs cd-text-faint">{periodNote(s)}</span>}
                      </td>
                      <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">{s.questionCount ?? 0}개</td>
                      <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">
                        {isInternal ? (
                          `${s.responseCount ?? 0}건`
                        ) : s.googleFormUrl ? (
                          <span className="inline-flex items-center gap-1 cd-text-primary">
                            <ExternalLink className="w-3.5 h-3.5" /> 연결됨
                          </span>
                        ) : (
                          "미연결"
                        )}
                      </td>
                      <td className="px-4 py-3.5 cd-text-faint whitespace-nowrap">{s.updatedAt.slice(0, 10)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          {isInternal && (s.responseCount ?? 0) > 0 && (
                            <button
                              type="button"
                              className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)]"
                              title="집계 보기"
                              onClick={() => router.push(`${base}/${s.surveyId}?tab=results`)}
                            >
                              <BarChart3 className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)]"
                            title="복제해서 새 설문 작성 (문항까지 복사)"
                            disabled={duplicating !== null}
                            onClick={() => void duplicate(s)}
                          >
                            {duplicating === s.surveyId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]"
                            title="삭제"
                            onClick={() => setConfirmDelete(s)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!canManage && !isInternal && (
        <CdEmptyState
          icon={<ClipboardList className="w-6 h-6" />}
          title="외부 설문을 볼 권한이 없습니다"
          description="외부 설문 작성·열람은 survey.view 권한이 필요합니다. 관리자에게 문의하세요."
        />
      )}

      <CdModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="설문 삭제"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setConfirmDelete(null)}>취소</CdButton>
            <CdButton variant="danger" onClick={() => void doDelete()}>
              삭제
            </CdButton>
          </div>
        }
      >
        <p className="text-sm cd-text">
          <strong>{confirmDelete?.title}</strong> 설문을 삭제합니다.
          {(confirmDelete?.responseCount ?? 0) > 0 && (
            <>
              {" "}
              접수된 응답 {confirmDelete?.responseCount}건도 함께 조회할 수 없게 됩니다.
            </>
          )}
        </p>
      </CdModal>
    </div>
  );
}
