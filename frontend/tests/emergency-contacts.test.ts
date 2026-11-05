import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  buildEmergencyRows,
  emergencyHeadcount,
  groupEmergencyRows,
  moveEmergencyGroup,
  moveEmergencyRow,
  type EmergencyEmployeeFact,
  type EmergencyEntryFact,
} from "../lib/emergency-contacts-rules";
import { createEmergencyContactsWorkbook, emergencyContactsAsOf } from "../lib/emergency-contacts-export";

// 비상 연락망(340) — 행 구성·정렬·소속 묶음.

const emp = (employeeId: string, over: Partial<EmergencyEmployeeFact> = {}): EmergencyEmployeeFact => ({
  employeeId,
  name: employeeId,
  deptName: "개발팀",
  deptOrder: 20,
  positionName: "사원",
  rankOrder: 30,
  mobilePhone: null,
  companyPhone: null,
  email: null,
  companyEmail: null,
  postTitle: null,
  postKind: null,
  ...over,
});
const entry = (entryId: string, over: Partial<EmergencyEntryFact> = {}): EmergencyEntryFact => ({
  entryId,
  employeeId: null,
  sameAsEmployeeId: null,
  groupLabel: null,
  title: null,
  displayOrder: null,
  hidden: false,
  name: null,
  positionName: null,
  mobilePhone: null,
  directPhone: null,
  email: null,
  ...over,
});
const names = (rows: { name: string }[]) => rows.map((r) => r.name);

test("기본 순서는 대표이사 → 부서 순서 → 직급 서열", () => {
  const rows = buildEmergencyRows(
    [
      emp("사원A", { deptName: "1본부", deptOrder: 30 }),
      emp("부장B", { deptName: "1본부", deptOrder: 30, positionName: "부장", rankOrder: 70, postKind: "head", postTitle: "본부장" }),
      emp("총괄C", { deptName: "총괄", deptOrder: 10, positionName: "이사", rankOrder: 80 }),
      emp("대표D", { deptName: "총괄", deptOrder: 10, positionName: "대표이사", rankOrder: 100 }),
    ],
    []
  );
  assert.deepEqual(names(rows), ["대표D", "총괄C", "부장B", "사원A"]);
  assert.equal(rows[0].groupLabel, "대표이사");
  assert.equal(rows[0].title, "대표이사");
  assert.equal(rows[1].title, "이사");
  assert.equal(rows[2].title, "본부장");
  assert.equal(rows[3].title, "팀원");
});

test("이메일은 인사카드 값 우선, 없으면 회사 메일", () => {
  const rows = buildEmergencyRows(
    [emp("A", { email: "a@personal.example", companyEmail: "a@company.example" }), emp("B", { companyEmail: "b@company.example" })],
    []
  );
  assert.equal(rows.find((r) => r.name === "A")?.email, "a@personal.example");
  assert.equal(rows.find((r) => r.name === "B")?.email, "b@company.example");
});

test("표시 설정은 기본값을 덮고, 지우면 기본값으로 돌아간다", () => {
  const facts = [emp("A", { deptName: "총괄" })];
  const set = buildEmergencyRows(facts, [entry("e1", { employeeId: "A", groupLabel: "고문", title: "고문", hidden: true })]);
  assert.equal(set[0].groupLabel, "고문");
  assert.equal(set[0].defaultGroupLabel, "총괄");
  assert.equal(set[0].title, "고문");
  assert.equal(set[0].hidden, true);
  const cleared = buildEmergencyRows(facts, [entry("e1", { employeeId: "A" })]);
  assert.equal(cleared[0].groupLabel, "총괄");
  assert.equal(cleared[0].title, "팀원");
  assert.equal(cleared[0].hidden, false);
});

