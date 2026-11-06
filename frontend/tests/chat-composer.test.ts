import assert from "node:assert/strict";
import test from "node:test";
import { buildUserSharedRecord, matchMentionedNames, parseChatSharedRecord } from "../lib/chat/queries";

// 대화방 입력창 도구(2026-11-06) — DB 없이 도는 순수 규칙: 멘션 이름 매칭, 문서 공유 카드 검증.

test("멘션: 본문의 @이름 과 맞는 멤버 이름만 추린다", () => {
  const names = ["이재영", "이도희", "권오종", "이도"];
  assert.deepEqual(matchMentionedNames("@이도희 확인 부탁드립니다", names), ["이도희"]);
  assert.deepEqual(matchMentionedNames("@권오종님 @이재영 부장님 봐 주세요", names).sort(), ["권오종", "이재영"].sort());
  assert.deepEqual(matchMentionedNames("메일은 a@b.com 으로 주세요", names), []);
  assert.deepEqual(matchMentionedNames("멘션 없는 글", names), []);
});

test("멘션: 긴 이름부터 소비해 접두사 이름이 함께 걸리지 않는다", () => {
  const names = ["이도", "이도희"];
  assert.deepEqual(matchMentionedNames("@이도희 안녕하세요", names), ["이도희"]);
  assert.deepEqual(matchMentionedNames("@이도 안녕하세요", names), ["이도"]);
  assert.deepEqual(matchMentionedNames("@이도희 @이도 둘 다", names).sort(), ["이도", "이도희"].sort());
  assert.deepEqual(matchMentionedNames("@이도희", ["이도희", "이도희", " ", ""]), ["이도희"]);
});

test("문서 공유 카드: 입력창 요청은 종류·id 를 검증하고 경로는 서버가 정한다", () => {
  assert.deepEqual(buildUserSharedRecord({ type: "approval_doc", id: "doc-101", title: "  11월  출장 신청 " }), {
    type: "approval_doc",
    id: "doc-101",
    title: "11월 출장 신청",
    href: "/approval?docId=doc-101",
  });
  assert.equal(buildUserSharedRecord({ type: "todo", id: "td-7", title: "서류 검토" })?.href, "/todo/td-7");
  assert.equal(buildUserSharedRecord({ type: "facility", id: "fac-9", title: "한빛화학" })?.href, "/facility/fac-9");
  // 클라이언트가 보낸 href 는 무시한다
  assert.equal(
    buildUserSharedRecord({ type: "todo", id: "td-7", title: "서류 검토", href: "https://evil.invalid" })?.href,
    "/todo/td-7"
  );
  assert.equal(buildUserSharedRecord({ type: "todo", id: "td-7", title: "가".repeat(300) })?.title.length, 200);
});

test("문서 공유 카드: 브리핑·모르는 종류·잘못된 id·빈 제목은 거절한다", () => {
  // 브리핑 카드는 공유 업무(수신자 지정·전달 기록)만 만들 수 있다
  assert.equal(buildUserSharedRecord({ type: "intel_briefing", id: "b1", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "contract", id: "c1", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "__proto__", id: "c1", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: "../admin", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: "a b", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: "", title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: "x".repeat(161), title: "제목" }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: "td-7", title: "   " }), null);
  assert.equal(buildUserSharedRecord({ type: "todo", id: 7, title: "제목" }), null);
  assert.equal(buildUserSharedRecord(null), null);
  assert.equal(buildUserSharedRecord(["todo"]), null);
});

test("문서 공유 카드: 저장된 카드는 고정 경로와 대조해 내려준다", () => {
  for (const type of ["approval_doc", "todo", "facility"] as const) {
    const built = buildUserSharedRecord({ type, id: "id-1", title: "제목" });
    assert.ok(built);
    assert.deepEqual(parseChatSharedRecord(built), built);
  }
  assert.deepEqual(parseChatSharedRecord({ type: "intel_briefing", id: "b1", title: "제목", href: "/sales/rag?briefingId=b1" }), {
    type: "intel_briefing",
    id: "b1",
    title: "제목",
    href: "/sales/rag?briefingId=b1",
  });
  assert.equal(parseChatSharedRecord({ type: "intel_briefing", id: "b1", title: "제목", href: "https://evil.invalid" }), null);
  assert.equal(parseChatSharedRecord({ type: "todo", id: "td-7", title: "제목", href: "/approval?docId=td-7" }), null);
  assert.equal(parseChatSharedRecord({ type: "contract", id: "c1", title: "제목", href: "/contracts/c1" }), null);
});
