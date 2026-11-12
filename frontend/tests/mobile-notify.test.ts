import assert from "node:assert/strict";
import { test } from "node:test";
import { routeForLink } from "../../apps/mobile/src/lib/deeplink";
import { clearActiveChatRoom, isActiveChatLink, setActiveChatRoom } from "../../apps/mobile/src/lib/active-chat";
import { refreshNavBadges } from "../../apps/mobile/src/lib/use-nav-badges";
import { apiCalls, badgeSyncs, holdApi, setNextBadges } from "./stubs/mobile-notify-env";

// 앱 알림·배지(2026-11-12) — scripts/test-push-notify.mjs 가 react-native·./api·./notification-tray 를 stubs 로 바꿔 묶는다.

test("딥링크 — 새 메일 한 통은 그 메일, 묶음은 메일 탭, 대화는 그 방", () => {
  assert.deepEqual(routeForLink("/mail?id=mmsg-0a1b2c3d4e5f60"), { pathname: "/mail/[messageId]", params: { messageId: "mmsg-0a1b2c3d4e5f60" } });
  assert.equal(routeForLink("/mail"), "/(tabs)/mail");
  assert.equal(routeForLink("/mail?id=../../etc"), "/(tabs)/mail");
  assert.deepEqual(routeForLink("/chat/42"), { pathname: "/chat/[roomId]", params: { roomId: "42" } });
});

test("보고 있는 대화방 — 그 방 링크만 활성, 다른 방이 해제하지 못한다", () => {
  assert.equal(isActiveChatLink("/chat/7"), false);
  setActiveChatRoom(7);
  assert.equal(isActiveChatLink("/chat/7"), true);
  assert.equal(isActiveChatLink("/chat/70"), false);
  assert.equal(isActiveChatLink("/mail?id=x"), false);
  clearActiveChatRoom(8); // 다른 방의 blur 가 늦게 와도 7 은 그대로
  assert.equal(isActiveChatLink("/chat/7"), true);
  clearActiveChatRoom(7);
  assert.equal(isActiveChatLink("/chat/7"), false);
});

test("배지 — 받을 때마다 앱 아이콘 숫자를 합계로 맞추고, 받는 중에 또 부르면 끝난 뒤 한 번 더 받는다", async () => {
  apiCalls.length = 0;
  badgeSyncs.length = 0;
  setNextBadges({ mailUnread: 2, approvalPending: 1, chatUnread: 3 });
  await refreshNavBadges();
  assert.deepEqual(badgeSyncs, [6]);

  // 첫 요청이 아직 안 끝났는데 읽음 처리가 끝나 다시 부른 상황 — 읽음 뒤 값(대화 0)이 반드시 반영돼야 한다.
  let release!: () => void;
  holdApi(new Promise<void>((r) => (release = r)));
  apiCalls.length = 0;
  badgeSyncs.length = 0;
  const first = refreshNavBadges();
  setNextBadges({ mailUnread: 2, approvalPending: 1, chatUnread: 0 });
  const second = refreshNavBadges();
  const third = refreshNavBadges();
  holdApi(Promise.resolve());
  release();
  await Promise.all([first, second, third]);
  assert.equal(apiCalls.length, 2, "세 번 불러도 두 번만 받는다");
  assert.deepEqual(badgeSyncs.at(-1), 3);
});
