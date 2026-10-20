/**
 * 사용 매뉴얼 레지스트리 — 기사·도움말·변경 기록의 단일 원천(docs/manual-help-blueprint.md).
 * 화면 코드는 문장을 갖지 않고 <CdHelp topic="..."/> 키만 갖는다. 문장 수정은 이 폴더에서만 한다.
 */
import type { ManualArticle, HelpTopic } from "./types";
import { START_ARTICLES } from "./articles/start";
import { HOME_ARTICLES } from "./articles/home";
import { MAIL_ARTICLES } from "./articles/mail";
import { APPROVAL_ARTICLES } from "./articles/approval";
import { FILES_ARTICLES } from "./articles/files";
import { CALENDAR_ARTICLES } from "./articles/calendar";
import { TODO_ARTICLES } from "./articles/todo";
import { WORK_PLAN_ARTICLES } from "./articles/work-plan";
import { PAYROLL_ARTICLES } from "./articles/payroll";
import { HR_ARTICLES } from "./articles/hr";
import { SCENARIO_ARTICLES } from "./articles/scenarios";
import { HELP_TOPIC_LIST } from "./help-topics/core";
import { COLLAB_MORE_ARTICLES } from "./articles/collab-more";
import { WORK_MGMT_ARTICLES } from "./articles/work-mgmt";
import { HR_PAYROLL_ADMIN_ARTICLES } from "./articles/hr-payroll-admin";
import { FACILITIES_CONTRACTS_ARTICLES } from "./articles/facilities-contracts";
import { SALES_ARTICLES } from "./articles/sales";
import { ADMIN_ARTICLES } from "./articles/admin";
import { FINANCE_ARTICLES } from "./articles/finance";
import { APPROVAL_OPS_ARTICLES } from "./articles/approval-ops";
import { COLLAB_MORE_HELP } from "./help-topics/collab-more";
import { WORK_MGMT_HELP } from "./help-topics/work-mgmt";
import { HR_PAYROLL_ADMIN_HELP } from "./help-topics/hr-payroll-admin";
import { FACILITIES_CONTRACTS_HELP } from "./help-topics/facilities-contracts";
import { SALES_HELP } from "./help-topics/sales";
import { ADMIN_HELP } from "./help-topics/admin";
import { FINANCE_HELP } from "./help-topics/finance";
import { APPROVAL_OPS_HELP } from "./help-topics/approval-ops";

export { MANUAL_CHAPTERS, MANUAL_GROUP_LABEL } from "./chapters";
export { MANUAL_CHANGELOG } from "./changelog";
export type * from "./types";

export const MANUAL_ARTICLES: ManualArticle[] = [
  ...START_ARTICLES,
  ...HOME_ARTICLES,
  ...MAIL_ARTICLES,
  ...APPROVAL_ARTICLES,
  ...FILES_ARTICLES,
  ...CALENDAR_ARTICLES,
  ...TODO_ARTICLES,
  ...WORK_PLAN_ARTICLES,
  ...PAYROLL_ARTICLES,
  ...HR_ARTICLES,
  ...COLLAB_MORE_ARTICLES,
  ...WORK_MGMT_ARTICLES,
  ...HR_PAYROLL_ADMIN_ARTICLES,
  ...FACILITIES_CONTRACTS_ARTICLES,
  ...SALES_ARTICLES,
  ...FINANCE_ARTICLES,
  ...ADMIN_ARTICLES,
  ...APPROVAL_OPS_ARTICLES,
  ...SCENARIO_ARTICLES,
];

export const HELP_TOPICS: Readonly<Record<string, HelpTopic>> = Object.fromEntries(
  [
    ...HELP_TOPIC_LIST,
    ...COLLAB_MORE_HELP, ...WORK_MGMT_HELP, ...HR_PAYROLL_ADMIN_HELP, ...FACILITIES_CONTRACTS_HELP, ...SALES_HELP, ...ADMIN_HELP,
    ...FINANCE_HELP, ...APPROVAL_OPS_HELP,
  ].map((t) => [t.id, t])
);

/**
 * 매뉴얼 기사를 두지 않는 화면 — test:manual 의 화면 커버리지 검사에서 제외한다. 사유를 반드시 적는다.
 */
export const MANUAL_EXCLUDED_ROUTES: Readonly<Record<string, string>> = {
  "/forbidden": "권한 없음 안내 화면",
  "/work-plan/merge": "부서장 감독으로 리다이렉트만 함",
  "/approval/my-leave": "내 휴가·근태로 리다이렉트만 함",
  "/approval/my-attendance": "내 휴가·근태로 리다이렉트만 함",
};
