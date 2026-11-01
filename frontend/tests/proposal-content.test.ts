import { test } from "node:test";
import assert from "node:assert/strict";
import { createProposalTemplate } from "@/lib/proposal/templates";
import { materializeDocument } from "@/lib/proposal/materialize";
import { createProposalStore, type ProposalDb } from "@/lib/proposal/store";
import { ProposalError, validateProposalDocument, validateProposalForPublication } from "@/lib/proposal/validate";
import type { ProposalBlock, ProposalDocument } from "@/lib/proposal/types";

// Content truth and visual pagination are reviewed separately. These tests cover
// loss of authored page data, variable propagation and publication boundaries.
const variables = {
  client: "검증기관", projectName: "검증 용역", siteName: "검증 사업장",
  duration: "계약일부터 24개월", companyName: "검증 제안사",
};
// 참여인력(P)은 입찰마다 채우는 칸이라 원고에 [작성 필요]로 남아 있다 — 시험에서는 채운다.
const filled = (): ProposalDocument => {
  const doc: ProposalDocument = JSON.parse(JSON.stringify(createProposalTemplate("permit-general")).replaceAll("[작성 필요]", "확정 인력"));
  return { ...doc, client: variables.client, projectName: variables.projectName, submissionDate: "2026-10-30",
    variables: { siteName: variables.siteName, duration: variables.duration, companyName: variables.companyName } };
};
const tokens = "{{client}} / {{projectName}} / {{siteName}} / {{duration}} / {{companyName}}";
const resolved = "검증기관 / 검증 용역 / 검증 사업장 / 계약일부터 24개월 / 검증 제안사";
const expectUnresolved = (error: unknown) => error instanceof ProposalError && error.status === 422;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function firstBlock<K extends ProposalBlock["kind"]>(doc: ProposalDocument, kind: K): Extract<ProposalBlock, { kind: K }> {
  const block = doc.sections.flatMap(s => s.blocks).find(b => b.kind === kind);
  assert.ok(block, `${kind} 블록이 필요합니다.`);
  return block as Extract<ProposalBlock, { kind: K }>;
}

// JSON-backed test DB exercises the real store's create/save/get/publish paths;
// it is not a substitute for the application's PostgreSQL or browser checks.
function storage() {
  const documents = new Map<string, { json: string; revision: number }>();
  let editions = 0;
  let renderCalls = 0;
  const db: ProposalDb = {
    async exec(_sql, params = []) {
      const stored = documents.get(String(params[0]));
      return stored ? [{ columns: ["document", "revision", "template_id"], values: [[stored.json, stored.revision, JSON.parse(stored.json).templateId]] }] : [];
    },
    async run(sql, params = []) {
      if (sql.startsWith("INSERT INTO proposal_documents")) documents.set(String(params[0]), { json: String(params[1]), revision: 1 });
      else if (sql.startsWith("UPDATE proposal_documents")) {
        const prior = documents.get(String(params[0])); assert.ok(prior);
        documents.set(String(params[0]), { json: String(params[1]), revision: prior.revision + 1 });
      } else if (sql.startsWith("INSERT INTO proposal_editions")) editions += 1;
      else assert.fail(`지원하지 않는 시험 쓰기: ${sql}`);
    },
  };
  const store = createProposalStore({
    readDb: async () => db, transaction: async work => work(db),
    render: async () => { renderCalls += 1; throw new Error("미해결 변수가 있으면 렌더 전에 거절해야 합니다."); },
    decodeImage: async () => { throw new Error("이 검사는 그림 디코딩 단계에 도달하지 않아야 합니다."); },
  });
  return { store, publicationEffects: () => ({ editions, renderCalls }) };
}

