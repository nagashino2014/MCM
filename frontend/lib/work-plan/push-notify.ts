/**
 * 업무보고 앱 푸시(workReport 카테고리, 2026-08-20) — 제출·검토·지시·재보고 흐름을 관계자에게 알린다.
 * 이벤트 키는 단일 `work.report`(앱 알림 설정에서 한 토글로 켜고 끈다), 제목으로 종류를 구분한다.
 * 실패는 흐름을 막지 않는다 — 모든 함수가 throw 하지 않고 콘솔 경고만 남긴다.
 *
 * "부서장" 판정: departments 에 부서장 컬럼이 없어(012) **부서 소속 중 직급 rank_order 최상위 1인**
 * 으로 근사한다(주소록·검토 화면의 정렬 기준과 동일 축). 잘못 짚어도 같은 부서 최상급자다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";

/** 부서 최상위 직급자의 로그인 계정 — 없거나(미연결) 작성자 본인이면 빈 배열. */
async function deptHeadUserIds(deptId: string | null, excludeUserId?: string | null): Promise<string[]> {
  if (!deptId) return [];
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT e.user_id
           FROM employee_profiles e
           LEFT JOIN positions p ON p.position_id = e.position_id
          WHERE e.dept_id = $1 AND e.user_id IS NOT NULL
          ORDER BY COALESCE(p.rank_order, 0) DESC
          LIMIT 1`,
        [deptId]
      )
    );
    const id = rows[0]?.user_id ? String(rows[0].user_id) : null;
    return id && id !== excludeUserId ? [id] : [];
  } catch {
    return [];
  }
}

interface ReportBrief {
  deptId: string | null;
  authorUserId: string | null;
  subjectLabel: string;
}

async function loadReportBrief(reportId: string): Promise<ReportBrief | null> {
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT r.dept_id, r.author_user_id,
                COALESCE(c.contract_title, wt.task_name, r.title) AS subject_label
           FROM work_plan_reports r
           LEFT JOIN contracts c ON c.contract_id = r.contract_id
           LEFT JOIN work_tasks wt ON wt.task_id = r.task_id
          WHERE r.report_id = $1`,
        [reportId]
      )
    );
    if (!rows.length) return null;
    return {
      deptId: rows[0].dept_id != null ? String(rows[0].dept_id) : null,
      authorUserId: rows[0].author_user_id != null ? String(rows[0].author_user_id) : null,
      subjectLabel: String(rows[0].subject_label ?? "업무보고"),
    };
  } catch {
    return null;
  }
}

const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 보고 제출 → 부서장. */
export async function pushReportSubmitted(reportId: string, actorUserId: string): Promise<void> {
  try {
    const brief = await loadReportBrief(reportId);
    if (!brief) return;
    const targets = await deptHeadUserIds(brief.deptId, actorUserId);
    if (!targets.length) return;
    await sendPush(targets, {
      event: "work.report",
      title: "업무보고 제출",
      body: `${clip(brief.subjectLabel)} — 검토할 보고가 제출됐습니다.`,
      link: "/work-reports",
      targetRef: reportId,
      dedupKey: `work.report.submit:${reportId}:${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (err) {
    console.warn("[work-push] submit notify failed", err);
  }
}

/** 부서장 검토(반려/확인) → 작성자. */
export async function pushReportReviewed(reportId: string, action: "reject" | "confirm"): Promise<void> {
  try {
    const brief = await loadReportBrief(reportId);
    if (!brief?.authorUserId) return;
    await sendPush([brief.authorUserId], {
      event: "work.report",
      title: action === "reject" ? "업무보고 보완 요청" : "업무보고 확인 완료",
      body:
        action === "reject"
          ? `${clip(brief.subjectLabel)} — 부서장 의견을 확인하고 재제출해 주세요.`
          : `${clip(brief.subjectLabel)} — 부서장 확인이 완료됐습니다.`,
      link: "/work-reports",
      targetRef: reportId,
      dedupKey: `work.report.review:${reportId}:${action}:${new Date().toISOString()}`,
    });
  } catch (err) {
    console.warn("[work-push] review notify failed", err);
  }
}

/** 임원 지시 하달 → 부서장. */
export async function pushDirectiveIssued(reportId: string, actorUserId: string): Promise<void> {
  try {
    const brief = await loadReportBrief(reportId);
    if (!brief) return;
    const targets = await deptHeadUserIds(brief.deptId, actorUserId);
    if (!targets.length) return;
    await sendPush(targets, {
      event: "work.report",
      title: "임원 지시 도착",
      body: `${clip(brief.subjectLabel)} — 임원 지시가 하달됐습니다. 답변(재보고)이 필요합니다.`,
      link: "/work-reports",
      targetRef: reportId,
      dedupKey: `work.report.directive:${reportId}:${new Date().toISOString()}`,
    });
  } catch (err) {
    console.warn("[work-push] directive notify failed", err);
  }
}

/** 부서장 재보고 → 지시를 낸 임원. */
export async function pushReReported(reportId: string): Promise<void> {
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT issued_by FROM work_plan_directives
          WHERE report_id = $1 AND level = 'exec'
          ORDER BY created_at DESC LIMIT 1`,
        [reportId]
      )
    );
    const issuer = rows[0]?.issued_by ? String(rows[0].issued_by) : null;
    if (!issuer) return;
    const brief = await loadReportBrief(reportId);
    await sendPush([issuer], {
      event: "work.report",
      title: "재보고 도착",
      body: `${clip(brief?.subjectLabel ?? "업무보고")} — 지시에 대한 부서장 답변이 제출됐습니다.`,
      link: "/work-reports",
      targetRef: reportId,
      dedupKey: `work.report.rereport:${reportId}:${new Date().toISOString()}`,
    });
  } catch (err) {
    console.warn("[work-push] re-report notify failed", err);
  }
}
