import { CdEmptyState, CdButton } from "mcm-cdash";
import { FileSearch, Inbox, Plus } from "lucide-react";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const WithAction = () => (
  <div className="cd-card p-4">
    <CdEmptyState
      icon={<Inbox className="w-6 h-6" />}
      title="등록된 계약이 없습니다"
      description="첫 계약을 등록하면 수주·수금 현황이 여기에 표시됩니다."
      action={<CdButton variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />}>계약 등록</CdButton>}
    />
  </div>
);

export const NoResults = () => (
  <div className="cd-card p-4">
    <CdEmptyState icon={<FileSearch className="w-6 h-6" />} title="검색 결과가 없습니다" description="검색어나 기간 필터를 바꿔 다시 조회하세요." />
  </div>
);
