"use client";

// 일정 메뉴(G6-C) 하단 카테고리별 상세 스케줄 태그 카드 — 켜진 태그 순서대로 섹션 반복.
// 카드 = 스케줄명(서버 조립 규칙) / 대상 인원 성명(휴가는 제목에 이름이 있어 생략) / 일시 / 요약 1줄.
// 본인(self) 카드에만 연관 전자결재 문서 진입 버튼을 둔다 — 타인 문서는 열람 권한·프라이버시 문제.

import { forwardRef } from "react";
import Link from "next/link";
import { ExternalLink, FileText, Pencil, Eye } from "lucide-react";
import {
  CALENDAR_KIND_LABELS,
  CALENDAR_TAG_LABELS,
  TAG_COLOR,
  TAG_COLOR_STRONG,
  type CalendarEvent,
  type CalendarTagKey,
} from "@/lib/calendar/types";

function fmtDate(ev: CalendarEvent): string {
  const s = ev.startDate.slice(5).replace("-", ".");
  const e = ev.endDate.slice(5).replace("-", ".");
  const range = ev.endDate !== ev.startDate ? `${s} ~ ${e}` : s;
  if (!ev.startTime) return range;
  return ev.endTime ? `${range} ${ev.startTime}~${ev.endTime}` : `${range} ${ev.startTime}`;
}

export const CategoryScheduleList = forwardRef<
  HTMLDivElement,
  {
    tags: CalendarTagKey[];
    events: CalendarEvent[];
    /** 캘린더 바 클릭으로 강조할 이벤트 id */
    highlightId: string | null;
    onOpenDoc: (docId: string) => void;
    /** 직접 등록 일정(회의·면접·미팅) 상세/편집 모달 열기 */
    onOpenEntry?: (entryId: string) => void;
  }
>(function CategoryScheduleList({ tags, events, highlightId, onOpenDoc, onOpenEntry }, ref) {
  return (
    <div ref={ref} className="cd-card p-4 gap-4">
      {tags.map((tag) => {
        const list = events.filter((ev) => ev.tag === tag);
        return (
          <section key={tag} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-[13px] font-extrabold cd-text">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: TAG_COLOR_STRONG[tag] }} />
              {CALENDAR_TAG_LABELS[tag]}
              <span className="text-[11px] font-bold cd-text-faint">({list.length})</span>
            </h3>
            {list.length === 0 ? (
              <p className="text-xs cd-text-faint pl-4">이 달 일정이 없습니다.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {list.map((ev) => {
                  const people = ev.people.map((p) => `${p.name}${p.positionName ? ` ${p.positionName}` : ""}`).join(", ");
                  const highlighted = highlightId === ev.id;
                  // --cd-border 는 글라스 하이라이트라 밝은 캔버스에서 사라진다(cdash.css §박스 경계)
                  // → 다른 화면 카드 관례대로 컨트롤 윤곽선(--cd-line). 강조는 진한 대응색.
                  // ⚠ borderColor(4방향 단축)와 borderLeftColor 를 섞으면 React 가 단축을 빈 값으로
                  // 지워버린다(실측) — 4방향을 전부 개별 속성으로 분해해서 지정한다.
                  const edge = highlighted ? TAG_COLOR_STRONG[ev.tag] : "var(--cd-line)";
                  return (
                    <div
                      key={ev.id}
                      data-event-id={ev.id}
                      className={`rounded-xl border p-3 flex flex-col gap-1 transition-colors ${ev.canceled ? "opacity-55" : ""}`}
                      style={{
                        borderTopColor: edge,
                        borderRightColor: edge,
                        borderBottomColor: edge,
                        borderLeftColor: TAG_COLOR[ev.tag],
                        borderLeftWidth: 3,
                        boxShadow: highlighted ? `inset 0 0 0 1px ${TAG_COLOR_STRONG[ev.tag]}` : undefined,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span className="flex-1 min-w-0 text-[13px] font-bold cd-text truncate" title={ev.title}>
                          {ev.title}
                        </span>
                        {ev.canceled && (
                          <span className="shrink-0 text-[10px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint">미시행</span>
                        )}
                        {ev.entryId && onOpenEntry && (
                          <button
                            type="button"
                            className="shrink-0 p-1 rounded-md cd-text-faint hover:text-[color:var(--cd-primary)]"
                            title={ev.canEdit ? "일정 편집" : "일정 상세"}
                            onClick={() => onOpenEntry(ev.entryId!)}
                          >
                            {ev.canEdit ? <Pencil className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {ev.status === "in_progress" && (
                          <span className="shrink-0 text-[10px] rounded-full px-1.5 py-0.5 border cd-border-c cd-text-faint">결재중</span>
                        )}
                        {tag === "self" && ev.docId && (
                          <button
                            type="button"
                            className="shrink-0 p-1 rounded-md cd-text-faint hover:text-[color:var(--cd-primary)]"
                            title="연관 결재 문서 열기"
                            onClick={() => onOpenDoc(ev.docId!)}
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {ev.kind === "sales" && ev.salesProjectId && (
                          <Link
                            href={`/sales/${ev.salesProjectId}`}
                            className="shrink-0 p-1 rounded-md cd-text-faint hover:text-[color:var(--cd-primary)]"
                            title="영업 스케줄 상세 관리로 이동"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Link>
                        )}
                      </div>
                      <div className="text-[11.5px] cd-text-muted tabular-nums">
                        {fmtDate(ev)}
                        <span className="ml-1.5 text-[10.5px] cd-text-faint">{CALENDAR_KIND_LABELS[ev.kind]}</span>
                      </div>
                      {people && <div className="text-[11.5px] cd-text-muted truncate">{people}</div>}
                      {ev.summary && (
                        <div className="text-[11px] cd-text-faint truncate" title={ev.summary}>
                          {ev.summary}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {tags.length === 0 && <p className="text-sm cd-text-faint py-4 text-center">표시할 카테고리를 위에서 선택하세요.</p>}
    </div>
  );
});
