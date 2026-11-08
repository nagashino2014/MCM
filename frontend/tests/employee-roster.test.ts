import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  ageOn,
  careerMonths,
  finalEducation,
  formatMonths,
  orderCertificationNames,
  parseDay,
  rosterMissing,
} from "../lib/admin/employee-roster-rules";
import { createRosterWorkbook, rosterFileName } from "../lib/admin/employee-roster-export";
import type { EmployeeRoster, EmployeeRosterRow } from "../lib/admin/employee-roster";

// 직원 일람표(2026-11-08) — 만 나이·경력 개월·최종학력·자격증 열 순서·미등록·엑셀 머리글.

test("만 나이는 생일이 지나야 한 살 늘어난다", () => {
  assert.equal(ageOn("1954-09-17", "2026-11-08"), 72);
  assert.equal(ageOn("1961-11-08", "2026-11-08"), 65);
  assert.equal(ageOn("1961-11-09", "2026-11-08"), 64);
  assert.equal(ageOn(null, "2026-11-08"), null);
  assert.equal(ageOn("1999", "2026-11-08"), null);
});

test("날짜 읽기 — 달만 있으면 시작은 1일·끝은 말일, 점 구분도 받는다", () => {
  assert.equal(parseDay("2024-02", "end"), Date.UTC(2024, 1, 29));
  assert.equal(parseDay("2024-02", "start"), Date.UTC(2024, 1, 1));
  assert.equal(parseDay("2013.11.15"), Date.UTC(2013, 10, 15));
  assert.equal(parseDay("미상"), null);
});

test("이전 경력 — 엑셀 DATEDIF 개월과 같고, 겹침은 한 번만, 입사일 이후는 자른다", () => {
  // 원본 엑셀: 2021-03-01~2023-03-15 = 24개월, 2016-08-03~2018-02-21 = 18개월, 2016-05-16~2017-03-18 = 10개월
  const m = (from: string, to: string) => careerMonths({ hiredAt: "2030-01-01", endAt: "2030-01-01", careers: [{ workedFrom: from, workedTo: to }] }).prior;
  assert.equal(m("2021-03-01", "2023-03-15"), 24);
  assert.equal(m("2016-08-03", "2018-02-21"), 18);
  assert.equal(m("2016-05-16", "2017-03-18"), 10);

  const overlapped = careerMonths({
    hiredAt: "2020-01-01",
    endAt: "2020-12-31",
    careers: [
      { workedFrom: "2015-01", workedTo: "2016-12" }, // 24개월
      { workedFrom: "2016-01", workedTo: "2017-12" }, // 2016 은 겹침 → +12개월
      { workedFrom: "2019-07", workedTo: null }, // 끝 없음 → 입사 전날까지 6개월
      { workedFrom: "2020-03", workedTo: "2020-06" }, // 재직 중 겸직 → 제외
    ],
  });
  assert.equal(overlapped.prior, 42);
  assert.equal(overlapped.company, 12);
  assert.equal(overlapped.total, 54);

  const noHire = careerMonths({ hiredAt: null, endAt: "2026-11-08", careers: [] });
  assert.deepEqual(noHire, { company: null, prior: 0, total: null });
});

test("개월 표기", () => {
  assert.equal(formatMonths(0), "-");
  assert.equal(formatMonths(7), "7개월");
  assert.equal(formatMonths(24), "2년");
  assert.equal(formatMonths(95), "7년 11개월");
  assert.equal(formatMonths(null), "");
});

test("최종학력 — 학위가 높은 행, 같으면 늦게 졸업한 행", () => {
  const edu = finalEducation([
    { degreeLevel: "bachelor", schoolName: "A대", major: null, graduationDate: "2009-08-24" },
    { degreeLevel: "master", schoolName: "B대", major: "대기공학", graduationDate: "2014-08-22" },
    { degreeLevel: "master", schoolName: "C대", major: null, graduationDate: "2011-02-01" },
  ]);
  assert.equal(edu?.schoolName, "B대");
  assert.equal(finalEducation([]), null);
});

