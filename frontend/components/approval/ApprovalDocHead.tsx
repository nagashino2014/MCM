"use client";

// 결재 문서 상단(다우식 양식) — 중앙 큰 제목 + 좌 기안 정보 표 + 우 신청란/승인란.
// Soft Glass Ink 확정 시안: 표선 --cd-form-line(-strong), 라벨셀 --cd-form-label,
// 승인 도장은 원형 2px --cd-stamp 보더에 '승인' -8deg, 내 차례 셀은 프라이머리 틴트.
// steps 가 없으면(기안 작성 화면) 승인란은 렌더하지 않는다.

export interface DocHeadStep {
  stepId: string;
  stepType: string;
  assigneeName: string | null;
  assigneeUserId: string;
  assigneePosition: string | null;
  status: string;
  actedAt: string | null;
}

export interface DocHeadInfo {
  /** 중앙 큰 제목 — 보통 양식명(지출결의서 등). */
  formName?: string;
  drafterName?: string;
  deptName?: string;
  draftDate?: string;
  docNo?: string;
  steps?: DocHeadStep[];
  /** 내 차례인 단계(틴트 + '내 차례' 표기). */
  myStepId?: string | null;
}

/** "2026-07-28 09:41" → "2026/07/28" */
const stampDate = (s: string | null): string => (s ? s.slice(0, 10).replace(/-/g, "/") : "");

const LINE = "var(--cd-form-line)";
const LINE_STRONG = "var(--cd-form-line-strong)";

/** 승인 도장 — 원형 보더 + 살짝 기울인 '승인'. */
function Stamp({ label = "승인" }: { label?: string }) {
  return (
    <span
      className="w-[30px] h-[30px] rounded-full inline-flex items-center justify-center text-[9.5px] font-extrabold"
      style={{ border: `2px solid var(--cd-stamp)`, color: "var(--cd-stamp)", transform: "rotate(-8deg)" }}
    >
      {label}
    </span>
  );
}

/** 신청란/승인란 공통 — 세로 라벨 + 직급/서명/날짜 3단 셀. */
function SignBox({ label, cells }: { label: string; cells: DocHeadStep[] }) {
  return (
    <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: `1px solid ${LINE_STRONG}` }}>
      <span
        className="w-[26px] flex items-center justify-center text-[11.5px] font-extrabold text-center leading-[1.5] whitespace-pre-line"
        style={{ background: "var(--cd-form-label)", color: "var(--cd-body)", borderRight: `1px solid ${LINE}` }}
      >
        {label.split("").join("\n")}
      </span>
      {cells.map((s, i) => {
        const approved = s.status === "approved";
        const rejected = s.status === "rejected";
        const mine = s.status === "pending";
        return (
          <div
            key={s.stepId}
            className="flex flex-col w-[86px]"
            style={{
              borderRight: i < cells.length - 1 ? `1px solid ${LINE}` : undefined,
              background: mine ? "rgba(106, 131, 239, 0.07)" : undefined,
            }}
          >
            <span
              className="py-[5px] text-[11px] text-center"
              style={{ color: "var(--cd-body)", borderBottom: `1px solid ${LINE}` }}
            >
              {s.assigneePosition || (s.stepType === "agree" ? "합의" : "승인")}
            </span>
            <span
              className="h-[58px] flex flex-col items-center justify-center gap-0.5"
              style={{ borderBottom: `1px solid ${LINE}` }}
            >
              {approved && <Stamp />}
              {rejected && <Stamp label="반려" />}
              <span className="text-[10.5px] font-bold" style={{ color: approved || rejected ? "var(--cd-text)" : "var(--cd-faint)" }}>
                {s.assigneeName ?? s.assigneeUserId}
              </span>
              {mine && <span className="text-[9px] font-extrabold cd-text-primary">내 차례</span>}
            </span>
            <span
              className="py-1 text-[10px] text-center tabular-nums min-h-[21px] box-border"
              style={{ color: "var(--cd-muted)" }}
            >
              {stampDate(s.actedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ApprovalDocHead({ info }: { info: DocHeadInfo }) {
  const steps = info.steps ?? [];
  // 기안자는 상신 시점에 '신청' 완료로 본다(다우 양식 관례).
  const applicant: DocHeadStep[] = info.drafterName
    ? [
        {
          stepId: "__drafter",
          stepType: "draft",
          assigneeName: info.drafterName,
          assigneeUserId: "-",
          assigneePosition: "기안",
          status: info.draftDate && info.draftDate !== "-" ? "approved" : "waiting",
          actedAt: info.draftDate ?? null,
        },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {info.formName && (
        <h2
          className="m-0 text-center text-[21px] font-extrabold cd-text"
          style={{ letterSpacing: "0.35em", textIndent: "0.35em" }}
        >
          {info.formName}
        </h2>
      )}
      <div className="flex justify-between gap-6 items-start flex-wrap">
        {/* 좌 — 기안 정보 표 */}
        <div className="rounded-lg overflow-hidden w-[256px] self-start" style={{ border: `1px solid ${LINE_STRONG}` }}>
          {(
            [
              ["기안자", info.drafterName ?? "-"],
              ["소속", info.deptName ?? "-"],
              ["기안일", info.draftDate ?? "-"],
              ["문서번호", info.docNo ?? "(상신 시 채번)"],
            ] as const
          ).map(([l, v], i) => (
            <div key={l} className="flex" style={{ borderTop: i > 0 ? `1px solid ${LINE}` : undefined }}>
              <span
                className="w-[74px] shrink-0 px-2.5 py-[7px] text-[11.5px] font-extrabold text-center box-border"
                style={{ background: "var(--cd-form-label)", color: "var(--cd-body)", borderRight: `1px solid ${LINE}` }}
              >
                {l}
              </span>
              <span className="flex-1 px-2.5 py-[7px] text-[12px] cd-text truncate">{v}</span>
            </div>
          ))}
        </div>

        {/* 우 — 신청란 / 승인란 */}
        {steps.length > 0 && (
          <div className="flex gap-3.5 items-start">
            {applicant.length > 0 && <SignBox label="신청" cells={applicant} />}
            <SignBox label="승인" cells={steps} />
          </div>
        )}
      </div>
    </div>
  );
}
