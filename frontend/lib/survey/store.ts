/**
 * 설문 DB 액세스 계층 — surveys / survey_questions / survey_responses / survey_answers / survey_notices (마이그 246).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  normalizeAudience,
  normalizeConfig,
  normalizeNoticeFields,
  normalizeNoticeTheme,
  normalizeOptions,
  OTHER_VALUE,
} from "./defaults";
import type {
  AnswerMap,
  QuestionStat,
  QuestionType,
  SurveyDetail,
  SurveyKind,
  SurveyNoticeRow,
  SurveyQuestion,
  SurveyResults,
  SurveyRow,
  SurveyStatus,
} from "./types";

const nowIso = () => new Date().toISOString();

const err = (message: string, status: number) => Object.assign(new Error(message), { status });

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function toSurveyRow(r: Record<string, unknown>): SurveyRow {
  return {
    surveyId: String(r.survey_id),
    kind: r.kind === "external" ? "external" : "internal",
    title: String(r.title ?? ""),
    description: r.description != null ? String(r.description) : null,
    status: (["draft", "open", "closed"].includes(String(r.status)) ? String(r.status) : "draft") as SurveyStatus,
    isAnonymous: Number(r.is_anonymous ?? 0) === 1,
    periodStart: r.period_start != null ? String(r.period_start) : null,
    periodEnd: r.period_end != null ? String(r.period_end) : null,
    audience: normalizeAudience(parseJson(r.audience, { scope: "all" })),
    googleFormUrl: r.google_form_url != null ? String(r.google_form_url) : null,
    googleFormEditUrl: r.google_form_edit_url != null ? String(r.google_form_edit_url) : null,
    googleFormId: r.google_form_id != null ? String(r.google_form_id) : null,
    googleScriptId: r.google_script_id != null ? String(r.google_script_id) : null,
    googleSyncedAt: r.google_synced_at != null ? String(r.google_synced_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
    ...(r.question_count != null ? { questionCount: Number(r.question_count) } : {}),
    ...(r.response_count != null ? { responseCount: Number(r.response_count) } : {}),
    ...(r.responded_at !== undefined ? { respondedAt: r.responded_at != null ? String(r.responded_at) : null } : {}),
  };
}

function toQuestion(r: Record<string, unknown>): SurveyQuestion {
  return {
    questionId: String(r.question_id),
    surveyId: String(r.survey_id),
    seq: Number(r.seq ?? 0),
    qtype: String(r.qtype) as QuestionType,
    title: String(r.title ?? ""),
    helpText: r.help_text != null ? String(r.help_text) : null,
    isRequired: Number(r.is_required ?? 0) === 1,
    options: normalizeOptions(parseJson(r.options, [])),
    config: normalizeConfig(parseJson(r.config, {})),
  };
}

const SURVEY_COLS = `s.survey_id, s.kind, s.title, s.description, s.status, s.is_anonymous,
  s.period_start, s.period_end, s.audience, s.google_form_url, s.google_form_edit_url,
  s.google_form_id, s.google_script_id, s.google_synced_at, s.created_at, s.updated_at, s.updated_by`;

// ── 설문 ────────────────────────────────────────────

export interface SurveyFilter {
  kind: SurveyKind;
  status?: string | null;
  /** 제목 부분 일치(대소문자 무시). */
  q?: string | null;
  /** 채워 넣으면 해당 사용자의 응답 여부(responded_at)를 함께 조회한다. */
  viewerUserId?: string | null;
}

export async function listSurveys(filter: SurveyFilter): Promise<SurveyRow[]> {
  const db = await getDb();
  const params: unknown[] = [filter.kind];
  const where = ["s.deleted_at IS NULL", "s.kind = $1"];
  if (filter.status?.trim()) {
    params.push(filter.status.trim());
    where.push(`s.status = $${params.length}`);
  }
  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().toLowerCase()}%`);
    where.push(`LOWER(s.title) LIKE $${params.length}`);
  }
  let respondedSelect = "";
  if (filter.viewerUserId) {
    params.push(filter.viewerUserId);
    respondedSelect = `, (SELECT r.submitted_at FROM survey_responses r
                           WHERE r.survey_id = s.survey_id AND r.user_id = $${params.length}
                           LIMIT 1) AS responded_at`;
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${SURVEY_COLS},
              (SELECT COUNT(*) FROM survey_questions q WHERE q.survey_id = s.survey_id AND q.qtype <> 'section') AS question_count,
              (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.survey_id) AS response_count
              ${respondedSelect}
         FROM surveys s
        WHERE ${where.join(" AND ")}
        ORDER BY s.created_at DESC`,
      params
    )
  );
  return rows.map(toSurveyRow);
}

