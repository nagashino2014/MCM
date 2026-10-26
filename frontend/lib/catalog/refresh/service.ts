import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { checkPermission, loadUserAccess } from "@/lib/auth/rbac";
import { buildDisplayIndustry, buildDisplayTitle } from "@/lib/catalog/appendix";
import { listAdvisors, listCatalogPeople, listExtraPeople } from "@/lib/catalog/people";
import { MASTER_DOC_ID, listCatalogProjects } from "@/lib/catalog/projects";
import { getCompanyProfile, listCredentials, listHistory } from "@/lib/company/profile";
import { sendNotifyEmail } from "@/lib/notify/email-ses";
import { sendPush } from "@/lib/notify/push-expo";
import {
  diffFingerprints,
  fields,
  notifyBody,
  parseFingerprint,
  type CatalogFingerprint,
  type ChangeKind,
  type FieldChange,
  type FpItem,
  type PendingDiff,
  type PendingSource,
} from "./diff";

/*
 * 회사소개서 변경 감지(P7) — 서버. 블루프린트 §6-7.
 *   지문(computeCatalogFingerprint) → 기준(최근 발행본 지문, 발행본이 없으면 첫 점검 때 잡은 기준) 과 비교
 *   → catalog_pending_changes 의 열린 항목을 차이 목록과 맞춘다(새 차이 추가 · 같은 항목은 문장만 갱신 · 되돌려져 사라진 차이는 지움)
 *   → 새 항목이 생겼으면 catalog.manage·publish 담당자에게 알린다(KST 하루 한 번, catalog_refresh_state.last_notified_day).
 * 발행하면 열린 항목은 그 발행본으로 해소(resolved_edition_id)되고, 그 발행본 지문이 다음 비교 기준이 된다.
 */

