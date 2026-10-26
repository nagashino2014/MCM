// 회사소개서 발행·변경 감지(P7) 순수 모듈 시험 — 지문 비교(추가·변경·삭제·되돌림·옛 지문), 사람이 읽는 문장, 알림 본문,
// 판 옵션(요약본 = 부록 제외, 목차 부록 줄 숨김), 마스킹판 본문 일괄 가리기. DB·converter 는 쓰지 않는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countBySource,
  diffFingerprints,
  emptyFingerprint,
  fields,
  notifyBody,
  parseFingerprint,
  summarize,
  type CatalogFingerprint,
} from "@/lib/catalog/refresh/diff";
import { buildPagePlan } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import { maskName, maskNamesInHtml, nameMasker } from "@/lib/catalog/render/masking";
import { parseRenderOptions } from "@/lib/catalog/render/options";
import type { RenderCtx } from "@/lib/catalog/render/types";
import { composeDocument } from "@/lib/catalog/studio/compose";
import { renderTrees } from "@/lib/catalog/studio/render-tree";
import { renderToStaticMarkup } from "react-dom/server";
import { makeFixture } from "./catalog-studio-fixture";

const COVER: CoverChoice = { cover: "leaf", photo: "k/assets/hq-cover-tall.webp" };
const ctxOf = (o: Partial<RenderCtx["opts"]> = {}): RenderCtx => ({
  url: (k) => `/x/${k}`,
  opts: { edition: "print", naming: "masked", ...o },
  docLabel: "회사소개서 2026.10",
  fontSet: "pretendard",
  concept: "navy",
});

function fp(sources: CatalogFingerprint["sources"]): CatalogFingerprint {
  return { v: 1, at: "2026-10-26T00:00:00Z", sources };
}

const BASE = fp({
  contracts: {
    c1: { l: "2025 가나화학 통합환경허가 취득 용역 수행 중", d: fields([["분류", "통합환경허가"], ["금액", "50,000,000원"], ["허가일", ""]]) },
    c2: { l: "2024 다라전자 HAPs 용역", d: fields([["분류", "HAPs"], ["금액", "8,000,000원"]]) },
  },
  people: { "e:1": { l: "직원 홍길동(대리)", d: fields([["구분", "직원"], ["게재", "게재"]]) } },
  company_profile: { 홈페이지: { l: "홈페이지", d: { 값: "https://kesi.example" } } },
});

test("지문 비교 — 새 계약 1건은 '새 실적' 1건", () => {
  const cur = fp({
    ...BASE.sources,
    contracts: { ...BASE.sources.contracts, c3: { l: "2026 마바제지 통합환경허가 취득 용역 수행 중", d: fields([["분류", "통합환경허가"]]) } },
  });
  const diffs = diffFingerprints(BASE, cur);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].source, "contracts");
  assert.equal(diffs[0].kind, "added");
  assert.equal(diffs[0].key, "c3");
  assert.equal(diffs[0].summary, "새 실적 — 2026 마바제지 통합환경허가 취득 용역 수행 중");
});

test("지문 비교 — 변경은 칸별 전후 값, 삭제·퇴사도 잡는다", () => {
  const cur = fp({
    contracts: {
      c1: { l: "2025 가나화학 통합환경허가 취득 용역 준공", d: fields([["분류", "통합환경허가"], ["금액", "55,000,000원"], ["허가일", "2026-10-20"]]) },
    },
    people: {},
    company_profile: BASE.sources.company_profile,
  });
  const diffs = diffFingerprints(BASE, cur);
  const changed = diffs.find((d) => d.key === "c1")!;
  assert.equal(changed.kind, "changed");
  assert.deepEqual(
    changed.fields.map((f) => [f.name, f.before, f.after]),
    [
      ["금액", "50,000,000원", "55,000,000원"],
      ["허가일", "", "2026-10-20"],
    ]
  );
  assert.match(changed.summary, /^실적 변경 — .*\(금액·허가일\)$/);
  assert.equal(diffs.find((d) => d.key === "c2")?.kind, "removed");
  const person = diffs.find((d) => d.source === "people")!;
  assert.equal(person.kind, "removed");
  assert.equal(person.summary, "인물 빠짐 — 직원 홍길동(대리)");
  // 순서: 원천 순서(실적 → 인물) · 종류(추가 → 변경 → 삭제)
  assert.deepEqual(diffs.map((d) => `${d.source}:${d.kind}`), ["contracts:changed", "contracts:removed", "people:removed"]);
});

test("지문 비교 — 같으면 0건, 되돌리면 0건, 기준에 없는 원천은 비교하지 않는다", () => {
  assert.equal(diffFingerprints(BASE, BASE).length, 0);
  const edited = fp({ ...BASE.sources, company_profile: { 홈페이지: { l: "홈페이지", d: { 값: "https://new.example" } } } });
  assert.equal(diffFingerprints(BASE, edited).length, 1);
  assert.equal(diffFingerprints(BASE, fp({ ...edited.sources, company_profile: BASE.sources.company_profile })).length, 0);
  // 옛 지문(연혁 원천 없음) ↔ 새 지문(연혁 3건) — 연혁이 통째로 '추가'로 쏟아지지 않는다
  const withHistory = fp({ ...BASE.sources, history: { h1: { l: "2026.10 특허 등록", d: { 내용: "특허" } } } });
  assert.equal(diffFingerprints(BASE, withHistory).length, 0);
});

