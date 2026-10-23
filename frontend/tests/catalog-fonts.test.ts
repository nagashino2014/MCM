// 회사소개서 서체 라이브러리(P5b) 시험 — 업로드 서체 분석(fsType·글자 범위·수치)·용도 판정·크기 보정, 세트 고르기 규칙·@font-face 조립.
// 파일은 저장소에 있는 서체(public/print-kit/fonts · public/fonts)를 쓰고, 포함 제한은 OS/2 fsType 두 바이트를 바꾼 사본으로 본다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { analyzeFontFile, computeSizeAdjust, groupFamilies, judgeFamily, ksx1001Hangul, referenceMetrics } from "@/lib/catalog/font-analysis";
import { buildCustomFontSet, checkFontSetChoice, defaultRoleWeights, nearestWeight } from "@/lib/catalog/fonts";
import { inRanges, toRanges, type CatalogFont, type FontRole } from "@/lib/catalog/font-types";
import { fontFaceCss } from "@/lib/print-kit/document";

const pub = (rel: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public", rel)));
const REF = referenceMetrics(pub("print-kit/fonts/Pretendard-Regular.woff"));

/** TrueType 파일의 OS/2 fsType 을 바꾼 사본(표 디렉터리에서 OS/2 위치를 찾아 +8 바이트) */
function withFsType(bytes: Uint8Array, fsType: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const dv = new DataView(out.buffer);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(out[rec], out[rec + 1], out[rec + 2], out[rec + 3]);
    if (tag === "OS/2") {
      dv.setUint16(dv.getUint32(rec + 8) + 8, fsType);
      return out;
    }
  }
  throw new Error("OS/2 없음");
}

test("한글 완성형 2,350자 목록", () => {
  const ks = ksx1001Hangul();
  assert.equal(ks.length, 2350);
  assert.equal(String.fromCodePoint(ks[0]), "가");
  assert.equal(String.fromCodePoint(ks[ks.length - 1]), "힝");
});

test("범위 목록 — 만들기·찾기", () => {
  const r = toRanges([0x41, 0x42, 0x43, 0xac00, 0xac01, 0x20]);
  assert.deepEqual(r, [[0x20, 0x20], [0x41, 0x43], [0xac00, 0xac01]]);
  assert.ok(inRanges(r, 0x42) && inRanges(r, 0xac01) && !inRanges(r, 0x44));
});

test("기본 서체 분석 — 크기 보정이 P5 실측값(노토 산스 93.9%·세리프 89.4%)과 같다", () => {
  assert.ok(Math.abs((REF.hangulAdvance ?? 0) - 0.8643) < 0.002, `프리텐다드 한글 폭 ${REF.hangulAdvance}`);
  const sans = analyzeFontFile(pub("print-kit/fonts/NotoSansKR-Regular.woff"), "NotoSansKR-Regular.woff");
  assert.deepEqual(sans.errors, []);
  assert.equal(sans.family, "Noto Sans KR");
  assert.equal(sans.weight, 400);
  assert.equal(sans.embed, "installable");
  assert.equal(sans.coverage.hangul2350, 2350);
  assert.equal(sans.classification, "sans");
  const adj = computeSizeAdjust(sans.metrics, REF, sans.coverage.hangul2350);
  assert.equal(adj.basis, "hangul");
  assert.ok(Math.abs(adj.sizeAdjust - 93.9) <= 0.2, `노토 산스 ${adj.sizeAdjust}`);
  // override 는 size-adjust 를 곱한 크기 기준 — 곱하면 기준 서체 높이가 된다
  assert.ok(Math.abs((adj.ascentOverride * adj.sizeAdjust) / 100 - REF.ascent * 100) < 0.2);
  const serif = analyzeFontFile(pub("print-kit/fonts/NotoSerifKR-Bold.woff"), "NotoSerifKR-Bold.woff");
  assert.equal(serif.classification, "serif");
  assert.equal(serif.weight, 700);
  assert.ok(Math.abs(computeSizeAdjust(serif.metrics, REF, 2350).sizeAdjust - 89.4) <= 0.2);
});

test("업로드 판정 — 나눔고딕(TrueType) 보통·굵게는 본문 가능 한 패밀리", () => {
  const a = [analyzeFontFile(pub("fonts/NanumGothic.ttf"), "NanumGothic.ttf"), analyzeFontFile(pub("fonts/NanumGothicBold.ttf"), "NanumGothicBold.ttf")];
  assert.deepEqual(a.map((x) => x.errors), [[], []]);
  assert.equal(a[0].outline, "truetype");
  assert.equal(a[0].familyLocal, "나눔고딕");
  const fam = groupFamilies(a, REF, new Map());
  assert.equal(fam.length, 1);
  assert.deepEqual(fam[0].weights, [400, 700]);
  assert.equal(fam[0].bodyCapable, true);
  assert.deepEqual(fam[0].roles, ["display", "body", "figure"]);
  assert.equal(fam[0].displayName, "나눔고딕");
});

