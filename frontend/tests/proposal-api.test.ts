import { test } from "node:test";
import assert from "node:assert/strict";
import { createProposalStore, type ProposalDb, type ProposalStoreDeps } from "@/lib/proposal/store";
import { createProposalHandlers } from "@/lib/proposal/handlers";
import { ProposalError, validateProposalDocument } from "@/lib/proposal/validate";
import type { ProposalDocument } from "@/lib/proposal/types";
import { createProposalTemplate } from "@/lib/proposal/templates";
import { createCanvas } from "@napi-rs/canvas";
import { validatePngBytes } from "@/lib/proposal/png";

const fixture = (): ProposalDocument => ({ schemaVersion: 2, id: "draft", title: "제안서", client: "시험 발주처", projectName: "시험 용역", submissionDate: "2026-10-30", templateId: "permit-general", theme: "navy", sections: [{ id: "s1", title: "수행 계획", blocks: [{ id: "text1", kind: "text", text: "수행 내용" }] }] });
const request = (body: unknown) => new Request("https://test.local/api/sales/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = (id: string, edition?: string) => ({ params: Promise.resolve({ id, edition }) });
const rowResult = (rows: Record<string, unknown>[]) => rows.length ? [{ columns: Object.keys(rows[0]), values: rows.map((r) => Object.keys(rows[0]).map((k) => r[k])) }] : [];
function harness(overrides: Partial<ProposalStoreDeps> = {}) {
  const docs = new Map<string, { document: ProposalDocument; revision: number }>();
  const editions: Record<string, unknown>[] = [];
  const reads: string[] = [];
  const db: ProposalDb = {
    async exec(sql, params = []) {
      reads.push(sql);
      if (sql.includes("FROM proposal_editions")) return rowResult(editions.filter((e) => e.document_id === params[0] && (params.length < 2 || e.edition_id === params[1])).map((e) => ({ ...e, size_bytes: (e.hwpx_bytes as Buffer).length })));
      const doc = docs.get(String(params[0]));
      if (!doc) return [];
      return rowResult([{ document: structuredClone(doc.document), revision: doc.revision, template_id: doc.document.templateId }]);
    },
    async run(sql, p = []) {
      if (sql.startsWith("INSERT INTO proposal_documents")) docs.set(String(p[0]), { document: JSON.parse(String(p[1])), revision: 1 });
      else if (sql.startsWith("UPDATE proposal_documents")) { const prev = docs.get(String(p[0]))!; docs.set(String(p[0]), { document: JSON.parse(String(p[1])), revision: prev.revision + 1 }); }
      else if (sql.startsWith("INSERT INTO proposal_editions")) editions.push({ edition_id: p[0], document_id: p[1], revision: p[2], document_snapshot: JSON.parse(String(p[3])), figure_snapshot: JSON.parse(String(p[4])), hwpx_bytes: p[5], hwpx_sha256: p[6], file_name: p[7], created_at: p[8] });
      else assert.fail(`뜻밖의 쓰기: ${sql}`);
    },
  };
  const store = createProposalStore({ readDb: async () => db, transaction: async (work) => work(db), render: async () => Buffer.from("PK-test-hwpx"), decodeImage: async (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }), ...overrides });
  const permissions: string[] = [];
  const api = createProposalHandlers({ store, authorize: async (key) => { permissions.push(key); return { userId: "tester" }; } });
  return { store, docs, editions, reads, api, permissions };
}
const figure = () => ({ kind: "figure" as const, id: "figure1", title: "절차", widthMm: 100, heightMm: 50, spec: { type: "process" as const, content: { items: [{ id: "i1", label: "진단" }, { id: "i2", label: "설계" }, { id: "i3", label: "검토" }] } } });
/** 표지 배경 PNG(A4 150dpi) — v2 발행에 필수 */
const cover = () => ({ __cover: pngHeader(1241, 1754) });
function pngHeader(width: number, height: number) {
  if (width * height <= 30_000_000) return `data:image/png;base64,${createCanvas(width, height).toBuffer("image/png").toString("base64")}`;
  const bytes = Buffer.alloc(24); Buffer.from("89504e470d0a1a0a", "hex").copy(bytes); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

test("초안 생성·저장·재열기: 서버 ID와 rev를 반환하고 누락/과거 rev를 거절한다", async () => {
  const h = harness(); const created = await h.api.create(request({ document: fixture(), rev: 0 }));
  assert.equal(created.status, 201); const first = await created.json(); assert.match(first.document.id, /^prp_/); assert.equal(first.rev, 1);
  const edited = { ...first.document, title: "개정 제안서" };
  const missing = await h.api.save(request({ document: edited }), context(first.document.id)); assert.equal(missing.status, 400);
  assert.equal(h.docs.get(first.document.id)?.document.title, "제안서");
  const saved = await h.api.save(request({ document: edited, rev: first.rev }), context(first.document.id)); assert.equal(saved.status, 200); assert.equal((await saved.json()).rev, 2);
  const stale = await h.api.save(request({ document: first.document, rev: 1 }), context(first.document.id)); assert.equal(stale.status, 409); assert.equal((await stale.json()).conflict, true);
  const reopened = await h.api.get(request({}), context(first.document.id)); assert.equal((await reopened.json()).document.title, "개정 제안서");
});

test("문서 ID 변조·템플릿 변경은 원본을 덮어쓰지 못한다", async () => {
  const h = harness(); const saved = await h.store.create(fixture(), 0, "a");
  await assert.rejects(h.store.save(saved.document.id, { ...saved.document, id: "other" }, 1, "b"), /ID/);
  await assert.rejects(h.store.save(saved.document.id, { ...saved.document, templateId: "sustainability" }, 1, "b"), /템플릿/);
  assert.equal(h.docs.get(saved.document.id)?.revision, 1);
});

test("모든 API는 권한 확인 전 저장소에 접근하지 않는다", async () => {
  const h = harness(); const api = createProposalHandlers({ store: h.store, authorize: async () => { throw new ProposalError("권한 없음", 403); } });
  const responses = await Promise.all([api.list(), api.create(request({})), api.get(request({}), context("x")), api.save(request({}), context("x")), api.editions(request({}), context("x")), api.publish(request({}), context("x")), api.download(request({}), context("x", "e"))]);
  assert.ok(responses.every((r) => r.status === 403)); assert.equal(h.reads.length, 0);
});

test("발행에는 편집·발행 권한 둘 다 필요하다", async () => {
  const h = harness(); const saved = await h.store.create(fixture(), 0, "a");
  const api = createProposalHandlers({ store: h.store, authorize: async (key) => { if (key === "catalog.publish") throw new ProposalError("발행 권한 없음", 403); return { userId: "a" }; } });
  assert.equal((await api.publish(request({ rev: 1, figures: cover() }), context(saved.document.id))).status, 403);
  assert.equal(h.editions.length, 0);
});

test("발행 스냅샷은 이후 초안 수정과 분리되며 저장된 HWPX를 내려준다", async () => {
  const h = harness(); const saved = await h.store.create(fixture(), 0, "a");
  const response = await h.api.publish(request({ rev: 1, figures: cover() }), context(saved.document.id)); assert.equal(response.status, 201);
  const { edition } = await response.json();
  await h.store.save(saved.document.id, { ...saved.document, title: "나중 수정" }, 1, "a");
  assert.equal((h.editions[0].document_snapshot as ProposalDocument).title, "제안서");
  const download = await h.api.download(request({}), context(saved.document.id, edition.id)); assert.equal(download.status, 200); assert.equal(await download.text(), "PK-test-hwpx");
  assert.match(download.headers.get("Content-Disposition")!, /filename\*=UTF-8''/);
  assert.equal((await h.api.download(request({}), context("other", edition.id))).status, 404);
  h.editions[0].hwpx_bytes = Buffer.from("PK-modified");
  assert.equal((await h.api.download(request({}), context(saved.document.id, edition.id))).status, 500);
});

test("렌더 도중 초안이 바뀌면 발행을 취소하고 이전 판으로 잘못 고정하지 않는다", async () => {
  let changed = () => {}; const h = harness({ render: async () => { changed(); return Buffer.from("PK-test-hwpx"); } });
  const saved = await h.store.create(fixture(), 0, "a"); changed = () => { h.docs.get(saved.document.id)!.revision = 2; };
  await assert.rejects(h.store.publish(saved.document.id, 1, cover(), "a"), (e: unknown) => e instanceof ProposalError && e.status === 409);
  assert.equal(h.editions.length, 0);
});

test("도식 누락·외부 URL·깨진 PNG·잘못된 크기·저해상도를 발행하지 않는다", async () => {
  const doc = fixture(); doc.sections[0].blocks.push(figure());
  const h = harness(); const saved = await h.store.create(doc, 0, "a");
  await assert.rejects(h.store.publish(saved.document.id, 1, cover(), "a"), /다시 생성/);
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), figure1: "https://external/image.png" }, "a"), /PNG/);
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), figure1: "data:image/png;base64,YWJj" }, "a"), /인식/);
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), figure1: pngHeader(100000, 100000) }, "a"), /픽셀/);
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), extra: pngHeader(1200, 600) }, "a"), /없는 도식/);
  assert.equal(h.editions.length, 0);
  for (const size of [{ width: 100, height: 50 }, { width: 1200, height: 100 }]) {
    const low = harness({ decodeImage: async () => size }); const lowSaved = await low.store.create(doc, 0, "a");
    await assert.rejects(low.store.publish(lowSaved.document.id, 1, { ...cover(), figure1: pngHeader(size.width, size.height) }, "a"), /dpi|비율/);
  }
  const broken = harness({ decodeImage: async () => { throw new Error("decode failed"); } }); const brokenSaved = await broken.store.create(doc, 0, "a");
  await assert.rejects(broken.store.publish(brokenSaved.document.id, 1, { ...cover(), figure1: pngHeader(1200, 600) }, "a"), /읽지/);
});

