/**
 * 신고 보조(설치형 로컬 도구) 열기 — mcm-filings:// 링크.
 *
 * 설치 패키지가 링크를 등록하지 않은 PC 에서는 브라우저가 링크를 조용히 무시해 "눌러도 아무 반응이 없다"
 * (2026-09-16 실측 — 원인을 알 수 없었다). 도구가 뜨면 브라우저가 외부 프로그램 확인창이나 새 콘솔 창에
 * 포커스를 넘기므로, 잠시 안에 창이 포커스를 잃지 않으면 설치되지 않은 것으로 보고 안내한다.
 */

/** 설치 안 된 PC 에 보여 줄 안내 */
export const FILINGS_ASSIST_MISSING_MESSAGE =
  "신고 보조가 열리지 않았습니다 — 이 PC 에 설치되지 않았을 수 있습니다. 설치 파일(MCM-Filings-….zip)을 풀고 install.cmd 를 실행한 뒤 다시 눌러 주세요.";

const WAIT_MS = 2000;

export function launchFilingsAssist(href: string, onMissing: () => void): void {
  if (typeof window === "undefined") return;
  let left = false;
  const onBlur = () => {
    left = true;
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden") left = true;
  };
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);
  window.location.href = href;
  window.setTimeout(() => {
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    if (!left && document.hasFocus()) onMissing();
  }, WAIT_MS);
}
