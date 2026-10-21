import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalFieldDef } from "../lib/approval/fields";
import { judgeRefValue, linkSlotsOf, linkageWarningsOf, tallySlot } from "../lib/approval/linkage";
import { axisOf, validateDefinition } from "../lib/analytics/metric-types";
import { compositeMismatch } from "../lib/analytics/metric-engine";

// 결재 양식↔마스터 연결 판정 — docs/approval-master-linkage-audit-2026-10-21.md §4 L0·L3·L4.

const f = (p: Partial<ApprovalFieldDef> & Pick<ApprovalFieldDef, "key" | "type">): ApprovalFieldDef => ({ label: p.key, row: 1, ...p });

test("문서 단위 참조 — 계약·업체·직원·자산·담당자·휴가 종류를 슬롯으로 본다", () => {
  const slots = linkSlotsOf("frm-x", [
    f({ key: "c", type: "contract_select" }),
    f({ key: "co", type: "company_select" }),
    f({ key: "u", type: "user_select" }),
    f({ key: "a", type: "asset_select" }),
    f({ key: "r", type: "contact_select" }),
    f({ key: "lt", type: "leave_type" }),
    f({ key: "t", type: "text" }),
  ]);
  assert.deepEqual(
    slots.map((s) => `${s.level}:${s.entity}:${s.fieldKey}`),
    ["doc:contract:c", "doc:company:co", "doc:employee:u", "doc:asset:a", "doc:contact:r", "doc:leave_type:lt"]
  );
});

test("표 열 — related 는 계약·업체 두 슬롯, people·dept·position·행 직원(rowRef)은 행 슬롯", () => {
  const slots = linkSlotsOf("frm-x", [
    f({
      key: "rows",
      type: "table",
      rowRef: "employee",
      tableColumns: [
        { key: "amount", label: "금액", type: "currency" },
        { key: "related", label: "연관", type: "related" },
        { key: "who", label: "동행", type: "people" },
        { key: "dept", label: "부서", type: "dept" },
        { key: "pos", label: "직급", type: "position" },
      ],
    }),
  ]);
  assert.deepEqual(
    slots.map((s) => `${s.entity}:${s.columnKey}`),
    ["employee:_employeeId", "contract:related", "company:related", "employee:who", "dept:dept", "position:pos"]
  );
});

test("전용 화면 양식 — 견적·공문·계약서는 값 안의 경로로 연결을 판정한다", () => {
  const slots = linkSlotsOf("frm-agreement", [f({ key: "orderer_display", type: "text" })]);
  assert.deepEqual(slots.map((s) => `${s.level}:${s.entity}`), ["value:company", "value:contract"]);
  const t = tallySlot(slots[0], { orderer: { facilityId: "23868-01", name: "엘에스엠앤엠" } });
  assert.equal(t.linked, 1);
  const t2 = tallySlot(slots[1], { contractId: null });
  assert.equal(t2.missing, 1);
});

test("값 판정 — ID 가 있으면 연결, 이름만 있으면 직접 입력, 비면 미입력", () => {
  assert.equal(judgeRefValue("contract", { title: "삼성전기 통합환경허가", manual: true }), "manual");
  assert.equal(judgeRefValue("contract", { title: "A", contractId: "c1" }), "linked");
  assert.equal(judgeRefValue("company", { name: "", manual: false }), "missing");
  assert.equal(judgeRefValue("employee", [{ employeeId: "e1", name: "김" }]), "linked");
  assert.equal(judgeRefValue("employee", []), "missing");
  assert.equal(judgeRefValue("dept", "영업관리본부"), "manual"); // 구버전 자유 텍스트 부서
  assert.equal(judgeRefValue("dept", { deptId: "d1", name: "기술본부" }), "linked");
  assert.equal(judgeRefValue("asset", { assetId: "asset-niro", name: "니로" }), "linked");
  assert.equal(judgeRefValue("contact", [{ id: "41", name: "이재연" }]), "linked");
  assert.equal(judgeRefValue("leave_type", "half_am"), "linked");
});

