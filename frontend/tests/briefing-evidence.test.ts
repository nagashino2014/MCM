import assert from "node:assert/strict";
import { test } from "node:test";
import { INITIAL_BASELINE_EVIDENCE_LIMIT, isBudgetBlockedError, selectBriefingEvidence, selectBriefingEvidenceWithin } from "../lib/intel/briefing-runner";
import type { BriefingEvidence, BriefingPreview } from "../lib/intel/briefing-types";

const item = (id: string, kind: BriefingEvidence["kind"], extra: Partial<BriefingEvidence> = {}): BriefingEvidence => ({ id, kind, revision: "r1", title: id, text: "검증 근거", companyName: "검증 회사", region: null, source: kind === "signal" ? "news" : kind, url: null, publishedAt: "2026-10-01T00:00:00Z", discoveredAt: "2026-10-02T00:00:00Z", changed: false, amount: null, temporalClass: "background", ...extra });
const preview = (items: BriefingEvidence[]): BriefingPreview => ({ items, totalProjects: items.filter(e => e.kind === "project").length, totalSignals: items.filter(e => e.kind === "signal").length, changedCount: items.filter(e => e.changed).length, sourceHealth: [], asOf: "2026-10-31T00:00:00Z", capturedAt: "2026-10-31T00:00:00Z", periodStart: "2026-10-30T00:00:00Z", periodEnd: "2026-10-31T00:00:00Z", initialBaseline: false, coverageNote: null });

test("반복 브리핑도 선택 프로젝트의 기존 원근거를 보존하고 무관한 과거 신호는 제외한다", () => {
  const items = [
    item("project:p1", "project", { relatedEvidenceIds: ["signal:old", "signal:missing"] }),
    item("project:p2", "project", { relatedEvidenceIds: ["signal:old"] }),
    item("signal:old", "signal", { relatedEvidenceIds: ["project:p1", "project:p2"] }),
    item("signal:unrelated", "signal"),
    item("signal:new", "signal", { changed: true, temporalClass: "current_period" }),
    item("official:background", "official"),
  ];
  const before = JSON.stringify(items);
  const selected = selectBriefingEvidence(preview(items));
  assert.deepEqual(selected.map(e => e.id), ["project:p1", "project:p2", "signal:old", "signal:new", "official:background"]);
  assert.equal(selected.find(e => e.id === "signal:old")?.changed, false);
  assert.equal(selected.find(e => e.id === "signal:old")?.temporalClass, "background");
  assert.equal(JSON.stringify(items), before, "변동 원장과 시점 분류를 선택 과정에서 바꾸지 않는다");
});

test("보강한 원근거도 분석 상한에 포함하여 조용한 누락 없이 거부한다", () => {
  const projects = Array.from({ length: 1200 }, (_, i) => item(`project:p${i}`, "project", { relatedEvidenceIds: ["signal:old"] }));
  assert.throws(() => selectBriefingEvidence(preview([...projects, item("signal:old", "signal")])), /1,200/);
});

test("첫 보고서는 상한을 넘으면 공식 동향과 최근 프로젝트를 원근거와 함께 채우고 생략 수를 돌려준다", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 7, 1) + n * 86400000).toISOString();
  const pairs = Array.from({ length: 900 }, (_, i) => [
    item(`project:p${i}`, "project", { changed: true, temporalClass: "initial_baseline", publishedAt: day(i % 90), relatedEvidenceIds: [`signal:s${i}`] }),
    item(`signal:s${i}`, "signal", { changed: true, temporalClass: "initial_baseline", publishedAt: day(i % 90), relatedEvidenceIds: [`project:p${i}`] }),
  ]).flat();
  const official = item("official:trend", "official", { changed: true, publishedAt: day(0) });
  const result = selectBriefingEvidenceWithin({ ...preview([...pairs, official]), initialBaseline: true, periodStart: undefined });
  assert.ok(result.items.length <= INITIAL_BASELINE_EVIDENCE_LIMIT);
  assert.ok(result.items.some(e => e.id === "official:trend"), "공식 산업동향은 먼저 담는다");
  const kept = new Set(result.items.map(e => e.id));
  for (const e of result.items.filter(e => e.kind === "project")) assert.ok(kept.has(e.relatedEvidenceIds![0]), "프로젝트는 원근거와 함께 담는다");
  assert.equal(result.analyzedProjects + result.omittedProjects, 900);
  assert.equal(result.analyzedProjects, result.items.filter(e => e.kind === "project").length);
  const oldestKept = Math.min(...result.items.filter(e => e.kind === "project").map(e => Date.parse(e.publishedAt!)));
  const newestDropped = Math.max(...pairs.filter(e => e.kind === "project" && !kept.has(e.id)).map(e => Date.parse(e.publishedAt!)));
  assert.ok(oldestKept >= newestDropped, "최근 발표 프로젝트부터 담는다");
});

test("첫 보고서라도 상한 안이면 모두 분석하고 정기 보고서는 상한 초과를 계속 거부한다", () => {
  const small = [item("project:p1", "project", { changed: true }), item("signal:s1", "signal", { changed: true })];
  assert.deepEqual(selectBriefingEvidenceWithin({ ...preview(small), initialBaseline: true }), { items: small, analyzedProjects: 1, omittedProjects: 0 });
  const many = Array.from({ length: 1201 }, (_, i) => item(`project:p${i}`, "project", { changed: true }));
  assert.throws(() => selectBriefingEvidenceWithin(preview(many)), /1,200/);
});

test("검증 문구 속 '예산' 낱말은 AI 예산 차단으로 분류하지 않는다", () => {
  assert.equal(isBudgetBlockedError("llm_budget_exceeded: 월 한도 초과"), true);
  assert.equal(isBudgetBlockedError("투자계획의 유지·재확인을 뒷받침하는 직접 근거가 없습니다. (… 전사 예산·투자 규율의 유지는 …)"), false);
});
