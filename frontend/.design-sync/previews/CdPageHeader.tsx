import { CdPageHeader, CdButton, CdTabs } from "mcm-cdash";
import { Plus, RefreshCw } from "lucide-react";

export const WithActions = () => (
  <CdPageHeader
    breadcrumbs={[{ label: "전자결재", href: "/approval" }, { label: "문서함" }]}
    title="결재 문서함"
    help="내가 기안했거나 결재선에 포함된 문서를 상태별로 확인합니다."
    meta="전체 128건"
    actions={
      <>
        <CdButton size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />}>새로고침</CdButton>
        <CdButton size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />}>새 기안</CdButton>
      </>
    }
  />
);

export const WithSubtitle = () => (
  <CdPageHeader
    title="급여대장"
    titleSuffix="2026년 9월"
    subtitle="확정 후에는 수정할 수 없습니다. 지급일 전까지 근태·수당 반영을 확인하세요."
  />
);

export const WithTabs = () => (
  <CdPageHeader
    title="계정·권한 관리"
    help="먼저 권한 템플릿을 구성한 뒤 개별 계정에 적용합니다."
    tabs={
      <CdTabs
        variant="underline"
        active="accounts"
        onChange={() => {}}
        items={[
          { key: "accounts", label: "계정", count: 31 },
          { key: "templates", label: "권한 템플릿" },
          { key: "log", label: "변경 이력" },
        ]}
      />
    }
  />
);