test("일반 기본판은 G01~G36의 순서와 편집 가능한 페이지 메타데이터를 제공한다", () => {
  const doc = validateProposalDocument(createProposalTemplate("permit-general"));
  const ids = Array.from({ length: 36 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
  assert.deepEqual(doc.sections.map(s => s.id), ids);
  assert.deepEqual(doc.sections.map(s => s.pageId), ids);
  assert.equal(doc.layout, "paged");
  assert.ok(doc.contentVersion?.trim());
  for (const section of doc.sections) {
    assert.ok(section.chapter?.trim(), `${section.id}: 상위 목차`);
    assert.ok(section.title.trim(), `${section.id}: 제목`);
    assert.ok(section.summary?.trim(), `${section.id}: 핵심 문장`);
    assert.ok(section.blocks.length, `${section.id}: 본문`);
  }
});

test("36쪽 원고의 사용자 수정과 페이지·변수·버전 정보는 저장 후 재열어도 보존된다", async () => {
  const h = storage();
  const created = await h.store.create(filled(), 0, "content-tester");
  const edited = structuredClone(created.document);
  edited.sections[0].chapter = "사용자가 조정한 목차";
  edited.sections[0].summary = "사용자가 합의한 수행 목표를 반영합니다.";
  edited.sections[0].title = "사업장별 제안 요약";
  edited.variables!.duration = "계약일부터 18개월";
  firstBlock(edited, "bullets").items.push({ level: 2, text: "사용자 추가 문장을 보존합니다." });
  firstBlock(edited, "table").rows[0][0] = "사용자 검토 항목";
  firstBlock(edited, "diagram").spec.items[0].desc = "사용자 도식 설명";
  firstBlock(edited, "cards").items[0].body = "사용자 카드 내용";
  firstBlock(edited, "gantt").tasks[0].end = 3;
  await h.store.save(edited.id, edited, created.rev, "content-tester");
  const reopened = await h.store.get(edited.id);
  assert.equal(reopened.rev, 2);
  assert.deepEqual(reopened.document, edited);
  assert.ok(JSON.stringify(reopened.document).includes("{{siteName}}"), "저장본은 연결 표기를 보존해야 합니다.");
});

test("다섯 변수는 제목·핵심문장·본문·표·도식에 반영되고 원고와 ID는 바뀌지 않는다", () => {
  const doc = filled();
  doc.title = "{{client}}의 {{projectName}}";
  doc.sections[0].summary = tokens;
  firstBlock(doc, "bullets").items[0].text = tokens;
  const sourceTable = firstBlock(doc, "table");
  sourceTable.title = "{{siteName}} 수행 범위";
  sourceTable.columns[0] = "{{companyName}}";
  sourceTable.rows[0][0] = tokens;
  const sourceFigure = firstBlock(doc, "diagram");
  sourceFigure.title = "{{projectName}} 흐름";
  sourceFigure.spec.center = { label: "{{client}} 계획" };
  sourceFigure.spec.items[0].label = "{{siteName}}";
  sourceFigure.spec.items[0].desc = tokens;
  const before = structuredClone(doc);
  freeze(doc);
  const preview = materializeDocument(doc);
  assert.equal(preview.title, "검증기관의 검증 용역");
  assert.equal(preview.sections[0].summary, resolved);
  assert.equal(firstBlock(preview, "bullets").items[0].text, resolved);
  assert.equal(firstBlock(preview, "table").title, "검증 사업장 수행 범위");
  assert.equal(firstBlock(preview, "table").columns[0], "검증 제안사");
  assert.equal(firstBlock(preview, "table").rows[0][0], resolved);
  const renderedFigure = firstBlock(preview, "diagram");
  assert.equal(renderedFigure.title, "검증 용역 흐름");
  assert.equal(renderedFigure.spec.center?.label, "검증기관 계획");
  assert.equal(renderedFigure.spec.items[0].label, "검증 사업장");
  assert.equal(renderedFigure.spec.items[0].desc, resolved);
  assert.deepEqual(preview.sections.map(s => [s.id, s.pageId, ...s.blocks.map(b => b.id)]), before.sections.map(s => [s.id, s.pageId, ...s.blocks.map(b => b.id)]));
  assert.deepEqual(doc, before);
  assert.notEqual(preview.sections, doc.sections);
  assert.notEqual(renderedFigure.spec, sourceFigure.spec);
});

test("다른 사업장으로 변용해도 원고·첫 미리보기·새 기본판은 서로 덮어쓰지 않는다", () => {
  const source = freeze(filled());
  const first = materializeDocument(source);
  const secondDraft = structuredClone(source);
  secondDraft.client = "다른 검증기관";
  secondDraft.projectName = "다른 용역";
  secondDraft.variables = { siteName: "회귀검증-B사업장", duration: "별도 계약기간", companyName: "다른 제안사" };
  const second = materializeDocument(secondDraft);
  assert.ok(JSON.stringify(first).includes("검증 사업장"));
  assert.ok(JSON.stringify(second).includes("회귀검증-B사업장"));
  assert.ok(!JSON.stringify(first.sections).includes("회귀검증-B사업장"));
  assert.ok(JSON.stringify(source.sections).includes("{{siteName}}"));
  second.sections[0].summary = "이 미리보기만 수정";
  assert.notEqual(first.sections[0].summary, second.sections[0].summary);
  const newDraft = createProposalTemplate("permit-general");
  assert.notEqual(newDraft.id, source.id);
  assert.ok(JSON.stringify(newDraft.sections).includes("{{siteName}}"));
  assert.notEqual(newDraft.sections[0].summary, "이 미리보기만 수정");
});

test("사업 정보가 채워진 전체 36쪽은 발행 준비 검사를 통과한다", () => {
  const doc = validateProposalDocument(filled());
  assert.doesNotThrow(() => validateProposalForPublication(doc));
  assert.ok(!/\{\{[^{}]+\}\}/.test(JSON.stringify(materializeDocument(doc))));
  // This is readiness validation, not proof of PNG rendering or HWPX pagination.
});

test("다섯 사업 변수 중 하나가 비면 초안 저장은 허용하고 발행은 렌더 전에 거절한다", async () => {
  for (const name of ["client", "projectName", "siteName", "duration", "companyName"] as const) {
    const doc = filled();
    if (name === "client" || name === "projectName") doc[name] = "  ";
    else doc.variables![name] = "  ";
    const h = storage();
    const saved = await h.store.create(doc, 0, "content-tester");
    assert.throws(() => validateProposalForPublication(saved.document), expectUnresolved, name);
    await assert.rejects(h.store.publish(saved.document.id, saved.rev, {}, "content-tester"), expectUnresolved, name);
    assert.deepEqual(h.publicationEffects(), { editions: 0, renderCalls: 0 }, name);
    assert.equal((await h.store.get(saved.document.id)).rev, 1);
  }
});

test("알 수 없는 본문·표·도식 연결 표기는 저장되지만 발행에서는 422로 거절한다", async () => {
  const cases: Array<{ name: string; edit: (doc: ProposalDocument) => void }> = [
    { name: "개조식의 미지원 변수", edit: doc => { firstBlock(doc, "bullets").items[0].text += " {{permitType}}"; } },
    { name: "표의 미지원 한글 변수", edit: doc => { firstBlock(doc, "table").rows[0][0] = "{{사업장코드}}"; } },
    { name: "도식의 미지원 예약 이름", edit: doc => { firstBlock(doc, "diagram").spec.items[0].desc = "{{constructor}}"; } },
  ];
  for (const entry of cases) {
    const doc = filled(); entry.edit(doc);
    const h = storage();
    const saved = await h.store.create(doc, 0, "content-tester");
    await assert.rejects(h.store.publish(saved.document.id, saved.rev, {}, "content-tester"), expectUnresolved, entry.name);
    assert.deepEqual(h.publicationEffects(), { editions: 0, renderCalls: 0 }, entry.name);
    assert.equal((await h.store.get(saved.document.id)).rev, 1);
  }
});

test("네 양식 모두 저장 검증을 통과하고, 참여인력처럼 입찰마다 채울 칸만 [작성 필요]로 남긴다", () => {
  for (const id of ["permit-general", "permit-power", "permit-inspection", "sustainability"] as const) {
    const doc = validateProposalDocument(createProposalTemplate(id));
    assert.ok(doc.sections.length >= 12, `${id}: 시작 양식이 아니라 완성 원고여야 함`);
    const kinds = new Set(doc.sections.flatMap((s) => s.blocks.map((b) => b.kind)));
    for (const k of ["bullets", "table", "cards", "diagram", "gantt"]) assert.ok(kinds.has(k as ProposalBlock["kind"]), `${id}: ${k} 블록`);
    const placeholders = doc.sections.filter((s) => JSON.stringify(s).includes("[작성 필요]")).map((s) => s.id);
    assert.ok(placeholders.length <= 3, `${id}: 미기입 쪽이 많음 ${placeholders.join(",")}`);
  }
});
