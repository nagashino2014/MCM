import type { Href } from "expo-router";

/**
 * 푸시 알림의 `data.link`(서버가 넣는 경로) → 앱 라우트 변환.
 * 서버는 웹 경로 감각으로 링크를 만들고(예: /board/bpost-xxx, /approval?docId=xxx),
 * 앱에서 실제로 어느 화면을 열지는 여기 한 곳에서 정한다.
 */
export function routeForLink(link: string | null | undefined): Href | null {
  if (!link || typeof link !== "string") return null;
  const path = link.split("?")[0];

  // 브리핑 공유는 문서 ID로 연다. 수신자는 관심조건·예약 권한 없이 공유 문서만 읽을 수 있다.
  if (path === "/sales/rag") {
    const query = new URLSearchParams(link.split("?")[1] ?? "");
    const briefingId = query.get("briefingId"), runId = query.get("runId");
    if (briefingId && /^[a-zA-Z0-9_-]{1,128}$/.test(briefingId)) return { pathname: "/briefings/[briefingId]", params: { briefingId } };
    if (runId && /^[a-zA-Z0-9_-]{1,128}$/.test(runId)) return { pathname: "/briefings/[briefingId]", params: { briefingId: "run", runId } };
    return null;
  }

  // 게시글 상세
  const board = /^\/board\/([^/]+)$/.exec(path);
  if (board) return { pathname: "/board/[postId]", params: { postId: board[1] } };

  // 결재 — 서버는 웹 딥링크 형식(/approval?docId=)으로 보낸다.
  if (path === "/approval") {
    const docId = new URLSearchParams(link.split("?")[1] ?? "").get("docId");
    return docId ? { pathname: "/approval/[docId]", params: { docId } } : "/(tabs)/approval";
  }

  // 사업장 — 대화방 문서 공유 카드(2026-11-06)가 /facility/{id} 로 온다.
  const facility = /^\/facility\/([^/]+)$/.exec(path);
  if (facility) return { pathname: "/facility/[facilityId]", params: { facilityId: decodeURIComponent(facility[1]) } };

  // 메신저 — 새 메시지 푸시는 /chat/{roomId} 로 온다(MSG-P1).
  const chat = /^\/chat\/(\d+)$/.exec(path);
  if (chat) return { pathname: "/chat/[roomId]", params: { roomId: chat[1] } };

  // 메일 — 새 메일 푸시(2026-11-12)는 한 통이면 /mail?id=<messageId>(웹 진입점과 같은 형식), 여러 통을 묶으면 /mail 로 온다.
  if (path === "/mail") {
    const id = new URLSearchParams(link.split("?")[1] ?? "").get("id");
    if (id && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) return { pathname: "/mail/[messageId]", params: { messageId: id } };
  }
  if (path.startsWith("/mail")) return "/(tabs)/mail";

  // 공공입찰 — 마감 임박 푸시는 ?filter=deadline 로 온다(M6-C).
  if (path === "/bids") {
    const filter = new URLSearchParams(link.split("?")[1] ?? "").get("filter");
    return filter === "deadline" ? { pathname: "/bids", params: { filter } } : "/bids";
  }

  // 할 일(274) — 상세 푸시는 /todo/<id>(§25-4, 옛 형식 /todo?item=<id> 도 수용), 아침 요약은 /todo 로 온다.
  const todoItem = /^\/todo\/([^/]+)$/.exec(path);
  if (todoItem && todoItem[1] !== "inbox") return { pathname: "/todo/[itemId]", params: { itemId: decodeURIComponent(todoItem[1]) } };
  if (path === "/todo/inbox") return "/todo/inbox";
  if (path === "/todo") {
    const item = new URLSearchParams(link.split("?")[1] ?? "").get("item");
    return item ? { pathname: "/todo/[itemId]", params: { itemId: item } } : "/todo";
  }

  return null;
}