test("직접 입력 행은 소속이 같으면 그 소속 끝에, 없으면 표 끝에 붙는다", () => {
  const rows = buildEmergencyRows(
    [emp("A"), emp("B", { deptName: "2본부", deptOrder: 40 })],
    [entry("x", { name: "외부", groupLabel: "개발팀" }), entry("y", { name: "고문", groupLabel: "고문" })]
  );
  assert.deepEqual(names(rows), ["A", "외부", "B", "고문"]);
  // 순서를 저장한 뒤에 들어온 사람(순서 없음)은 같은 소속 끝으로 들어간다.
  const ordered = buildEmergencyRows(
    [emp("A"), emp("새입사", { deptName: "개발팀" }), emp("B", { deptName: "2본부", deptOrder: 40 })],
    [
      entry("ea", { employeeId: "A", displayOrder: 10 }),
      entry("eb", { employeeId: "B", displayOrder: 20 }),
    ]
  );
  assert.deepEqual(names(ordered), ["A", "새입사", "B"]);
});

test("겸직 줄은 인사카드 번호를 따르고 총 인원에는 1명으로 센다", () => {
  const facts = [emp("A", { mobilePhone: "010-1", companyPhone: "070-1", email: "a@example.com", postTitle: "본부장" }), emp("B")];
  const line = entry("x", { sameAsEmployeeId: "A", groupLabel: "2본부" });
  const rows = buildEmergencyRows(facts, [line]);
  const second = rows.find((r) => r.key === "entry:x");
  assert.equal(second?.name, "A");
  assert.equal(second?.groupLabel, "2본부");
  assert.equal(second?.title, "본부장");
  assert.equal(second?.mobilePhone, "010-1");
  assert.equal(second?.directPhone, "070-1");
  assert.equal(second?.email, "a@example.com");
  assert.equal(rows.length, 3);
  assert.equal(emergencyHeadcount(rows), 2);
  // 퇴사(재직 목록에서 빠짐)하면 겸직 줄도 함께 빠진다.
  assert.deepEqual(names(buildEmergencyRows([emp("B")], [line])), ["B"]);
});

test("출력일자는 내려받은 날의 한국 시간", () => {
  assert.equal(emergencyContactsAsOf(new Date("2026-11-05T14:59:00Z")), "2026.11.05. 현재");
  assert.equal(emergencyContactsAsOf(new Date("2026-11-05T15:00:00Z")), "2026.11.06. 현재");
});

test("엑셀 출력본은 제목·출력일자 아래에 표를 둔다", async () => {
  const rows = buildEmergencyRows([emp("A"), emp("B"), emp("C", { deptName: "2본부", deptOrder: 40 })], []);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await createEmergencyContactsWorkbook(rows, new Date("2026-11-05T01:00:00Z"))) as never);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell("A1").value, "㈜한국환경안전연구원 비상연락망");
  assert.equal(ws.getCell("A2").value, "2026.11.05. 현재");
  assert.equal(ws.getCell("A2").alignment?.horizontal, "right");
  assert.equal(ws.getCell("A3").value, "소속");
  assert.equal(ws.getCell("A4").value, "개발팀");
  assert.equal(ws.getCell("A7").value, "총 인원");
  assert.equal(ws.getCell("B7").value, "3명");
  assert.equal(ws.pageSetup.printArea, "A1:G7");
});

test("소속 묶음은 이어진 행끼리 만든다", () => {
  const rows = buildEmergencyRows([emp("A"), emp("B"), emp("C", { deptName: "2본부", deptOrder: 40 })], []);
  assert.deepEqual(groupEmergencyRows(rows).map((g) => [g.label, g.rows.length]), [["개발팀", 2], ["2본부", 1]]);
});

test("행 이동은 소속 안에서만, 소속 이동은 묶음째로", () => {
  const rows = buildEmergencyRows([emp("A"), emp("B"), emp("C", { deptName: "2본부", deptOrder: 40 })], []);
  assert.deepEqual(names(moveEmergencyRow(rows, "emp:B", -1) ?? []), ["B", "A", "C"]);
  assert.equal(moveEmergencyRow(rows, "emp:A", -1), null);
  assert.equal(moveEmergencyRow(rows, "emp:B", 1), null);
  assert.deepEqual(names(moveEmergencyGroup(rows, 1, -1) ?? []), ["C", "A", "B"]);
  assert.equal(moveEmergencyGroup(rows, 0, -1), null);
});