export async function getSurvey(surveyId: string): Promise<SurveyRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${SURVEY_COLS},
              (SELECT COUNT(*) FROM survey_responses r WHERE r.survey_id = s.survey_id) AS response_count
         FROM surveys s WHERE s.survey_id = $1 AND s.deleted_at IS NULL LIMIT 1`,
      [surveyId]
    )
  );
  return rows[0] ? toSurveyRow(rows[0]) : null;
}

export async function getSurveyDetail(surveyId: string): Promise<SurveyDetail | null> {
  const survey = await getSurvey(surveyId);
  if (!survey) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT question_id, survey_id, seq, qtype, title, help_text, is_required, options, config
         FROM survey_questions WHERE survey_id = $1 ORDER BY seq ASC`,
      [surveyId]
    )
  );
  return { ...survey, questions: rows.map(toQuestion) };
}

export interface SurveyInput {
  title?: string;
  description?: string | null;
  status?: SurveyStatus;
  isAnonymous?: boolean;
  periodStart?: string | null;
  periodEnd?: string | null;
  audience?: unknown;
  googleFormUrl?: string | null;
  googleFormEditUrl?: string | null;
  googleFormId?: string | null;
  googleScriptId?: string | null;
}

const cleanDate = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

const cleanUrl = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^https?:\/\//i.test(s) ? s.slice(0, 1000) : null;
};

export async function createSurvey(input: SurveyInput & { kind: SurveyKind; createdBy: string }): Promise<SurveyRow> {
  const title = (input.title ?? "").trim() || "제목 없는 설문";
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO surveys
       (survey_id, kind, title, description, status, is_anonymous, period_start, period_end, audience,
        created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8::jsonb, $9, $10, $9, $10)`,
    [
      id, input.kind, title, input.description?.trim() || null,
      input.isAnonymous ? 1 : 0,
      cleanDate(input.periodStart), cleanDate(input.periodEnd),
      JSON.stringify(normalizeAudience(input.audience)),
      now, input.createdBy,
    ]
  );
  return (await getSurvey(id))!;
}

export async function updateSurvey(surveyId: string, input: SurveyInput, userId: string): Promise<SurveyRow> {
  const existing = await getSurvey(surveyId);
  if (!existing) throw err("설문을 찾을 수 없습니다.", 404);

  const sets: string[] = [];
  const params: unknown[] = [surveyId];
  const put = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.title != null) {
    const t = input.title.trim();
    if (!t) throw err("설문 제목을 입력하세요.", 400);
    put("title", t);
  }
  if (input.description !== undefined) put("description", input.description?.trim() || null);
  if (input.status != null) {
    if (!["draft", "open", "closed"].includes(input.status)) throw err("알 수 없는 상태입니다.", 400);
    // 문항이 하나도 없는 설문은 접수를 시작할 수 없다(빈 설문 링크 배포 방지).
    if (input.status === "open" && existing.kind === "internal") {
      const detail = await getSurveyDetail(surveyId);
      const real = (detail?.questions ?? []).filter((q) => q.qtype !== "section");
      if (real.length === 0) throw err("문항을 1개 이상 추가해야 응답을 시작할 수 있습니다.", 400);
    }
    put("status", input.status);
  }
  if (input.isAnonymous !== undefined) put("is_anonymous", input.isAnonymous ? 1 : 0);
  if (input.periodStart !== undefined) put("period_start", cleanDate(input.periodStart));
  if (input.periodEnd !== undefined) put("period_end", cleanDate(input.periodEnd));
  if (input.audience !== undefined) put("audience", JSON.stringify(normalizeAudience(input.audience)), "::jsonb");
  if (input.googleFormUrl !== undefined) put("google_form_url", cleanUrl(input.googleFormUrl));
  if (input.googleFormEditUrl !== undefined) put("google_form_edit_url", cleanUrl(input.googleFormEditUrl));
  if (input.googleFormId !== undefined) put("google_form_id", input.googleFormId?.trim() || null);
  if (input.googleScriptId !== undefined) put("google_script_id", input.googleScriptId?.trim() || null);
  if (input.googleFormUrl !== undefined || input.googleFormId !== undefined) put("google_synced_at", nowIso());

  if (sets.length === 0) return existing;
  put("updated_at", nowIso());
  put("updated_by", userId);

  const db = await getDb();
  await db.run(`UPDATE surveys SET ${sets.join(", ")} WHERE survey_id = $1`, params);
  return (await getSurvey(surveyId))!;
}

export async function deleteSurvey(surveyId: string): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE surveys SET deleted_at = $2 WHERE survey_id = $1`, [surveyId, nowIso()]);
}

