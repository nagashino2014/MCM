import { useEffect, useRef } from "react";
import { CdDropdown, CdButton } from "mcm-cdash";
import { ChevronDown, Copy, Download, Pencil, Trash2 } from "lucide-react";

const ITEMS = [
  { key: "edit", label: "수정", icon: <Pencil className="w-4 h-4" />, onSelect: () => {} },
  { key: "copy", label: "복제", icon: <Copy className="w-4 h-4" />, onSelect: () => {} },
  { key: "pdf", label: "PDF 다운로드", icon: <Download className="w-4 h-4" />, onSelect: () => {} },
  { key: "delete", label: "삭제", icon: <Trash2 className="w-4 h-4" />, danger: true, onSelect: () => {} },
];

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
// 메뉴가 펼쳐진 모습을 보여주려고 마운트 직후 트리거를 한 번 누른다.
export const Open = () => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector("button")?.click(); }, []);
  return (
    <div ref={box} className="cd-card p-4" style={{ alignItems: "flex-start", minHeight: 240 }}>
      <CdDropdown
        align="left"
        items={ITEMS}
        trigger={(open) => <CdButton size="sm" icon={<ChevronDown className={open ? "w-3.5 h-3.5 rotate-180" : "w-3.5 h-3.5"} />}>작업</CdButton>}
      />
    </div>
  );
};

export const Closed = () => (
  <div className="cd-card p-4" style={{ alignItems: "flex-start" }}>
    <CdDropdown items={ITEMS} trigger={() => <CdButton size="sm">더보기</CdButton>} />
  </div>
);
