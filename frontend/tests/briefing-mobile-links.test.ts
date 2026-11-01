import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";

test("공유 브리핑·정기회차·기존 메신저 푸시 링크는 앱의 인증 읽기 화면으로 열린다", async () => {
  const output = resolve(".next/briefing-tests/mobile-links.cjs");
  await build({ entryPoints: ["../apps/mobile/src/lib/deeplink.ts"], outfile: output, bundle: true, platform: "node", format: "cjs" });
  const { routeForLink } = createRequire(resolve("package.json"))(output);
  assert.deepEqual(routeForLink("/sales/rag?briefingId=irag_123"), { pathname: "/briefings/[briefingId]", params: { briefingId: "irag_123" } });
  assert.deepEqual(routeForLink("/sales/rag?tab=scheduled&runId=ibr_123"), { pathname: "/briefings/[briefingId]", params: { briefingId: "run", runId: "ibr_123" } });
  assert.deepEqual(routeForLink("/chat/123"), { pathname: "/chat/[roomId]", params: { roomId: "123" } });
  for (const link of ["https://evil.example/sales/rag?briefingId=irag_123", "//evil.example/sales/rag?briefingId=irag_123", "/sales/rag?briefingId=..%2Fadmin", "/sales/rag?briefingId=", "/sales/rag?runId=%3Cscript%3E"]) assert.equal(routeForLink(link), null);
});