test("업로드 판정 — 굵기 하나뿐이면 제목 전용, 명조는 serif", () => {
  const a = [analyzeFontFile(pub("fonts/kopub-batang-bd.ttf"), "kopub-batang-bd.ttf")];
  const fam = groupFamilies(a, REF, new Map());
  assert.equal(fam[0].bodyCapable, false);
  assert.ok(fam[0].reasons.includes("굵기 400(보통) 없음"));
  assert.equal(fam[0].classification, "serif");
  // Medium(500) + Bold(700) 은 본문 가능
  const both = groupFamilies([analyzeFontFile(pub("fonts/kopub-batang-md.ttf"), "md.ttf"), a[0]], REF, new Map());
  assert.equal(both[0].bodyCapable, true);
});

test("업로드 판정 — 포함 제한(Restricted)은 거부, 미리보기·인쇄 전용은 경고와 함께 받는다", () => {
  const nanum = pub("fonts/NanumGothic.ttf");
  const restricted = analyzeFontFile(withFsType(nanum, 0x0002), "restricted.ttf");
  assert.equal(restricted.embed, "restricted");
  assert.ok(restricted.errors.some((e) => e.includes("포함 제한")));
  assert.equal(groupFamilies([restricted], REF, new Map()).length, 0);
  const preview = analyzeFontFile(withFsType(nanum, 0x0004), "preview.ttf");
  assert.equal(preview.embed, "print");
  assert.deepEqual(preview.errors, []);
  assert.ok(preview.warnings.some((w) => w.includes("미리보기·인쇄 전용")));
  // 두 비트가 함께면 너그러운 쪽(미리보기·인쇄) + Type 3 주의
  const both = analyzeFontFile(withFsType(nanum, 0x0006), "both.ttf");
  assert.equal(both.embed, "print");
  assert.ok(both.warnings.some((w) => w.includes("Type 3")));
  assert.ok(analyzeFontFile(new Uint8Array(30 * 1024 * 1024), "big.ttf").errors[0].includes("20MB"));
  assert.ok(analyzeFontFile(new Uint8Array([1, 2, 3, 4, 5]), "x.txt").errors.length > 0);
});

test("용도 판정 — 한글 완성형이 빠지면 제목 전용(빠진 글자 수가 사유에 나온다)", () => {
  const base = analyzeFontFile(pub("fonts/NanumGothic.ttf"), "NanumGothic.ttf");
  const partial = { ...base.coverage, hangul2350: 2287, hangulMissing: "환경업" };
  const r = judgeFamily(
    [
      { weight: 400, italic: false, coverage: partial, metrics: base.metrics, embed: "installable" },
      { weight: 700, italic: false, coverage: base.coverage, metrics: base.metrics, embed: "installable" },
    ],
    REF,
    { classification: "sans" }
  );
  assert.equal(r.bodyCapable, false);
  assert.deepEqual(r.reasons, ["한글 완성형 63자 없음"]);
  assert.deepEqual(r.roles, ["display", "figure"]);
  // 교집합 — 한 굵기라도 없으면 없음
  assert.equal(r.coverage.hangul2350, 2287);
  assert.ok(r.coverage.hangulMissing.includes("환"));
});

test("굵기 대응 — CSS 맞춤 규칙", () => {
  assert.equal(nearestWeight(400, [300, 500, 700]), 500);
  assert.equal(nearestWeight(500, [400, 700]), 400);
  assert.equal(nearestWeight(600, [400, 700]), 700);
  assert.equal(nearestWeight(600, [400, 500]), 500);
  assert.equal(nearestWeight(700, [400]), 400);
  assert.deepEqual(defaultRoleWeights([400, 600, 700]), { "400": 400, "500": 400, "600": 600, "700": 700 });
});

