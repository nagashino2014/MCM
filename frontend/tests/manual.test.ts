// 사용 매뉴얼 정합성 검사(docs/manual-help-blueprint.md §5.2) — npm run test:manual
//  - 실패: 키·링크·[[화면 문구]]·topic 사용처·권한 키가 어긋남 → 매뉴얼이 화면과 다른 말을 하게 되는 경우
//  - 실패: 매뉴얼이 없는 메뉴·화면 — 새 화면은 기사를 쓰거나 MANUAL_EXCLUDED_ROUTES 에 사유와 함께 등록한다.
//    (MANUAL_STRICT=0 이면 경고만 — 작업 중 임시 확인용)
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { HELP_TOPICS, MANUAL_ARTICLES, MANUAL_CHANGELOG, MANUAL_CHAPTERS, MANUAL_EXCLUDED_ROUTES } from "../content/manual";
import type { ManualBlock } from "../content/manual";
import { MENU_ITEMS } from "../config/menu";
import { ROUTE_PERMISSIONS } from "../config/menu-permissions";
import { canSeeArticle, findArticleForLocation, getArticle } from "../lib/manual/match";
import { searchManual } from "../lib/manual/search";

const ROOT = process.cwd();
const STRICT = process.env.MANUAL_STRICT !== "0";

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function blockStrings(block: ManualBlock): string[] {
  switch (block.kind) {
    case "p":
    case "tip":
    case "warn":
      return [block.text];
    case "steps":
    case "list":
      return block.items;
    case "table":
      return [...block.head, ...block.rows.flat()];
    case "flow":
      return block.items.flatMap((i) => [i.from, i.to]);
    case "link":
      return block.label ? [block.label] : [];
  }
}

function uiLabels(texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/\[\[(.+?)\]\]/g)) out.push(m[1]);
  return out;
}

const ALL_PERMS = (() => {
  const keys = new Set<string>();
  for (const r of ROUTE_PERMISSIONS) for (const k of r.keys) keys.add(k);
  for (const a of MANUAL_ARTICLES) for (const k of a.requires ?? []) keys.add(k);
  for (const a of MANUAL_ARTICLES) for (const s of a.sections) for (const k of s.requires ?? []) keys.add(k);
  return [...keys].map((k) => `${k}@all`);
})();

test("기사·장·절 키가 고유하고 장이 존재한다", () => {
  const ids = new Set<string>();
  const chapters = new Set(MANUAL_CHAPTERS.map((c) => c.id));
  for (const a of MANUAL_ARTICLES) {
    assert.ok(!ids.has(a.id), `기사 id 중복: ${a.id}`);
    ids.add(a.id);
    assert.ok(chapters.has(a.chapter), `${a.id}: 없는 장 ${a.chapter}`);
    assert.ok(a.summary.length > 0, `${a.id}: summary 비어 있음`);
    assert.match(a.reviewedAt, /^\d{4}-\d{2}-\d{2}$/, `${a.id}: reviewedAt 형식`);
    const secIds = new Set<string>();
    for (const s of a.sections) {
      assert.ok(!secIds.has(s.id), `${a.id}: 절 id 중복 ${s.id}`);
      secIds.add(s.id);
    }
  }
});

test("기사 링크·도움말 more·변경 기록이 존재하는 기사·절을 가리킨다", () => {
  const check = (where: string, article: string, section?: string) => {
    const a = getArticle(article);
    assert.ok(a, `${where}: 없는 기사 ${article}`);
    if (section) assert.ok(a!.sections.some((s) => s.id === section), `${where}: ${article} 에 절 ${section} 없음`);
  };
  for (const a of MANUAL_ARTICLES)
    for (const s of a.sections) for (const b of s.blocks) if (b.kind === "link") check(`${a.id}#${s.id}`, b.article, b.section);
  for (const t of Object.values(HELP_TOPICS)) {
    if (t.more) check(`도움말 ${t.id}`, t.more.article, t.more.section);
    for (const b of t.blocks) if (b.kind === "link") check(`도움말 ${t.id}`, b.article, b.section);
  }
  for (const e of MANUAL_CHANGELOG) for (const id of e.articles) check(`변경 기록 ${e.title}`, id);
});

test("[[화면 문구]]는 sources 파일에 실제로 있다 — 화면 문구가 바뀌면 매뉴얼도 고친다", () => {
  const problems: string[] = [];
  const entries = [
    ...MANUAL_ARTICLES.map((a) => ({
      id: a.id,
      sources: a.sources,
      texts: [...a.summary, ...a.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(blockStrings)])],
    })),
    ...Object.values(HELP_TOPICS).map((t) => ({ id: `도움말 ${t.id}`, sources: t.sources, texts: t.blocks.flatMap(blockStrings) })),
  ];
  for (const e of entries) {
    assert.ok(e.sources.length > 0, `${e.id}: sources 비어 있음`);
    for (const src of e.sources) assert.ok(existsSync(join(ROOT, src)), `${e.id}: sources 파일 없음 ${src}`);
    const corpus = e.sources.map(read).join("\n");
    for (const label of uiLabels(e.texts)) if (!corpus.includes(label)) problems.push(`${e.id}: [[${label}]]`);
  }
  assert.deepEqual(problems, [], `sources 에서 찾지 못한 화면 문구:\n${problems.join("\n")}`);
});