/** 설문 복제 — 문항까지 함께 복사한다(응답·구글 폼 연결은 승계하지 않는다). */
export async function duplicateSurvey(surveyId: string, userId: string): Promise<SurveyRow> {
  const src = await getSurveyDetail(surveyId);
  if (!src) throw err("설문을 찾을 수 없습니다.", 404);
  const created = await createSurvey({
    kind: src.kind,
    title: `${src.title} (사본)`,
    description: src.description,
    isAnonymous: src.isAnonymous,
    audience: src.audience,
    createdBy: userId,
  });
  await saveQuestions(
    created.surveyId,
    src.questions.map((q) => ({ ...q, questionId: crypto.randomUUID() }))
  );
  return (await getSurvey(created.surveyId))!;
}

// ── 문항 ────────────────────────────────────────────

export interface QuestionInput {
  questionId?: string;
  qtype: QuestionType;
  title: string;
  helpText?: string | null;
  isRequired?: boolean;
  options?: unknown;
  config?: unknown;
}

/**
 * 문항 전체 교체 — 빌더가 보낸 순서 그대로 seq 를 다시 매긴다.
 * 이미 응답이 들어온 설문은 기존 답과 문항 대응이 깨지므로 편집을 막는다.
 */
export async function saveQuestions(surveyId: string, questions: QuestionInput[]): Promise<SurveyQuestion[]> {
  const survey = await getSurvey(surveyId);
  if (!survey) throw err("설문을 찾을 수 없습니다.", 404);
  if ((survey.responseCount ?? 0) > 0) {
    throw err("이미 응답이 접수된 설문은 문항을 수정할 수 없습니다. 복제 후 수정하세요.", 409);
  }
  if (questions.length > 200) throw err("문항은 200개까지 가능합니다.", 400);

  const prepared = questions.map((q, i) => {
    const title = String(q.title ?? "").trim();
    if (!title) throw err(`${i + 1}번 문항의 제목을 입력하세요.`, 400);
    const qtype = q.qtype;
    if (!["single", "multi", "scale", "text", "longtext", "section"].includes(qtype)) {
      throw err(`${i + 1}번 문항의 유형이 올바르지 않습니다.`, 400);
    }
    const options = normalizeOptions(q.options);
    if ((qtype === "single" || qtype === "multi") && options.length < 2) {
      throw err(`${i + 1}번 문항: 보기를 2개 이상 입력하세요.`, 400);
    }
    return {
      questionId: q.questionId && /^[\w-]{6,64}$/.test(q.questionId) ? q.questionId : crypto.randomUUID(),
      seq: i + 1,
      qtype,
      title: title.slice(0, 500),
      helpText: q.helpText?.trim()?.slice(0, 1000) || null,
      isRequired: qtype === "section" ? false : !!q.isRequired,
      options,
      config: normalizeConfig(q.config),
    };
  });

  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM survey_questions WHERE survey_id = $1`, [surveyId]);
    for (const q of prepared) {
      await db.run(
        `INSERT INTO survey_questions
           (question_id, survey_id, seq, qtype, title, help_text, is_required, options, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
        [
          q.questionId, surveyId, q.seq, q.qtype, q.title, q.helpText, q.isRequired ? 1 : 0,
          JSON.stringify(q.options), JSON.stringify(q.config),
        ]
      );
    }
    await db.run(`UPDATE surveys SET updated_at = $2 WHERE survey_id = $1`, [surveyId, nowIso()]);
  });

  return (await getSurveyDetail(surveyId))!.questions;
}

// ── 응답(사내) ──────────────────────────────────────

/** 기간·상태로 지금 응답을 받을 수 있는지. */
export function isOpenNow(survey: SurveyRow, today = new Date().toISOString().slice(0, 10)): boolean {
  if (survey.status !== "open") return false;
  if (survey.periodStart && today < survey.periodStart) return false;
  if (survey.periodEnd && today > survey.periodEnd) return false;
  return true;
}