test("표 행 집계 — 빈 행은 세지 않고, 다른 쪽 ID 만 있는 행은 미해당", () => {
  const slots = linkSlotsOf("frm-x", [
    f({ key: "rows", type: "table", tableColumns: [{ key: "amount", label: "금액", type: "currency" }, { key: "related", label: "연관", type: "related" }] }),
  ]);
  const contract = slots.find((s) => s.entity === "contract")!;
  const company = slots.find((s) => s.entity === "company")!;
  const fv = {
    rows: [
      { amount: "1000", related: "용역A", _relatedContractId: "c1", _relatedFacilityId: "f1" },
      { amount: "2000", related: "사업장B", _relatedFacilityId: "f2" }, // 계약 전 영업 — 사업장만
      { amount: "3000", related: "손으로 쓴 값" },
      { amount: "4000" },
      { _cardTxnId: "x" }, // 메타만 있는 빈 행
      {},
    ],
  };
  assert.deepEqual(tallySlot(contract, fv), { total: 3, linked: 1, manual: 1, missing: 1 });
  assert.deepEqual(tallySlot(company, fv), { total: 4, linked: 2, manual: 1, missing: 1 });
});

test("행 직원 메타(rowRef) — _employeeId 가 없으면 직접 입력", () => {
  const slot = linkSlotsOf("frm-x", [f({ key: "rows", type: "table", rowRef: "employee", tableColumns: [{ key: "name", label: "성명", type: "text" }] })])[0];
  assert.deepEqual(tallySlot(slot, { rows: [{ name: "김", _employeeId: "e1" }, { name: "이" }] }), { total: 2, linked: 1, manual: 1, missing: 0 });
});

test("빌더 경고(L4) — 금액만 있고 귀속 참조가 없으면, 사람·부서를 자유 텍스트 열로 받으면 경고", () => {
  const w = linkageWarningsOf("frm-x", [
    f({ key: "budget", type: "currency" }),
    f({ key: "rows", type: "table", tableColumns: [{ key: "name", label: "성명", type: "text" }, { key: "dept", label: "부서", type: "text" }] }),
  ]);
  assert.equal(w.length, 2);
  assert.match(w[0], /관련 용역/);
  assert.match(w[1], /'성명', '부서'/);
  // 계약 검색이 있으면 첫 경고 없음, rowRef 표는 두 번째 경고 없음, 공지성 양식은 경고 없음
  assert.equal(linkageWarningsOf("frm-x", [f({ key: "budget", type: "currency" }), f({ key: "c", type: "contract_select" })]).length, 0);
  assert.equal(
    linkageWarningsOf("frm-x", [f({ key: "rows", type: "table", rowRef: "employee", tableColumns: [{ key: "name", label: "성명", type: "text" }, { key: "a", label: "금액", type: "currency" }] })]).length,
    0
  );
  assert.equal(linkageWarningsOf("frm-internal-notice", [f({ key: "x", type: "currency" })]).length, 0);
});

test("지표 — 기안자·기안 부서 차원은 직원·부서 축으로 정규화되고 참조 차원은 1개까지", () => {
  assert.equal(axisOf("doc.drafter"), "ref.employee");
  assert.equal(axisOf("doc.dept"), "ref.dept");
  assert.equal(axisOf("ref.contract"), "ref.contract");
  const base = { kind: "aggregate" as const, source: { type: "approval_docs", forms: "auto" as const }, measure: { agg: "sum" as const, concept: "quantity.hours" } };
  assert.equal(validateDefinition({ ...base, groupBy: ["doc.drafter", "dim.category"] }), null);
  assert.match(String(validateDefinition({ ...base, groupBy: ["doc.drafter", "ref.contract"] })), /1개까지/);
  assert.match(String(validateDefinition({ ...base, groupBy: ["dim.subcategory"] })), /만 가능/);
});

test("복합 지표 — 결합 축·시간축이 다르면 막는다", () => {
  assert.equal(compositeMismatch({ a: { axes: ["ref.contract"], hasTime: false }, b: { axes: ["ref.contract"], hasTime: false } }), null);
  assert.match(String(compositeMismatch({ a: { axes: ["ref.contract"], hasTime: false }, b: { axes: ["ref.employee"], hasTime: false } })), /결합 축/);
  assert.match(
    String(compositeMismatch({ a: { axes: ["ref.employee"], hasTime: true, timeBucket: "month" }, b: { axes: ["ref.employee"], hasTime: false } })),
    /시간축/
  );
  assert.equal(
    compositeMismatch({ a: { axes: ["ref.employee"], hasTime: true, timeBucket: "month" }, b: { axes: ["ref.employee"], hasTime: true, timeBucket: "month" } }),
    null
  );
});