test("도움말 topic 은 레지스트리와 화면 코드가 서로 일치한다", () => {
  const used = new Map<string, string[]>();
  for (const file of [...walk(join(ROOT, "components"), [".tsx"]), ...walk(join(ROOT, "app"), [".tsx"])]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\b(?:topic|helpTopic)="([^"]+)"/g)) {
      const list = used.get(m[1]) ?? [];
      list.push(relative(ROOT, file).split(sep).join("/"));
      used.set(m[1], list);
    }
  }
  for (const [id, files] of used) assert.ok(HELP_TOPICS[id], `레지스트리에 없는 도움말 topic="${id}" (${files.join(", ")})`);
  for (const t of Object.values(HELP_TOPICS)) {
    assert.ok(used.has(t.id), `어디서도 쓰지 않는 도움말: ${t.id}`);
    const src = read(t.sources[0]);
    assert.ok(src.includes(`topic="${t.id}"`) || src.includes(`helpTopic="${t.id}"`), `도움말 ${t.id}: sources[0] (${t.sources[0]}) 에 topic 사용처가 없음`);
  }
});

test("requires 권한 키는 권한표나 서버 코드에 실제로 있는 키다", () => {
  const corpus = [...walk(join(ROOT, "app", "api"), [".ts"]), ...walk(join(ROOT, "lib"), [".ts"])].map((f) => readFileSync(f, "utf8")).join("\n");
  const routeKeys = new Set(ROUTE_PERMISSIONS.flatMap((r) => r.keys));
  const keys = new Set<string>();
  for (const a of MANUAL_ARTICLES) {
    for (const k of a.requires ?? []) keys.add(k);
    for (const s of a.sections) for (const k of s.requires ?? []) keys.add(k);
  }
  for (const k of keys) assert.ok(routeKeys.has(k) || corpus.includes(`"${k}"`), `알 수 없는 권한 키: ${k}`);
});

test("현재 화면 → 기사 매칭과 권한 필터", () => {
  const staff = ["approval.view", "approval.act", "work_plan.view", "work_plan.edit"];
  assert.equal(findArticleForLocation("/approval", "", staff)?.id, "approval.home");
  assert.equal(findArticleForLocation("/approval/draft", "?formId=frm-leave", staff)?.id, "approval.draft");
  assert.equal(findArticleForLocation("/approval/my-hr", "", staff)?.id, "hr.my");
  assert.equal(findArticleForLocation("/todo/abc-123", "", staff)?.id, "todo.main");
  assert.equal(findArticleForLocation("/work-plan/abc-123", "", staff)?.id, "work-plan.report");
  // 정확 일치($) — 전자결재 홈 기사가 하위 관리 화면을 덮지 않는다.
  assert.equal(findArticleForLocation("/approval/attendance", "", staff), null);
  // 파일함은 files.manage 보유자만
  const lib = getArticle("files.library")!;
  assert.equal(canSeeArticle(lib, staff), false);
  assert.equal(canSeeArticle(lib, ["files.manage@all"]), true);
  assert.equal(findArticleForLocation("/files", "", staff), null);
  assert.equal(findArticleForLocation("/files/personal", "", staff)?.id, "files.personal");
  // 재무는 한 화면에 tab 쿼리로 나뉜다 — 하위 탭 별칭도 소메뉴 기사로, 쿼리가 없으면 기본 탭(연결 관리)으로.
  const fin = ["finance.view@all"];
  assert.equal(findArticleForLocation("/finance", "", fin)?.id, "finance.connections");
  assert.equal(findArticleForLocation("/finance", "?tab=recon", fin)?.id, "finance.invoice");
  assert.equal(findArticleForLocation("/finance", "?tab=vatbasis", fin)?.id, "finance.vat-filing");
  assert.equal(findArticleForLocation("/finance", "?tab=severance", fin)?.id, "finance.expsettle");
  assert.equal(findArticleForLocation("/finance", "?tab=vat", staff), null);
  assert.equal(findArticleForLocation("/approval/semantic-concepts", "", ["approval.manage@all"])?.id, "approval-ops.concepts");
});

test("검색 — 낱말·초성", () => {
  const perms = ["approval.view", "work_plan.view"];
  assert.equal(searchManual("결재선", perms)[0]?.article.id, "approval.draft");
  assert.ok(searchManual("연차", perms).some((h) => h.article.id === "hr.my"));
  assert.ok(searchManual("ㅂㅁㅂㅎ", perms).some((h) => h.article.id === "start.login"), "초성 ㅂㅁㅂㅎ → 비밀번호");
  assert.deepEqual(searchManual("파일 저장 정책", perms).map((h) => h.article.id).includes("files.library"), false);
});

test("커버리지 — 매뉴얼이 없는 메뉴·화면", () => {
  const missingMenus: string[] = [];
  for (const m of MENU_ITEMS)
    for (const entry of [m, ...(m.submenu ?? [])]) {
      const [path, query = ""] = entry.href.split("?");
      if (!findArticleForLocation(path, query ? `?${query}` : "", ALL_PERMS)) missingMenus.push(`${m.title} › ${entry.title} (${entry.href})`);
    }
  const missingPages: string[] = [];
  for (const file of walk(join(ROOT, "app", "(app)"), ["page.tsx"])) {
    const route =
      "/" +
      relative(join(ROOT, "app", "(app)"), file)
        .split(sep)
        .slice(0, -1)
        .map((seg) => (seg.startsWith("[") ? "x-param" : seg))
        .join("/");
    if (Object.keys(MANUAL_EXCLUDED_ROUTES).some((p) => route === p || route.startsWith(`${p}/`))) continue;
    if (!findArticleForLocation(route, "", ALL_PERMS)) missingPages.push(route);
  }
  const report = [`매뉴얼 없는 메뉴 ${missingMenus.length}개`, ...missingMenus.map((x) => `  - ${x}`), `매뉴얼 없는 화면 ${missingPages.length}개`, ...[...new Set(missingPages)].map((x) => `  - ${x}`)].join("\n");
  if (STRICT) assert.equal(missingMenus.length + missingPages.length, 0, report);
  else console.log(`\n[manual coverage — 경고]\n${report}\n`);
});