export async function getMyResponse(surveyId: string, userId: string): Promise<{ responseId: string; submittedAt: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT response_id, submitted_at FROM survey_responses WHERE survey_id = $1 AND user_id = $2 LIMIT 1`,
      [surveyId, userId]
    )
  );
  return rows[0] ? { responseId: String(rows[0].response_id), submittedAt: String(rows[0].submitted_at) } : null;
}

/** 답 1건을 문항 유형에 맞춰 검증·정규화. 미응답이면 null. */
function normalizeAnswer(q: SurveyQuestion, raw: unknown): unknown {
  const values = new Set(q.options.map((o) => o.value));
  if (q.config.allowOther) values.add(OTHER_VALUE);
  switch (q.qtype) {
    case "single": {
      const s = String(raw ?? "").trim();
      if (!s) return null;
      // 기타 입력은 "__other__:자유문구" 형태로 저장한다.
      const head = s.split(":", 1)[0];
      if (!values.has(head)) throw err(`"${q.title}" 문항의 보기 값이 올바르지 않습니다.`, 400);
      return s.slice(0, 500);
    }
    case "multi": {
      if (!Array.isArray(raw)) return null;
      const list = raw
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .slice(0, 50);
      for (const v of list) {
        if (!values.has(v.split(":", 1)[0])) throw err(`"${q.title}" 문항의 보기 값이 올바르지 않습니다.`, 400);
      }
      if (list.length === 0) return null;
      if (q.config.maxSelect && list.length > q.config.maxSelect) {
        throw err(`"${q.title}" 문항은 ${q.config.maxSelect}개까지 선택할 수 있습니다.`, 400);
      }
      return list.map((v) => v.slice(0, 500));
    }
    case "scale": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const min = q.config.min ?? 1;
      const max = q.config.max ?? 5;
      if (n < min || n > max) throw err(`"${q.title}" 문항의 점수 범위가 올바르지 않습니다.`, 400);
      return Math.trunc(n);
    }
    case "text":
    case "longtext": {
      const s = String(raw ?? "").trim();
      if (!s) return null;
      return s.slice(0, q.qtype === "text" ? 500 : 5000);
    }
    default:
      return null; // section 은 응답 대상이 아니다
  }
}

/** 응답 제출 — 1인 1회(설문×사용자 유니크). 익명 설문도 user_id 는 저장하되 집계에서 가린다. */
export async function submitResponse(input: {
  surveyId: string;
  userId: string;
  answers: AnswerMap;
  source: "web" | "mobile";
}): Promise<{ responseId: string; submittedAt: string }> {
  const detail = await getSurveyDetail(input.surveyId);
  if (!detail) throw err("설문을 찾을 수 없습니다.", 404);
  if (detail.kind !== "internal") throw err("외부 설문은 앱에서 응답을 받지 않습니다.", 400);
  if (!isOpenNow(detail)) throw err("지금은 응답을 받지 않는 설문입니다.", 409);
  if (await getMyResponse(input.surveyId, input.userId)) throw err("이미 응답한 설문입니다.", 409);

  const rows: { questionId: string; value: unknown }[] = [];
  for (const q of detail.questions) {
    if (q.qtype === "section") continue;
    const value = normalizeAnswer(q, input.answers[q.questionId]);
    if (value == null) {
      if (q.isRequired) throw err(`"${q.title}" 문항은 필수입니다.`, 400);
      continue;
    }
    rows.push({ questionId: q.questionId, value });
  }
  if (rows.length === 0) throw err("응답 내용이 없습니다.", 400);

  const responseId = crypto.randomUUID();
  const submittedAt = nowIso();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO survey_responses (response_id, survey_id, user_id, submitted_at, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [responseId, input.surveyId, input.userId, submittedAt, input.source]
    );
    for (const r of rows) {
      await db.run(
        `INSERT INTO survey_answers (response_id, question_id, value) VALUES ($1, $2, $3::jsonb)`,
        [responseId, r.questionId, JSON.stringify(r.value)]
      );
    }
  });
  return { responseId, submittedAt };
}

// ── 집계 ────────────────────────────────────────────

/** audience 기준 대상 인원. 사내 설문에서만 의미가 있다. */
async function countTargets(survey: SurveyRow): Promise<number | null> {
  if (survey.kind !== "internal") return null;
  const db = await getDb();
  if (survey.audience.scope === "departments" && survey.audience.departments?.length) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT COUNT(*) AS c
           FROM employee_profiles e
           JOIN users u ON u.user_id = e.user_id AND u.status = 'active'
          WHERE e.dept_id = ANY($1::text[])`,
        [survey.audience.departments]
      )
    );
    return Number(rows[0]?.c ?? 0);
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*) AS c FROM employee_profiles e
         JOIN users u ON u.user_id = e.user_id AND u.status = 'active'`
    )
  );
  return Number(rows[0]?.c ?? 0);
}

export async function getResults(surveyId: string): Promise<SurveyResults> {
  const detail = await getSurveyDetail(surveyId);
  if (!detail) throw err("설문을 찾을 수 없습니다.", 404);
  const db = await getDb();

  const answerRows = rowsToObjects(
    await db.exec(
      `SELECT a.question_id, a.value
         FROM survey_answers a
         JOIN survey_responses r ON r.response_id = a.response_id
        WHERE r.survey_id = $1`,
      [surveyId]
    )
  );
  const byQuestion = new Map<string, unknown[]>();
  for (const r of answerRows) {
    const qid = String(r.question_id);
    const list = byQuestion.get(qid) ?? [];
    list.push(parseJson<unknown>(r.value, null));
    byQuestion.set(qid, list);
  }

  const stats: QuestionStat[] = detail.questions
    .filter((q) => q.qtype !== "section")
    .map((q) => {
      const values = byQuestion.get(q.questionId) ?? [];
      const stat: QuestionStat = {
        questionId: q.questionId,
        qtype: q.qtype,
        title: q.title,
        answered: values.length,
      };
      if (q.qtype === "single" || q.qtype === "multi") {
        const counter = new Map<string, number>();
        for (const v of values) {
          const picked = Array.isArray(v) ? v : [v];
          for (const p of picked) {
            const key = String(p ?? "").split(":", 1)[0];
            if (!key) continue;
            counter.set(key, (counter.get(key) ?? 0) + 1);
          }
        }
        stat.counts = [
          ...q.options.map((o) => ({ value: o.value, label: o.label, count: counter.get(o.value) ?? 0 })),
          ...(counter.has(OTHER_VALUE) ? [{ value: OTHER_VALUE, label: "기타", count: counter.get(OTHER_VALUE)! }] : []),
        ];
      } else if (q.qtype === "scale") {
        const min = q.config.min ?? 1;
        const max = q.config.max ?? 5;
        const counter = new Map<number, number>();
        let sum = 0;
        let n = 0;
        for (const v of values) {
          const num = Number(v);
          if (!Number.isFinite(num)) continue;
          counter.set(num, (counter.get(num) ?? 0) + 1);
          sum += num;
          n += 1;
        }
        stat.average = n > 0 ? Math.round((sum / n) * 100) / 100 : 0;
        stat.distribution = [];
        for (let s = min; s <= max; s++) stat.distribution.push({ score: s, count: counter.get(s) ?? 0 });
      } else {
        stat.texts = values.map((v) => String(v ?? "")).filter(Boolean).slice(0, 500);
      }
      return stat;
    });

  const respondents: SurveyResults["respondents"] = [];
  if (!detail.isAnonymous) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT r.user_id, r.submitted_at, e.name, d.dept_name
           FROM survey_responses r
           LEFT JOIN employee_profiles e ON e.user_id = r.user_id
           LEFT JOIN departments d ON d.dept_id = e.dept_id
          WHERE r.survey_id = $1
          ORDER BY r.submitted_at DESC`,
        [surveyId]
      )
    );
    for (const r of rows) {
      respondents.push({
        userId: String(r.user_id ?? ""),
        name: r.name != null ? String(r.name) : "(이름 없음)",
        deptName: r.dept_name != null ? String(r.dept_name) : null,
        submittedAt: String(r.submitted_at ?? ""),
      });
    }
  }

  return {
    survey: detail,
    responseCount: detail.responseCount ?? 0,
    targetCount: await countTargets(detail),
    stats,
    respondents,
  };
}

