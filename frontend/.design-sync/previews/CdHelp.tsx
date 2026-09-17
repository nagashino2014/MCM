import { useEffect, useRef, type ReactNode } from "react";
import { CdHelp } from "mcm-cdash";

const Title = ({ children }: { children: ReactNode }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600 }} className="cd-text">{children}</span>
);

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Closed = () => (
  <div className="cd-card p-4" style={{ alignItems: "flex-start" }}>
    <Title>
      업무추진계획
      <CdHelp label="업무추진계획 도움말">수행 중인 용역·Task를 선택해 공정·진행단계·수행인력·추진내역을 한 화면에서 보고합니다.</CdHelp>
    </Title>
  </div>
);

// 도움말 패널이 열린 모습을 보여주려고 마운트 직후 ? 버튼을 한 번 누른다.
export const Open = () => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector("button")?.click(); }, []);
  return (
    <div ref={box} className="cd-card p-4" style={{ alignItems: "flex-start", minHeight: 200 }}>
      <Title>
        급여대장
        <CdHelp label="급여대장 도움말">
          확정 전에는 근태·수당을 다시 불러와 반영할 수 있습니다. 확정하면 명세서가 발송되고 수정할 수 없습니다.
        </CdHelp>
      </Title>
    </div>
  );
};
