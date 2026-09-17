import { CdIconButton } from "mcm-cdash";
import { Bell, Pencil, Printer, Settings, Trash2 } from "lucide-react";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Toolbar = () => (
  <div className="cd-card p-4">
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <CdIconButton label="수정"><Pencil className="w-4 h-4" /></CdIconButton>
      <CdIconButton label="인쇄"><Printer className="w-4 h-4" /></CdIconButton>
      <CdIconButton label="삭제"><Trash2 className="w-4 h-4" /></CdIconButton>
    </div>
  </div>
);

export const SmallAndActive = () => (
  <div className="cd-card p-4">
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <CdIconButton label="알림" size="sm" active><Bell className="w-4 h-4" /></CdIconButton>
      <CdIconButton label="설정" size="sm"><Settings className="w-4 h-4" /></CdIconButton>
    </div>
  </div>
);