// ── QR 배포 이미지 ──────────────────────────────────

function toNoticeRow(r: Record<string, unknown>): SurveyNoticeRow {
  return {
    noticeId: String(r.notice_id),
    surveyId: r.survey_id != null ? String(r.survey_id) : null,
    surveyTitle: r.survey_title != null ? String(r.survey_title) : null,
    name: String(r.name ?? ""),
    layout: r.layout === "mail" ? "mail" : "phone",
    fields: normalizeNoticeFields(parseJson(r.fields, {})),
    theme: normalizeNoticeTheme(parseJson(r.theme, {})),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
  };
}

const NOTICE_COLS = `n.notice_id, n.survey_id, n.name, n.layout, n.fields, n.theme,
  n.created_at, n.updated_at, n.updated_by, s.title AS survey_title`;

export async function listNotices(surveyId?: string | null): Promise<SurveyNoticeRow[]> {
  const db = await getDb();
  const params: unknown[] = [];
  const where = ["n.deleted_at IS NULL"];
  if (surveyId) {
    params.push(surveyId);
    where.push(`n.survey_id = $${params.length}`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${NOTICE_COLS}
         FROM survey_notices n
         LEFT JOIN surveys s ON s.survey_id = n.survey_id
        WHERE ${where.join(" AND ")}
        ORDER BY n.updated_at DESC`,
      params
    )
  );
  return rows.map(toNoticeRow);
}

export async function getNotice(noticeId: string): Promise<SurveyNoticeRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ${NOTICE_COLS}
         FROM survey_notices n
         LEFT JOIN surveys s ON s.survey_id = n.survey_id
        WHERE n.notice_id = $1 AND n.deleted_at IS NULL LIMIT 1`,
      [noticeId]
    )
  );
  return rows[0] ? toNoticeRow(rows[0]) : null;
}

