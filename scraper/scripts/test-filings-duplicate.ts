/**
 * 신고 보조 중복 판정 회귀 시험 — `npx tsx scripts/test-filings-duplicate.ts`
 * (IEPS 접속 없이 판정 함수만 본다. 2026-10-12 중복 신고 차단 보강)
 */
import assert from "node:assert/strict";
import { IepsAgencyReportRow, isSameReport, reportState } from "../lib/filings/assist";

const row = (over: Partial<IepsAgencyReportRow>): IepsAgencyReportRow => ({
  REQST_SN: 515,
  BPLC_CD: null,
  BPLC_NM: "국도화학(주) 부산사업소",
  REPORT_FOM_CD_NM: "체결",
  STTUS_CD_NM: "제출",
  CONTRACT_DE: "2026-08-20",
  CONTRACT_AMT: 12,
  AGENCY_START_DE: "2026-08-20",
  AGENCY_END_DE: "2027-08-19",
  PRESENTN_DE: "2026-09-10",
  ...over,
});
const want = { name: "국도화학㈜ 부산사업소", contractDate: "2026-08-20", amount: "12", agencyStart: "2026-08-20", kindName: "체결" };

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n += 1;
  console.log(`ok ${n} - ${name}`);
};

t("같은 사업장·계약일·형식 = 중복", () => assert.equal(isSameReport(row({}), want), true));
t("보고 형식이 다르면 아님(변경 보고)", () => assert.equal(isSameReport(row({ REPORT_FOM_CD_NM: "변경" }), want), false));
t("회사명이 다르면 아님", () => assert.equal(isSameReport(row({ BPLC_NM: "다른화학 부산사업소" }), want), false));
t("계약일 같고 사업장명은 달라도 금액이 같으면 중복", () =>
  assert.equal(isSameReport(row({ BPLC_NM: "국도화학 부산공장" }), want), true));
t("계약일 오기여도 사업장명·금액·대행 시작일이 같으면 중복", () =>
  assert.equal(isSameReport(row({ CONTRACT_DE: "2026-08-02" }), want), true));
t("계약일 오기 + 금액 다르면 아님", () => assert.equal(isSameReport(row({ CONTRACT_DE: "2026-08-02", CONTRACT_AMT: 30 }), want), false));
t("계약일 다르고 대행 시작일도 다르면 아님(같은 사업장의 다른 계약)", () =>
  assert.equal(isSameReport(row({ CONTRACT_DE: "2025-03-01", AGENCY_START_DE: "2025-03-01" }), want), false));
t("금액 표기 차이(12 vs 12.0)도 같은 금액", () => assert.equal(isSameReport(row({ CONTRACT_DE: "2026-08-02" }), { ...want, amount: "12.0" }), true));
t("MCM 금액이 비어 있으면 계약일 오기 건은 판정하지 않음", () =>
  assert.equal(isSameReport(row({ CONTRACT_DE: "2026-08-02" }), { ...want, amount: "" }), false));

t("제출·접수·승인 = 제출된 보고", () => {
  for (const s of ["제출", "접수", "승인", "검토중", null]) assert.equal(reportState(s), "filed", String(s));
});
t("임시저장·작성중 = 작성 중(막지 않음)", () => {
  for (const s of ["임시저장", "작성중", "작성 중", "저장"]) assert.equal(reportState(s), "draft", s);
});
t("반려·취소·삭제 = 무효(다시 신고)", () => {
  for (const s of ["반려", "제출취소", "삭제", "보완요청"]) assert.equal(reportState(s), "void", s);
});

console.log(`# ${n} passed`);
