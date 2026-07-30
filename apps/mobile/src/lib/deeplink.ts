import type { Href } from "expo-router";

/**
 * 푸시 알림의 `data.link`(서버가 넣는 경로) → 앱 라우트 변환.
 * 서버는 웹 경로 감각으로 링크를 만들고(예: /board/bpost-xxx, /approval?docId=xxx),
 * 앱에서 실제로 어느 화면을 열지는 여기 한 곳에서 정한다.
 */
export function routeForLink(link: string | null | undefined): Href | null {
  if (!link || typeof link !== "string") return null;
  const path = link.split("?")[0];

  // 게시글 상세
  const board = /^\/board\/([^/]+)$/.exec(path);
  if (board) return { pathname: "/board/[postId]", params: { postId: board[1] } };

  // 결재 — 서버는 웹 딥링크 형식(/approval?docId=)으로 보낸다.
  if (path === "/approval") {
    const docId = new URLSearchParams(link.split("?")[1] ?? "").get("docId");
    return docId ? { pathname: "/approval/[docId]", params: { docId } } : "/(tabs)/approval";
  }

  // 메일 — 목록·뷰어는 M3.
  if (path.startsWith("/mail")) return "/(tabs)/mail";

  // 공공입찰 — 마감 임박 푸시는 ?filter=deadline 로 온다(M6-C).
  if (path === "/bids") {
    const filter = new URLSearchParams(link.split("?")[1] ?? "").get("filter");
    return filter === "deadline" ? { pathname: "/bids", params: { filter } } : "/bids";
  }

  return null;
}
