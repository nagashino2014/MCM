// design-sync 전용 루트 래퍼. 앱에서는 AppShell 루트(div.cdash.cd-canvas.cd-fields-white[data-theme])가
// --cd-* 토큰을 공급한다. AppShell은 세션·사이드바에 묶여 있어 미리보기·디자인에는 이 래퍼로 같은 루트를 재현한다.
import type { ReactNode } from "react";

export function CdashRoot({ children, theme = "light" }: { children?: ReactNode; theme?: "light" | "dark" }) {
  return (
    <div className="cdash cd-canvas cd-fields-white" data-theme={theme} style={{ padding: 16, minHeight: "100%" }}>
      {children}
    </div>
  );
}
