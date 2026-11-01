import assert from "node:assert/strict";
import { test } from "node:test";
import { selectBriefingEvidence } from "../lib/intel/briefing-runner";
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