const s = (v: unknown): string => (v == null ? "" : String(v).trim());
const won = (n: number | null) => (n == null ? "" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const KIND_WORD: Record<string, string> = { license: "등록", certification: "인증", patent: "특허", award: "수상" };
const CONTENT_LABEL: Record<string, string> = { ceo_message: "대표이사 인사말", org_chart: "조직도" };

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 지금 원천 지문 — 소개서에 실리는 값만(§6-7: 계약·인사·회사 프로필·연혁·인증·인사말/조직도 확정판) */
export async function computeCatalogFingerprint(): Promise<CatalogFingerprint> {
  const db = await getDb();
  const [projects, people, extras, advisors, profile, history, credentials, contentRows] = await Promise.all([
    listCatalogProjects(),
    listCatalogPeople(),
    listExtraPeople(),
    listAdvisors(),
    getCompanyProfile(),
    listHistory(),
    listCredentials(),
    db.exec(
      `SELECT DISTINCT ON (content_key) content_key, version, data::text AS data
         FROM catalog_content_versions ORDER BY content_key, version DESC`
    ),
  ]);

  const contracts: Record<string, FpItem> = {};
  for (const p of projects) {
    const m = p.meta;
    contracts[p.contractId] = {
      l: [p.year, buildDisplayTitle(p)].filter(Boolean).join(" "),
      d: fields([
        ["분류", p.category],
        ["세분류", p.subtype],
        ["수주 연도", p.year],
        ["금액", p.isUnitPrice && p.amount == null ? "단가 계약" : won(p.amount)],
        ["발주처", p.counterpartyName],
        ["사업장", p.siteName],
        ["지역", p.regionSido],
        ["업종", buildDisplayIndustry(p)],
        ["착수", p.startedAt],
        ["종료", p.endedAt],
        ["허가일", p.permitIssuedAt],
        ["결정번호", p.permitNo],
        ["완료일", p.completedAt],
        ["대외 표기", m?.displayTitle],
        ["대외 업종", m?.displayIndustry],
        ["공개", m ? (m.isPublic ? "공개" : "비공개(○○사)") : ""],
        ["대표 실적", m?.isFeatured],
        ["표시", m && m.displayOverride !== "auto" ? (m.displayOverride === "always" ? "항상 표시" : "항상 숨김") : ""],
        ["묶음", m?.groupKey],
        ["허가 사업장 수", m?.siteCount],
      ]),
    };
  }

  const peopleFp: Record<string, FpItem> = {};
  for (const p of people) {
    const kind = p.section === "exec" ? "임원" : "직원";
    peopleFp[`e:${p.employeeId}`] = {
      l: `${kind} ${p.name}${p.positionName ? `(${p.positionName})` : ""}`,
      d: fields([
        ["구분", kind],
        ["부서", p.deptName],
        ["직급", p.positionName],
        ["환경 등급", p.envGrade],
        ["엔지니어링 등급", p.engGrade],
        ["게재", p.shown ? "게재" : "미게재"],
        ["사진", p.photoShown ? "게재" : ""],
        ["직함 표기", p.meta?.roleLabel],
        ["약력 요약", p.meta?.bioShort],
      ]),
    };
  }
  for (const x of extras) {
    peopleFp[`x:${x.personId}`] = {
      l: `${x.employmentType} ${x.name}${x.roleLabel ? `(${x.roleLabel})` : ""}`,
      d: fields([
        ["구분", x.employmentType],
        ["직함", x.roleLabel],
        ["약력", [x.career, x.bioShort].filter(Boolean).join(" · ")],
        ["게재", x.isPublic ? "게재" : "미게재"],
        ["사진", x.photoAssetId ? "있음" : ""],
        ["인원 수 포함", x.countInTotal],
      ]),
    };
  }
  for (const a of advisors) {
    peopleFp[`a:${a.advisorId}`] = {
      l: `자문위원 ${a.name}`,
      d: fields([
        ["분야", a.field],
        ["소속", a.org],
        ["직함", a.title],
        ["경력", a.career],
        ["게재", a.isPublic ? "게재" : "미게재"],
      ]),
    };
  }

  const company: Record<string, FpItem> = {};
  const fin = [...profile.finance].filter((f) => Number(f.revenue) > 0).sort((a, b) => b.year.localeCompare(a.year))[0];
  const credit = [...profile.credit].sort((a, b) => b.ratedAt.localeCompare(a.ratedAt))[0];
  const profileFields: Array<[string, string]> = [
    ["회사명", profile.companyName],
    ["대표자", profile.ceoName],
    ["주소", profile.address],
    ["대표 전화", profile.phone],
    ["설립", profile.foundedYm],
    ["홈페이지", profile.website],
    ["대표 메일", profile.email],
    ["비전", profile.vision],
    ["슬로건", profile.slogan],
    ["최근 매출", fin ? `${fin.year}년 ${won(Number(fin.revenue))}` : ""],
    ["신용등급", credit ? `${credit.creditGrade} (${credit.agency} ${credit.ratedAt})` : ""],
  ];
  for (const [name, value] of profileFields) if (s(value)) company[name] = { l: name, d: { 값: s(value) } };

  const historyFp: Record<string, FpItem> = {};
  for (const h of history.filter((x) => x.isPublic)) {
    historyFp[h.historyId] = {
      l: `${h.eventYm.replace("-", ".")} ${h.content}`,
      d: fields([
        ["연월", h.eventYm],
        ["내용", h.content],
        ["분류", h.category],
        ["강조", h.highlight],
      ]),
    };
  }

  const credFp: Record<string, FpItem> = {};
  for (const c of credentials.filter((x) => x.isPublic)) {
    credFp[c.credentialId] = {
      l: `${KIND_WORD[c.kind] ?? "등록"} ${c.name}`,
      d: fields([
        ["종류", KIND_WORD[c.kind] ?? c.kind],
        ["이름", c.name],
        ["번호", c.credentialNo],
        ["취득일", c.issuedAt],
        ["증빙", c.file ? "있음" : ""],
      ]),
    };
  }

  const contents: Record<string, FpItem> = {};
  for (const r of rowsToObjects(contentRows)) {
    const key = s(r.content_key);
    const hash = crypto.createHash("sha1").update(s(r.data)).digest("hex").slice(0, 12);
    contents[key] = { l: CONTENT_LABEL[key] ?? key, d: { 확정판: `${Number(r.version)}판`, 내용: hash } };
  }

  return {
    v: 1,
    at: new Date().toISOString(),
    sources: { contracts, people: peopleFp, company_profile: company, history: historyFp, credentials: credFp, contents },
  };
}

// ─────────────────────────────── 기준·반영 대기 ───────────────────────────────

export interface RefreshBaseline {
  /** 기준이 된 발행본(없으면 첫 점검 기준) */
  editionId: string | null;
  publishedAt: string | null;
  label: string;
  fingerprint: CatalogFingerprint;
}

/** 비교 기준 — 최근 발행본 지문, 발행본이 없으면 첫 점검 때 잡은 기준(catalog_refresh_state.baseline) */
export async function loadBaseline(docId = MASTER_DOC_ID): Promise<RefreshBaseline | null> {
  const db = await getDb();
  const ed = rowsToObjects(
    await db.exec(
      `SELECT edition_id, published_at, fingerprint, options FROM catalog_editions
        WHERE doc_id = $1 AND options->>'stage' = 'published' ORDER BY published_at DESC LIMIT 1`,
      [docId]
    )
  )[0];
  const fp = ed ? parseFingerprint(ed.fingerprint) : null;
  if (ed && fp) return { editionId: s(ed.edition_id), publishedAt: s(ed.published_at), label: "최근 발행본", fingerprint: fp };
  const st = rowsToObjects(await db.exec("SELECT baseline, baseline_at FROM catalog_refresh_state WHERE doc_id = $1", [docId]))[0];
  const base = st ? parseFingerprint(st.baseline) : null;
  return base ? { editionId: null, publishedAt: s(st.baseline_at) || null, label: "첫 점검 기준", fingerprint: base } : null;
}

export interface PendingRow {
  changeId: string;
  source: PendingSource;
  kind: ChangeKind;
  key: string;
  summary: string;
  fields: FieldChange[];
  detectedAt: string;
}

function mapPending(r: Record<string, unknown>): PendingRow {
  let ref: Record<string, unknown> = {};
  try {
    ref = (typeof r.ref === "string" ? JSON.parse(r.ref) : r.ref ?? {}) as Record<string, unknown>;
  } catch {
    ref = {};
  }
  return {
    changeId: s(r.change_id),
    source: s(r.source) as PendingSource,
    kind: s(r.change_kind) as ChangeKind,
    key: s(ref.key),
    summary: s(r.summary),
    fields: (Array.isArray(ref.fields) ? ref.fields : []) as FieldChange[],
    detectedAt: s(r.detected_at),
  };
}

export async function listOpenPending(docId = MASTER_DOC_ID): Promise<PendingRow[]> {
  const db = await getDb();
  return rowsToObjects(
    await db.exec(
      `SELECT change_id, source, change_kind, summary, ref, detected_at FROM catalog_pending_changes
        WHERE doc_id = $1 AND resolved_edition_id IS NULL ORDER BY detected_at DESC, change_id`,
      [docId]
    )
  ).map(mapPending);
}

export interface RefreshState {
  lastCheckedAt: string | null;
  lastNotifiedAt: string | null;
}

export async function loadRefreshState(docId = MASTER_DOC_ID): Promise<RefreshState> {
  const db = await getDb();
  const r = rowsToObjects(await db.exec("SELECT last_checked_at, last_notified_at FROM catalog_refresh_state WHERE doc_id = $1", [docId]))[0];
  return { lastCheckedAt: r ? s(r.last_checked_at) || null : null, lastNotifiedAt: r ? s(r.last_notified_at) || null : null };
}

export interface RefreshResult {
  docId: string;
  /** 발행본도 기준도 없어 이번 지문을 기준으로 잡았다(반영 대기 0) */
  baselineSet: boolean;
  open: number;
  added: number;
  updated: number;
  cleared: number;
  notified: string;
}

/**
 * 변경 감지 1회 — 차이를 계산해 열린 반영 대기와 맞춘다. 같은 항목은 (문서, 원천, 키)당 1건(312 부분 유니크).
 * notify 가 참이고 이번에 새 항목이 생겼으면 담당자에게 알린다(하루 한 번).
 */
export async function runCatalogRefresh(opts: { docId?: string; notify?: boolean } = {}): Promise<RefreshResult> {
  const docId = opts.docId ?? MASTER_DOC_ID;
  const [cur, base] = await Promise.all([computeCatalogFingerprint(), loadBaseline(docId)]);
  const now = new Date().toISOString();
  if (!base) {
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO catalog_refresh_state (doc_id, baseline, baseline_at, last_checked_at, last_open_count) VALUES ($1, $2::jsonb, $3, $3, 0)
         ON CONFLICT (doc_id) DO UPDATE SET baseline = EXCLUDED.baseline, baseline_at = EXCLUDED.baseline_at, last_checked_at = EXCLUDED.last_checked_at, last_open_count = 0`,
        [docId, JSON.stringify(cur), now]
      );
    });
    return { docId, baselineSet: true, open: 0, added: 0, updated: 0, cleared: 0, notified: "" };
  }

  const diffs = diffFingerprints(base.fingerprint, cur);
  const fresh: PendingDiff[] = [];
  let updated = 0;
  let cleared = 0;
  await withDbWrite(async (txn) => {
    const open = rowsToObjects(
      await txn.exec(
        `SELECT change_id, source, change_kind, summary, ref->>'key' AS item_key FROM catalog_pending_changes
          WHERE doc_id = $1 AND resolved_edition_id IS NULL FOR UPDATE`,
        [docId]
      )
    );
    const byKey = new Map(open.map((r) => [`${s(r.source)}|${s(r.item_key)}`, r]));
    const seen = new Set<string>();
    for (const d of diffs) {
      const k = `${d.source}|${d.key}`;
      seen.add(k);
      const ref = JSON.stringify({ key: d.key, label: d.label, fields: d.fields.slice(0, 12) });
      const prev = byKey.get(k);
      if (!prev) {
        // tick 과 [지금 다시 점검]이 겹쳐도 같은 항목은 한 행(312 부분 유니크) — 먼저 넣은 쪽만 '새 항목'으로 센다
        const ins = rowsToObjects(
          await txn.exec(
            `INSERT INTO catalog_pending_changes (change_id, doc_id, source, change_kind, summary, ref, detected_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
             ON CONFLICT (doc_id, source, (ref->>'key')) WHERE resolved_edition_id IS NULL DO NOTHING
             RETURNING change_id`,
            ["cpc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), docId, d.source, d.kind, d.summary, ref, now]
          )
        );
        if (ins.length) fresh.push(d);
      } else if (s(prev.change_kind) !== d.kind || s(prev.summary) !== d.summary) {
        updated += 1;
        await txn.run(`UPDATE catalog_pending_changes SET change_kind = $2, summary = $3, ref = $4::jsonb WHERE change_id = $1`, [
          s(prev.change_id),
          d.kind,
          d.summary,
          ref,
        ]);
      } else {
        // 칸 값만 바뀐 경우(같은 칸 이름) — 전후 값은 최신으로
        await txn.run(`UPDATE catalog_pending_changes SET ref = $2::jsonb WHERE change_id = $1`, [s(prev.change_id), ref]);
      }
    }
    // 되돌려져 더는 차이가 아닌 항목(예: 고쳤다가 원래대로) — 발행으로 해소된 것이 아니므로 지운다
    for (const [k, r] of byKey) {
      if (seen.has(k)) continue;
      cleared += 1;
      await txn.run("DELETE FROM catalog_pending_changes WHERE change_id = $1", [s(r.change_id)]);
    }
    await txn.run(
      `INSERT INTO catalog_refresh_state (doc_id, last_checked_at, last_open_count) VALUES ($1, $2, $3)
       ON CONFLICT (doc_id) DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at, last_open_count = EXCLUDED.last_open_count`,
      [docId, now, diffs.length]
    );
  });

  let notified = "";
  if (opts.notify && fresh.length) notified = await notifyPending(docId, fresh, diffs.length);
  return { docId, baselineSet: false, open: diffs.length, added: fresh.length, updated, cleared, notified };
}

/** 발행 직후 — 열린 반영 대기를 그 발행본으로 해소한다(발행본 지문이 새 기준이 된다) */
export async function resolvePendingByEdition(docId: string, editionId: string): Promise<number> {
  let n = 0;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `UPDATE catalog_pending_changes SET resolved_edition_id = $2 WHERE doc_id = $1 AND resolved_edition_id IS NULL RETURNING change_id`,
        [docId, editionId]
      )
    );
    n = rows.length;
  });
  return n;
}

// ─────────────────────────────── 권한·알림 ───────────────────────────────

export interface CatalogRoles {
  view: boolean;
  manage: boolean;
  publish: boolean;
}

export async function catalogRoles(userId: string): Promise<CatalogRoles> {
  const access = await loadUserAccess(userId);
  return {
    view: checkPermission(access, "catalog.view"),
    manage: checkPermission(access, "catalog.manage"),
    publish: checkPermission(access, "catalog.publish"),
  };
}

/** 알림 받을 사람 — catalog.manage 또는 catalog.publish 를 가진 활성 계정(거부 grant 반영) */
export async function catalogStewards(): Promise<string[]> {
  const db = await getDb();
  const today = kstToday();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT a.user_id
         FROM user_permission_assignments a
         JOIN permission_templates t ON t.template_id = a.template_id AND t.is_active = 1
         JOIN permission_template_grants g ON g.template_id = a.template_id
         JOIN users u ON u.user_id = a.user_id AND COALESCE(u.status, 'active') = 'active'
        WHERE g.permission_key IN ('catalog.manage', 'catalog.publish') AND g.effect = 'allow'
          AND a.revoked_at IS NULL
          AND (a.effective_from IS NULL OR left(a.effective_from, 10) <= $1)
          AND (a.effective_to IS NULL OR left(a.effective_to, 10) >= $1)`,
      [today]
    )
  );
  const out: string[] = [];
  for (const r of rows) {
    const roles = await catalogRoles(s(r.user_id));
    if (roles.manage || roles.publish) out.push(s(r.user_id));
  }
  return out;
}

async function notifyPending(docId: string, fresh: PendingDiff[], openCount: number): Promise<string> {
  const day = kstToday();
  const db = await getDb();
  const st = rowsToObjects(await db.exec("SELECT last_notified_day FROM catalog_refresh_state WHERE doc_id = $1", [docId]))[0];
  if (st && s(st.last_notified_day) === day) return "skipped:notified-today";
  // 먼저 오늘 날짜를 찍어 둔다 — 두 틱이 겹쳐도 한 번만 보낸다
  let claimed = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `UPDATE catalog_refresh_state SET last_notified_day = $2, last_notified_at = $3
          WHERE doc_id = $1 AND (last_notified_day IS NULL OR last_notified_day <> $2) RETURNING doc_id`,
        [docId, day, new Date().toISOString()]
      )
    );
    claimed = rows.length > 0;
  });
  if (!claimed) return "skipped:notified-today";

  const users = await catalogStewards();
  if (!users.length) return "skipped:no-recipient";
  const title = `회사소개서 반영 대기 ${openCount}건`;
  const body = `${notifyBody(fresh)}\n발행본에 반영하려면 검토 후 발행하세요.`;
  // 결과 = "recipients:N;push:ok|skipped(사유);email:…" — 틱 응답·서버 로그로 왜 안 갔는지 추적한다
  const channels: string[] = [`recipients:${users.length}`];
  const tag = (name: string, r: { ok: boolean; skipped?: string; error?: string }) =>
    `${name}:${r.ok ? "ok" : r.skipped ? `skipped(${r.skipped})` : `error(${r.error ?? ""})`}`;
  try {
    const r = await sendPush(users, { event: "catalog.pending", title, body, link: "/sales/catalog", targetRef: docId, dedupKey: `catalog.pending:${docId}:${day}` });
    channels.push(tag("push", r));
  } catch (e) {
    console.warn(`[catalog-refresh] push 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    const to = rowsToObjects(
      await db.exec("SELECT email FROM users WHERE user_id = ANY($1::text[]) AND email IS NOT NULL AND email <> ''", [users])
    ).map((r) => s(r.email));
    if (to.length) {
      const r = await sendNotifyEmail({ to, subject: `[MCM] ${title}`, text: `${body}\n\n회사소개서 화면: /sales/catalog` });
      channels.push(tag("email", r));
    }
  } catch (e) {
    console.warn(`[catalog-refresh] email 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.info(`[catalog-refresh] ${docId} 반영 대기 알림 ${channels.join(";")}`);
  return channels.join(";");
}