test("칸 만들기·저장값 읽기 — 빈 값은 없음과 같다", () => {
  assert.deepEqual(fields([["a", ""], ["b", null], ["c", false], ["d", true], ["e", "  x  y "], ["f", 0]]), { d: "예", e: "x y", f: "0" });
  assert.equal(parseFingerprint(null), null);
  assert.equal(parseFingerprint({ v: 2, sources: {} }), null);
  assert.equal(parseFingerprint("{bad"), null);
  assert.deepEqual(parseFingerprint(JSON.stringify(BASE))?.sources, BASE.sources);
  assert.deepEqual(emptyFingerprint("t").sources, {});
});

test("사람이 읽는 문장·알림 본문·원천별 건수", () => {
  assert.equal(summarize("history", "added", "2026.10 특허 등록", []), "연혁 추가 — 2026.10 특허 등록");
  const many = ["a", "b", "c", "d", "e"].map((n) => ({ name: n, before: "", after: "1" }));
  assert.equal(summarize("credentials", "changed", "인증 ISO", many), "인증·등록 변경 — 인증 ISO (a·b·c·d 외 1)");
  const items = [
    { source: "contracts" as const, kind: "added" as const, summary: "새 실적 — 1" },
    { source: "contracts" as const, kind: "added" as const, summary: "새 실적 — 2" },
    { source: "people" as const, kind: "removed" as const, summary: "인물 빠짐 — 3" },
    { source: "history" as const, kind: "added" as const, summary: "연혁 추가 — 4" },
  ];
  assert.equal(notifyBody(items), "새 실적 — 1\n새 실적 — 2\n인물 빠짐 — 3\n그 외 1건");
  assert.deepEqual(
    countBySource(items).map((c) => `${c.label} ${c.count}`),
    ["실적(계약) 2", "인물 1", "연혁 1"]
  );
});

test("판 옵션 — 범위 기본은 풀버전, 모르는 값도 풀버전", () => {
  assert.deepEqual(parseRenderOptions({}), { edition: "print", naming: "masked", scope: "full" });
  assert.equal(parseRenderOptions({ scope: "summary" }).scope, "summary");
  assert.equal(parseRenderOptions({ scope: "x" }).scope, "full");
});

function buildFullHtml(): string {
  const data = makeFixture();
  const pages = composeDocument(ctxOf({}), data, COVER, []);
  return renderToStaticMarkup(<>{renderTrees(pages.map((p) => p.tree), { url: (k) => `/x/${k}`, data })}</>);
}

test("요약본 — 부록 쪽(A01·A02·A03)이 빠지고 본편은 그대로, 목차 부록 줄은 쪽을 못 찾아 숨는다", () => {
  const data = makeFixture();
  const keys = (o: Partial<RenderCtx["opts"]>) => buildPagePlan(ctxOf(o), data, COVER).map((p) => p.key);
  const full = keys({ naming: "real" });
  const summary = keys({ naming: "real", scope: "summary" });
  assert.ok(full.some((k) => k.startsWith("a0")), "풀버전에는 부록");
  assert.equal(summary.filter((k) => k.startsWith("a0")).length, 0);
  assert.deepEqual(
    summary,
    full.filter((k) => !k.startsWith("a0"))
  );
  // 목차 부록 줄은 data-ref="sec-app" + data-ref-missing="hide" 라 쪽이 없으면 paginate 가 줄째 지운다
  const pages = composeDocument(ctxOf({ scope: "summary" }), data, COVER, []);
  const html = renderToStaticMarkup(<>{renderTrees(pages.map((p) => p.tree), { url: (k) => `/x/${k}`, data })}</>);
  assert.match(html, /data-ref="sec-app"[^>]*data-ref-missing="hide"|data-ref-missing="hide"[^>]*data-ref="sec-app"/);
  assert.equal(/data-anchors="[^"]*a01/.test(html), false);
  assert.match(buildFullHtml(), /data-anchors="sec-app a01"/);
});

test("마스킹판 일괄 가리기 — 본문·속성의 세 글자 이상 실명을 ○로, 두 글자 이름·일반 낱말은 건드리지 않는다", () => {
  const html = `<p>대표이사 김철수</p><img alt="김철수 사진"><p>남궁민수 이사 · 이수 과정 이수 · 정진</p><p>이미 가린 김○수</p>`;
  const out = maskNamesInHtml(html, ["김철수", "남궁민수", "이수", "정진", ""]);
  assert.equal(out, `<p>대표이사 김○수</p><img alt="김○수 사진"><p>남○○수 이사 · 이수 과정 이수 · 정진</p><p>이미 가린 김○수</p>`);
  assert.equal(maskNamesInHtml(html, []), html);
  assert.equal(maskName("이수"), "이○");
});

test("마스킹판도 대표이사는 실명 — 이름 가리기·일괄 목록에서 대표이사만 뺀다", () => {
  const masked = nameMasker(true, ["홍길동", " ", ""]);
  assert.equal(masked.nm("홍길동"), "홍길동");
  assert.equal(masked.nm("김철수"), "김○수");
  assert.deepEqual(masked.maskList(["홍길동", "김철수", "남궁민수", ""]), ["김철수", "남궁민수"]);
  const html = `<p>대표이사 홍길동</p><p>이사 김철수</p>`;
  assert.equal(maskNamesInHtml(html, masked.maskList(["홍길동", "김철수"])), `<p>대표이사 홍길동</p><p>이사 김○수</p>`);
  const real = nameMasker(false, ["홍길동"]);
  assert.equal(real.nm("김철수"), "김철수");
  assert.deepEqual(real.maskList(["김철수"]), []);
});