export async function createNotice(input: {
  surveyId?: string | null;
  name: string;
  layout?: string;
  fields?: unknown;
  theme?: unknown;
  createdBy: string;
}): Promise<SurveyNoticeRow> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = nowIso();
  await db.run(
    `INSERT INTO survey_notices
       (notice_id, survey_id, name, layout, fields, theme, created_at, created_by, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $7, $8)`,
    [
      id, input.surveyId || null, input.name.trim() || "새 배포 이미지",
      input.layout === "mail" ? "mail" : "phone",
      JSON.stringify(normalizeNoticeFields(input.fields)),
      JSON.stringify(normalizeNoticeTheme(input.theme)),
      now, input.createdBy,
    ]
  );
  return (await getNotice(id))!;
}

export async function updateNotice(
  noticeId: string,
  input: { name?: string; layout?: string; fields?: unknown; theme?: unknown; surveyId?: string | null },
  userId: string
): Promise<SurveyNoticeRow> {
  const existing = await getNotice(noticeId);
  if (!existing) throw err("배포 이미지를 찾을 수 없습니다.", 404);
  const sets: string[] = [];
  const params: unknown[] = [noticeId];
  const put = (col: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast}`);
  };
  if (input.name != null) put("name", input.name.trim() || existing.name);
  if (input.layout != null) put("layout", input.layout === "mail" ? "mail" : "phone");
  if (input.surveyId !== undefined) put("survey_id", input.surveyId || null);
  if (input.fields !== undefined) put("fields", JSON.stringify(normalizeNoticeFields(input.fields)), "::jsonb");
  if (input.theme !== undefined) put("theme", JSON.stringify(normalizeNoticeTheme(input.theme)), "::jsonb");
  if (sets.length === 0) return existing;
  put("updated_at", nowIso());
  put("updated_by", userId);
  const db = await getDb();
  await db.run(`UPDATE survey_notices SET ${sets.join(", ")} WHERE notice_id = $1`, params);
  return (await getNotice(noticeId))!;
}

export async function deleteNotice(noticeId: string): Promise<void> {
  const db = await getDb();
  await db.run(`UPDATE survey_notices SET deleted_at = $2 WHERE notice_id = $1`, [noticeId, nowIso()]);
}

// ── 응답 대상 판정 ──────────────────────────────────

/** 사용자가 이 설문의 응답 대상인지(audience 기준). 부서 미배정자는 전사 대상 설문만 응답한다. */
export async function isAudienceMember(survey: SurveyRow, userId: string): Promise<boolean> {
  if (survey.kind !== "internal") return false;
  if (survey.audience.scope !== "departments") return true;
  const depts = survey.audience.departments ?? [];
  if (depts.length === 0) return true;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT 1 AS ok FROM employee_profiles WHERE user_id = $1 AND dept_id = ANY($2::text[]) LIMIT 1`,
      [userId, depts]
    )
  );
  return rows.length > 0;
}

/** 로그인 사용자가 지금 참여할 수 있는 사내 설문 목록(+ 이미 응답했는지). */
export async function listMySurveys(userId: string): Promise<SurveyRow[]> {
  const open = await listSurveys({ kind: "internal", status: "open", viewerUserId: userId });
  const today = new Date().toISOString().slice(0, 10);
  const out: SurveyRow[] = [];
  for (const s of open) {
    if (!isOpenNow(s, today)) continue;
    if (!(await isAudienceMember(s, userId))) continue;
    out.push(s);
  }
  return out;
}