test("실제 PNG 디코더로 도식 발행·그림 원본 보존을 확인하고 손상된 본문 그림을 거절한다", async () => {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const canvas = createCanvas(1200, 600); const ctx = canvas.getContext("2d"); ctx.fillStyle = "#102543"; ctx.fillRect(0, 0, 1200, 600);
  const png = `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  const h = harness({ decodeImage: async (bytes) => { const img = await loadImage(bytes); return { width: img.width, height: img.height }; } });
  const doc = fixture(); doc.sections[0].blocks.push(figure()); const saved = await h.store.create(doc, 0, "a");
  await h.store.publish(saved.document.id, 1, { ...cover(), figure1: png }, "a");
  assert.deepEqual(Object.keys(h.editions[0].figure_snapshot as object).sort(), ["__cover", "figure1"]);
  assert.equal((h.editions[0].figure_snapshot as Record<string, string>).figure1, png);
  const truncated = Buffer.alloc(24); Buffer.from("89504e470d0a1a0a", "hex").copy(truncated); truncated.writeUInt32BE(1200, 16); truncated.writeUInt32BE(600, 20);
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), figure1: `data:image/png;base64,${truncated.toString("base64")}` }, "a"), /읽지/);
  const broken = fixture(); broken.sections[0].blocks.push({ kind: "image", id: "img1", title: "손상", dataUrl: "data:image/png;base64,iVBORw0KGgo=", widthMm: 100, heightMm: 50 });
  const brokenSaved = await h.store.create(broken, 0, "a");
  await assert.rejects(h.store.publish(brokenSaved.document.id, 1, cover(), "a"), (error: unknown) => error instanceof ProposalError && error.status === 422);
});

test("PNG CRC·청크 절단을 네이티브 호출 전에 거절한다", async () => {
  const valid = createCanvas(1200, 600).toBuffer("image/png");
  assert.deepEqual(validatePngBytes(valid), { width: 1200, height: 600 });
  const changed = Buffer.from(valid); changed[29] ^= 1;
  assert.throws(() => validatePngBytes(changed), /검사값/);
  assert.throws(() => validatePngBytes(valid.subarray(0, valid.length - 5)), /청크/);
  let calls = 0; const h = harness({ decodeImage: async (bytes) => { calls++; return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; } });
  const doc = fixture(); doc.sections[0].blocks.push(figure()); const saved = await h.store.create(doc, 0, "a");
  await assert.rejects(h.store.publish(saved.document.id, 1, { ...cover(), figure1: `data:image/png;base64,${changed.toString("base64")}` }, "a"), /검사값/);
  assert.equal(calls, 1, "표지 배경만 디코딩하고 손상 도식은 네이티브 호출 전에 거절"); assert.equal(h.editions.length, 0);
});

test("미완성 문서는 저장 가능하지만 발행은 막는다", async () => {
  const h = harness(); const saved = await h.store.create({ ...fixture(), client: "", submissionDate: "" }, 0, "a");
  await assert.rejects(h.store.publish(saved.document.id, 1, cover(), "a"), /입력/);
  assert.equal(h.docs.size, 1); assert.equal(h.editions.length, 0);
});

test("안내표식이 제목·장·본문에 남아 있으면 저장은 보존하고 발행만 막는다", async () => {
  const drafts = [fixture(), fixture(), fixture()];
  drafts[0].title = "[작성 필요] 제목";
  drafts[1].sections[0].title = "[작성 필요] 장";
  drafts[2].sections[0].blocks = [{ kind: "text", id: "t", text: "[작성 필요] 내용" }];
  for (const draft of drafts) {
    const h = harness(); const saved = await h.store.create(draft, 0, "a");
    await assert.rejects(h.store.publish(saved.document.id, 1, cover(), "a"), /작성 필요/);
    assert.equal(h.docs.get(saved.document.id)?.revision, 1); assert.equal(h.editions.length, 0);
  }
});

test("모든 템플릿은 실제 서버 저장 검증을 통과한다", () => {
  for (const id of ["permit-general", "permit-power", "permit-inspection", "sustainability"] as const) {
    const doc = createProposalTemplate(id); const validated = validateProposalDocument(doc);
    assert.equal(validated.templateId, id); assert.equal(validated.sections.length, doc.sections.length);
  }
});

test("중복 블록·잘못된 표·불가능한 날짜·지표 생방송 바인딩을 거절한다", () => {
  const doc = fixture(); doc.sections[0].blocks.push({ kind: "text", id: "text1", text: "중복" }); assert.throws(() => validateProposalDocument(doc), /중복/);
  const table = fixture(); table.sections[0].blocks.push({ kind: "table", id: "t1", title: "표", style: "grid", columns: ["a", "b"], rows: [["one"]] }); assert.throws(() => validateProposalDocument(table), /열 수/);
  assert.throws(() => validateProposalDocument({ ...fixture(), submissionDate: "2026-02-30" }), /제출일/);
  const metric = fixture(); const f = figure(); metric.sections[0].blocks.push({ ...f, spec: { ...f.spec, content: { items: [{ id: "i1", label: "실적", metric: "live.count" }] } } }); assert.throws(() => validateProposalDocument(metric), /직접 입력/);
});

test("직접 발행 API도 화면과 같은 도식 차단 사유를 적용하고 초안을 보존한다", async () => {
  const cases = [
    { type: "share", items: [{ id: "i1", label: "가", value: 0 }, { id: "i2", label: "나", value: 10 }], reason: /0 이하/ },
    { type: "share", items: [{ id: "i1", label: "가", value: -1 }, { id: "i2", label: "나", value: 10 }], reason: /0 이하/ },
    { type: "bar", items: [{ id: "i1", label: "가" }, { id: "i2", label: "나", value: 10 }], reason: /수치가 없는/ },
    { type: "process", items: [{ id: "i1", label: "가", value: 1 }, { id: "i2", label: "나", value: 2 }, { id: "i3", label: "다", value: 3 }], reason: /수치가 사라/ },
  ];
  for (const value of cases) {
    const h = harness(); const doc = fixture();
    doc.sections[0].blocks.push({ ...figure(), spec: { type: value.type, content: { items: value.items } } } as ProposalDocument["sections"][number]["blocks"][number]);
    const saved = await h.store.create(doc, 0, "a");
    const response = await h.api.publish(request({ rev: 1, figures: cover() }), context(saved.document.id));
    assert.equal(response.status, 422); assert.match((await response.json()).error, value.reason);
    assert.equal(h.docs.get(saved.document.id)?.revision, 1); assert.equal(h.editions.length, 0);
  }
});

test("프로토타입 이름을 도식 유형으로 받지 않으며 블록 ID로 쓸 때도 그림 맵을 오염시키지 않는다", async () => {
  const invalid = fixture(); invalid.sections[0].blocks.push({ ...figure(), spec: { type: "toString", content: { items: [] } } } as unknown as ProposalDocument["sections"][number]["blocks"][number]);
  assert.throws(() => validateProposalDocument(invalid), ProposalError);
  const doc = fixture(); doc.sections[0].blocks.push({ ...figure(), id: "__proto__" });
  const h = harness(); const saved = await h.store.create(doc, 0, "a"); const png = pngHeader(1200, 600);
  await h.store.publish(saved.document.id, 1, JSON.parse(JSON.stringify({ ...cover(), ["__proto__"]: png })), "a");
  assert.equal(Object.hasOwn(h.editions[0].figure_snapshot as object, "__proto__"), true);
});

test("JSON 오류와 과대 요청은 400/413이고 원문을 로그로 남기지 않는다", async () => {
  const h = harness(); const bad = new Request("https://test.local", { method: "POST", body: "{" });
  assert.equal((await h.api.create(bad)).status, 400);
  const big = new Request("https://test.local", { method: "POST", body: "{}", headers: { "Content-Length": String(31 * 1024 * 1024) } });
  assert.equal((await h.api.create(big)).status, 413); assert.equal(h.docs.size, 0);
});