test("자격증 열 — 등록 선택지 순서, 없는 이름은 뒤에 가나다순", () => {
  assert.deepEqual(
    orderCertificationNames(["화공기사", "하수도기사", "대기관리기술사", "가스기사", "화공기사"], ["대기관리기술사", "대기환경기사", "화공기사"]),
    ["대기관리기술사", "화공기사", "가스기사", "하수도기사"]
  );
});

test("미등록 — 연봉은 급여 열람 권한이 있을 때만 따진다", () => {
  const base = { birthDate: null, hiredAt: "2020-01-01", education: null, annualSalary: null };
  assert.deepEqual(rosterMissing({ ...base, salaryVisible: true }), ["생년월일", "학력", "연봉"]);
  assert.deepEqual(rosterMissing({ ...base, salaryVisible: false }), ["생년월일", "학력"]);
});

const row = (over: Partial<EmployeeRosterRow> = {}): EmployeeRosterRow => ({
  employeeId: "e1",
  name: "홍길동",
  status: "active",
  deptName: "통합환경1본부",
  positionName: "과장",
  birthDate: "1993-02-27",
  age: 33,
  hiredAt: "2018-12-03",
  resignedAt: null,
  education: { degree: "학사", schoolName: "광운대학교", major: "환경공학과", graduationYear: "2017" },
  careerCompanyMonths: 95,
  careerPriorMonths: 0,
  careerTotalMonths: 95,
  certifications: { 대기환경기사: "2016-08-19", 수질환경기사: "" },
  engGrade: "중급",
  envGrade: "고급인력(대기)",
  annualSalary: 44110000,
  salaryFrom: "2026-01-01",
  missing: [],
  ...over,
});

test("엑셀 — 2단 머리글(경력·보유 자격증 묶음), 연봉 숫자 서식, 퇴사자 있으면 구분 칸", async () => {
  const roster: EmployeeRoster = {
    asOf: "2026-11-08",
    salaryVisible: true,
    certificationNames: ["대기환경기사", "수질환경기사"],
    rows: [row(), row({ employeeId: "e2", name: "김퇴사", status: "inactive", resignedAt: "2025-06-30", certifications: {} })],
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await createRosterWorkbook(roster)) as never);
  const ws = wb.worksheets[0];
  const header3 = (c: number) => String(ws.getCell(3, c).value ?? "");
  const header4 = (c: number) => String(ws.getCell(4, c).value ?? "");
  assert.equal(header3(2), "성명");
  assert.equal(header3(10), "경력");
  assert.deepEqual([header4(10), header4(11), header4(12)], ["당사", "이전", "합계"]);
  assert.equal(header3(15), "보유 자격증");
  assert.deepEqual([header4(15), header4(16)], ["대기환경기사", "수질환경기사"]);
  assert.equal(header4(17), "연봉");
  assert.equal(header4(18), "구분");
  assert.equal(ws.getCell(5, 2).value, "홍길동");
  assert.equal(ws.getCell(5, 10).value, "7년 11개월");
  assert.equal(ws.getCell(5, 11).value, "-");
  assert.equal(ws.getCell(5, 15).value, "2016-08-19");
  assert.equal(ws.getCell(5, 16).value, "보유");
  assert.equal(ws.getCell(5, 17).value, 44110000);
  assert.equal(ws.getCell(5, 17).numFmt, "#,##0");
  assert.equal(ws.getCell(6, 18).value, "퇴사");
  assert.equal(ws.getCell(6, 19).value, "2025-06-30");
  assert.equal(rosterFileName("2026-11-08"), "직원 일람표(26.11.08).xlsx");
});

test("엑셀 — 급여 권한이 없으면 연봉 칸이 없다", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await createRosterWorkbook({ asOf: "2026-11-08", salaryVisible: false, certificationNames: [], rows: [row({ annualSalary: null })] })) as never
  );
  const ws = wb.worksheets[0];
  const labels = Array.from({ length: ws.columnCount }, (_, i) => String(ws.getCell(4, i + 1).value ?? ""));
  assert.ok(!labels.includes("연봉"));
});
