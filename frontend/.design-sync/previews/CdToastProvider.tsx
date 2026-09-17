import { useEffect } from "react";
import { CdToastProvider, useCdToast, CdButton } from "mcm-cdash";

function Demo() {
  const { toast } = useCdToast();
  useEffect(() => {
    toast("계산서 발행 요청을 등록했습니다.", "success", 600000);
    toast("국세청 전송에 실패했습니다. 잠시 후 다시 시도하세요.", "error", 600000);
  }, [toast]);
  return <CdButton size="sm" onClick={() => toast("임시 저장했습니다.", "info")}>알림 띄우기</CdButton>;
}

// 콘텐츠 요소는 베이지 앱 바탕 위에 직접 두지 않고 흰 카드(cd-card) 안에 둔다.
export const Toasts = () => (
  <CdToastProvider>
    <div className="cd-card p-4" style={{ alignItems: "flex-start" }}>
      <Demo />
    </div>
  </CdToastProvider>
);