const font = (id: string, over: Partial<CatalogFont> = {}): CatalogFont => {
  const a = analyzeFontFile(pub("fonts/NanumGothic.ttf"), "NanumGothic.ttf");
  return {
    fontId: id,
    family: "NanumGothic",
    displayName: "나눔고딕",
    source: "upload",
    files: [400, 700].map((w) => ({ weight: w, style: "normal", storageKey: `catalog/fonts/${id}/src/${w}.ttf`, woffKey: `catalog/fonts/${id}/${w}-abc.woff`, format: "ttf", bytes: 1, woffBytes: 1, fileName: "x", postscriptName: "x", outline: "truetype", converted: false, fromVariable: false, uploadedAt: "" })),
    roles: ["display", "body", "figure"],
    bodyCapable: true,
    reasons: [],
    classification: "sans",
    license: null,
    embed: "installable",
    noSubsetting: false,
    coverage: a.coverage,
    metrics: a.metrics,
    sizeAdjust: computeSizeAdjust(a.metrics, REF, a.coverage.hangul2350),
    isActive: true,
    uploadedBy: null,
    uploadedByName: null,
    uploadedAt: "",
    ...over,
  };
};
const wm = (m: Record<string, number>) => ({ display: m, body: m, figure: m }) as Record<FontRole, Record<string, number>>;

test("세트 규칙 — 본문에 제목 전용 금지, 가는 본문 금지, 명조 본문 경고", () => {
  const ok = font("f-ok");
  const titleOnly = font("f-title", { roles: ["display", "figure"], bodyCapable: false, reasons: ["굵기 400(보통) 없음"] });
  const map = wm({ "400": 400, "500": 400, "600": 700, "700": 700 });
  assert.deepEqual(checkFontSetChoice({ display: ok, body: ok, figure: ok }, map).errors, []);
  const bad = checkFontSetChoice({ display: titleOnly, body: titleOnly, figure: ok }, map);
  assert.ok(bad.errors.some((e) => e.includes("제목 전용")));
  const light = font("f-light", { files: [300, 700].map((w) => ({ ...ok.files[0], weight: w })) });
  assert.ok(checkFontSetChoice({ display: ok, body: light, figure: ok }, wm({ "400": 300, "500": 300, "600": 700, "700": 700 })).errors.some((e) => e.includes("Light")));
  const serif = font("f-serif", { classification: "serif" });
  assert.ok(checkFontSetChoice({ display: ok, body: serif, figure: ok }, map).warnings.some((w) => w.includes("명조 본문")));
  assert.ok(checkFontSetChoice({ display: ok, body: ok, figure: ok }, wm({ "400": 400, "500": 400, "600": 600, "700": 700 })).errors.some((e) => e.includes("굵기 600")));
});

test("세트 조립 — 역할 별칭 @font-face 와 .kc-fontset 변수, 업로드 파일 정보", () => {
  const up = font("f-up");
  const fonts = new Map([["f-up", up]]);
  const def = buildCustomFontSet(
    { setId: "u-test01", name: "시험 세트", displayFontId: "f-up", bodyFontId: "f-up", figureFontId: "f-up", weightMap: wm({ "400": 400, "500": 400, "600": 700, "700": 700 }), orderNo: 0, updatedAt: "" },
    fonts
  );
  assert.equal(def.available, true);
  assert.ok(def.css?.includes(".kc-fontset--u-test01"));
  assert.ok(def.css?.includes(`--kc-font-body: "kcs-u-test01-body", "Pretendard"`));
  const body = def.faces.filter((f) => f.family === "kcs-u-test01-body");
  assert.deepEqual(body.map((f) => [f.weight, f.upload?.fileWeight]), [[400, 400], [500, 400], [600, 700], [700, 700]]);
  assert.equal(body[0].upload?.woffKey, "catalog/fonts/f-up/400-abc.woff");
  assert.ok(def.faces.some((f) => f.family === "Pretendard"));
  assert.equal(def.roleFonts?.display.family, "kcs-u-test01-display");
  const css = fontFaceCss(def.faces.map((f) => ({ family: f.family, weight: f.weight, format: "woff", url: "/x", sizeAdjust: f.sizeAdjust, ascentOverride: f.ascentOverride, descentOverride: f.descentOverride, lineGapOverride: f.lineGapOverride })));
  assert.match(css, /ascent-override: [\d.]+%; descent-override: [\d.]+%; line-gap-override: 0%;/);
  const blocked = buildCustomFontSet(
    { setId: "u-test02", name: "막힌 세트", displayFontId: "f-up", bodyFontId: "f-t", figureFontId: "f-up", weightMap: wm({ "400": 400, "500": 400, "600": 700, "700": 700 }), orderNo: 0, updatedAt: "" },
    new Map([...fonts, ["f-t", font("f-t", { roles: ["display"], bodyCapable: false, reasons: ["장식·손글씨체"] })]])
  );
  assert.equal(blocked.available, false);
  assert.ok(blocked.note?.includes("제목 전용"));
});
