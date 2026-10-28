import { useState } from "react";
import { CdTabs } from "mcm-cdash";

// 탭 규칙(2026-10-28): 화면·카드·모달 내용을 통째로 바꾸는 페이지 탭은 기본 세그먼트형(segment —
// 흰 묶음 + 남색 틴트 선택). 카드 안에 붙은 섹션 탭은 underline 을 명시, pill 은 같은 목록을 거르는 필터에만 쓴다.

// 페이지 탭 + 그 아래 필터 — 문서함 화면 구성(페이지 탭은 카드 위 페이지 머리 영역에 놓인다)
export const PageTabsWithFilter = () => {
  const [page, setPage] = useState("approval");
  const [box, setBox] = useState("mine");
  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      <CdTabs
        active={page}
        onChange={setPage}
        items={[
          { key: "approval", label: "전자결재" },
          { key: "letters", label: "발송공문" },
          { key: "quotes", label: "발송견적" },
          { key: "contracts", label: "계약 문서" },
        ]}
      />
      <div className="cd-card p-4">
        <CdTabs
          variant="pill"
          active={box}
          onChange={setBox}
          items={[
            { key: "mine", label: "내 기안 완료" },
            { key: "acted", label: "내가 결재한 문서" },
            { key: "watched", label: "참조·열람" },
            { key: "dept", label: "부서 문서함" },
          ]}
        />
      </div>
    </div>
  );
};

// 페이지 탭(세그먼트형, 기본) — 건수 배지
export const PageTabsSegment = () => {
  const [active, setActive] = useState("pending");
  return (
    <CdTabs
      active={active}
      onChange={setActive}
      items={[
        { key: "pending", label: "결재 대기", count: 3 },
        { key: "progress", label: "진행 중", count: 12 },
        { key: "done", label: "완료" },
        { key: "rejected", label: "반려", count: 1 },
      ]}
    />
  );
};

// 카드 안 섹션 탭(밑줄형) — 카드 머리에 붙어 카드 내용을 바꾼다
export const InCardUnderline = () => {
  const [active, setActive] = useState("basic");
  return (
    <div className="cd-card p-4">
      <CdTabs
        variant="underline"
        active={active}
        onChange={setActive}
        items={[
          { key: "basic", label: "기본 정보" },
          { key: "career", label: "학력·경력" },
          { key: "hr", label: "인사 관리" },
        ]}
      />
    </div>
  );
};

// 카드 안 필터(pill) — 같은 목록의 기간만 바꾼다
export const FilterPill = () => {
  const [active, setActive] = useState("month");
  return (
    <div className="cd-card p-4">
      <CdTabs
        variant="pill"
        active={active}
        onChange={setActive}
        items={[
          { key: "week", label: "이번 주" },
          { key: "month", label: "이번 달" },
          { key: "year", label: "올해" },
          { key: "custom", label: "기간 지정", disabled: true },
        ]}
      />
    </div>
  );
};
