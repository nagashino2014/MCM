import { useState } from "react";
import { CdThemeToggle } from "mcm-cdash";

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Toggle = () => {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <div className="cd-card p-4" style={{ alignItems: "flex-start" }}>
      <CdThemeToggle theme={theme} onToggle={() => setTheme(theme === "light" ? "dark" : "light")} />
    </div>
  );
};
