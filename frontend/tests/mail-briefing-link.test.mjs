import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const built = await build({ entryPoints: ["components/mail/MailViewerPane.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", tsconfig: "tsconfig.json" });
const module = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { MailViewerPane } = module.exports;
const noop = () => {};
function render(briefingLink) {
  return renderToStaticMarkup(createElement(MailViewerPane, {
    loading: false, folder: "inbox", categories: [], onReply: noop, onReplyAll: noop, onForward: noop, onTrash: noop, onRestore: noop, onDelete: noop, onSetCategory: noop, onArchive: noop, onSpam: noop, onUnspam: noop,
    detail: { messageId: "mail1", subject: "공유 시험", fromAddr: "sender@example.invalid", toAddrs: [], ccAddrs: [], createdAt: "2026-10-31T00:00:00Z", receivedAt: null, sentAt: null, attachments: [], categoryId: null,
      bodyHtml: '<a href="https://attacker.invalid/sales/rag?briefingId=b1" target="_blank">브리핑 보고서 열기</a>', bodyText: null, briefingLink },
  }));
}
test("verified briefing metadata adds a same-origin link outside the sandbox", () => {
  const html = render({ briefingId: "b1", title: "보고서", href: "/sales/rag?briefingId=b1" });
  assert.match(html.split("<iframe")[0], /href="\/sales\/rag\?briefingId=b1" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(html, /sandbox="[^"]*(?:allow-popups|allow-scripts)/);
});
test("ordinary mail body links cannot create a trusted briefing action", () => {
  const html = render(null);
  assert.doesNotMatch(html.split("<iframe")[0], /브리핑 보고서 열기/);
});
test("malformed or external metadata cannot become a briefing action", () => {
  for (const link of [
    { briefingId: "b1", title: "보고서", href: "https://attacker.invalid/sales/rag?briefingId=b1" },
    { briefingId: "b1", title: "보고서", href: "/sales/rag?briefingId=b2" },
    { briefingId: "../b1", title: "보고서", href: "/sales/rag?briefingId=..%2Fb1" },
  ]) assert.doesNotMatch(render(link).split("<iframe")[0], /브리핑 보고서 열기/);
});
