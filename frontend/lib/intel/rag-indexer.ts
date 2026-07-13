// 신호 → 벡터 DB 적재 배치 (D단계).
// intel_signals 전 등급(excluded/monitoring 포함)을 대상으로, 임베딩이 없는 신호를
// 소스별 문서 텍스트로 합성해 Voyage 임베딩 후 intel_embeddings 에 저장한다.
// 후보 편입 여부와 무관하게 전량 축적 — RAG 브리핑의 검색 모수가 된다.

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { EMBEDDING_MODEL, embedTexts, isEmbeddingConfigured, toVectorLiteral } from "./embeddings";
import { INTEL_SIGNAL_TYPE_LABELS, INTEL_SIGNAL_GRADE_LABELS } from "./signal-extractor";

const SOURCE_LABEL: Record<string, string> = {
  dart: "DART 전자공시",
  eiass: "EIASS 환경영향평가",
  press: "지자체 보도자료",
  news: "네이버 뉴스",
  gosi: "산업단지 고시",
};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

function parseRaw(v: unknown): Record<string, unknown> {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 소스별 본문 발췌 — 임베딩·브리핑 컨텍스트에 쓸 자유 텍스트. */
function sourceBody(source: string, raw: Record<string, unknown>): string | null {
  if (source === "news") {
    const cls = (raw.classification ?? {}) as Record<string, unknown>;
    return [str(raw.description), str(cls.location) && `위치: ${str(cls.location)}`, str(cls.scale) && `규모: ${str(cls.scale)}`]
      .filter(Boolean)
      .join("\n");
  }
  if (source === "press") return str(raw.body);
  if (source === "eiass") {
    const d = (raw.detail ?? {}) as Record<string, unknown>;
    const fields: Array<[string, string]> = [
      ["사업구분", "bizCategory"], ["사업시행자", "operator"], ["소재지", "region"],
      ["사업규모", "scaleText"], ["승인기관", "approver"], ["협의기관", "agency"],
    ];
    return fields
      .map(([label, key]) => (str(d[key]) ? `${label}: ${str(d[key])}` : null))
      .filter(Boolean)
      .join("\n") || null;
  }
  return null;
}

/** 신호 1건 → 임베딩 문서 텍스트(한국어 서술 + 메타 라인). 최대 4000자. */
export function buildSignalContent(row: Record<string, unknown>): string {
  const source = String(row.source ?? "");
  const raw = parseRaw(row.raw_json);
  const typeLabel = INTEL_SIGNAL_TYPE_LABELS[String(row.signal_type ?? "other") as keyof typeof INTEL_SIGNAL_TYPE_LABELS] ?? "기타";
  const gradeLabel = INTEL_SIGNAL_GRADE_LABELS[String(row.signal_grade ?? "candidate") as keyof typeof INTEL_SIGNAL_GRADE_LABELS] ?? "";
  const lines: Array<string | null> = [
    `[${SOURCE_LABEL[source] ?? source}] ${str(row.company_name) ?? "회사 미상"} · ${typeLabel} 신호(${gradeLabel})`,
    str(row.report_name) && `제목: ${str(row.report_name)}`,
    str(row.disclosed_at) && `일자: ${String(row.disclosed_at).slice(0, 10)}`,
    str(row.region) && `지역: ${str(row.region)}`,
    str(row.agency) && `기관: ${str(row.agency)}`,
    str(row.asset_class) && `자산구분: ${str(row.asset_class)}`,
    str(row.acquire_purpose) && `취득목적: ${str(row.acquire_purpose)}`,
    str(row.counterparty) && `거래상대방: ${str(row.counterparty)}`,
    row.amount != null && Number(row.amount) > 0 ? `금액: ${Math.round(Number(row.amount) / 1e8)}억원` : null,
    str(row.facility_name) && `매칭 사업장: ${str(row.facility_name)}`,
    str(row.summary) && `요약: ${str(row.summary)}`,
    sourceBody(source, raw),
  ];
  return lines.filter(Boolean).join("\n").slice(0, 4000);
}

export interface IndexResult {
  configured: boolean; // VOYAGE_API_KEY 설정 여부
  indexed: number; // 이번 실행으로 적재한 건수
  remaining: number; // 남은 미적재 건수
}

/**
 * 임베딩 미보유 신호를 batchLimit 건까지 적재. 반복 호출로 전량 축적(화면 버튼/배치 공용).
 */
export async function indexPendingEmbeddings(batchLimit = 200): Promise<IndexResult> {
  if (!isEmbeddingConfigured()) return { configured: false, indexed: 0, remaining: 0 };
  const db = await getDb();
  const limit = Math.min(Math.max(1, batchLimit), 500);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.signal_id, s.source, s.company_name, s.report_name, s.signal_type, s.signal_grade,
              s.disclosed_at, s.amount, s.region, s.agency, s.summary,
              s.asset_class, s.acquire_purpose, s.counterparty, s.raw_json,
              f.company_name AS facility_name
         FROM intel_signals s
         LEFT JOIN intel_embeddings e ON e.signal_id = s.signal_id
         LEFT JOIN facilities f ON f.facility_id = s.facility_id
        WHERE e.signal_id IS NULL
        ORDER BY s.created_at DESC
        LIMIT ${limit}`
    )
  );
  if (!rows.length) return { configured: true, indexed: 0, remaining: 0 };

  const contents = rows.map(buildSignalContent);
  const vectors = await embedTexts(contents, "document");
  if (!vectors) throw new Error("임베딩 API 호출에 실패했습니다. VOYAGE_API_KEY 또는 네트워크를 확인하세요.");

  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    for (let i = 0; i < rows.length; i++) {
      await wdb.run(
        `INSERT INTO intel_embeddings (signal_id, content, embedding, model, created_at)
         VALUES ($1, $2, $3::vector, $4, $5)
         ON CONFLICT (signal_id) DO NOTHING`,
        [String(rows[i].signal_id), contents[i], toVectorLiteral(vectors[i]), EMBEDDING_MODEL, now]
      );
    }
  });

  const remainRows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*)::int AS remaining
         FROM intel_signals s LEFT JOIN intel_embeddings e ON e.signal_id = s.signal_id
        WHERE e.signal_id IS NULL`
    )
  );
  return { configured: true, indexed: rows.length, remaining: Number(remainRows[0]?.remaining ?? 0) };
}

// ── 뉴스 중복 병합(마킹) ──────────────────────────────────────────────

/** 중복 판정 코사인 임계 — 실측(2026-07-13): 0.90+ 도 동일 사건 변형 기사(0.92 시작 후 사용자 승인으로 하향), 0.85 부터는 오탐 위험. */
const NEWS_DUP_THRESHOLD = 0.9;

export interface DedupResult {
  marked: number; // 이번 실행으로 duplicate_of 마킹된 건수
  totalDuplicates: number; // 마킹 누계
}

/**
 * 임베딩 코사인 유사도로 뉴스 중복(같은 사건의 변형 기사)을 대표 신호에 병합 마킹한다.
 * - 삭제하지 않는다: duplicate_of 에 대표 signal_id 를 기록해 보존(리스트·검색 기본에서만 제외).
 * - 대표 = (created_at, signal_id) 사전순으로 가장 이른 신호. 같은 배치 수집분은 created_at 이
 *   동일하므로 signal_id 타이브레이커가 필수다.
 * - 체인(A←B, B←C) 은 대표를 루트로 승격시켜 duplicate_of 가 항상 비중복 신호를 가리키게 한다.
 * 임베딩 적재(indexPendingEmbeddings) 이후에 호출한다(신규 신호의 임베딩이 있어야 판정 가능).
 */
export async function markNewsDuplicates(): Promise<DedupResult> {
  const db = await getDb();
  // 미마킹 뉴스 신호별로, 자기보다 이른 뉴스 신호 중 최고 유사도(임계 이상) 상대를 찾는다.
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (sb.signal_id)
              sb.signal_id AS dup_id, sa.signal_id AS rep_id,
              sa.duplicate_of AS rep_dup_of
         FROM intel_signals sb
         JOIN intel_embeddings eb ON eb.signal_id = sb.signal_id
         JOIN intel_signals sa
           ON sa.source = 'news'
          AND (sa.created_at, sa.signal_id) < (sb.created_at, sb.signal_id)
         JOIN intel_embeddings ea ON ea.signal_id = sa.signal_id
        WHERE sb.source = 'news'
          AND sb.duplicate_of IS NULL
          AND 1 - (ea.embedding <=> eb.embedding) >= ${NEWS_DUP_THRESHOLD}
        ORDER BY sb.signal_id, (ea.embedding <=> eb.embedding) ASC`
    )
  );

  if (rows.length) {
    // 대표가 이미 중복이면 그 대표(루트)로 승격 — 이번 배치 내 체인도 맵으로 해소
    const repOf = new Map<string, string>();
    for (const r of rows) {
      const dup = String(r.dup_id);
      const rep = str(r.rep_dup_of) ?? String(r.rep_id);
      repOf.set(dup, rep);
    }
    const resolve = (id: string): string => {
      let cur = id;
      for (let i = 0; i < 10 && repOf.has(cur); i++) cur = repOf.get(cur)!;
      return cur;
    };
    const now = new Date().toISOString();
    await withDbWrite(async (wdb) => {
      for (const r of rows) {
        const dup = String(r.dup_id);
        const rep = resolve(dup);
        if (rep === dup) continue; // 자기 자신(순환 방어)
        await wdb.run(
          `UPDATE intel_signals SET duplicate_of = $2, updated_at = $3 WHERE signal_id = $1`,
          [dup, rep, now]
        );
      }
    });
  }

  // 체인 플래튼: 이전 실행의 대표가 이번 실행(임계 하향 등)에서 중복으로 마킹되면
  // 기존 마킹이 중복을 가리키게 된다 → 루트로 승격될 때까지 반복 갱신.
  await withDbWrite(async (wdb) => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      const updated = rowsToObjects(
        await wdb.exec(
          `UPDATE intel_signals d SET duplicate_of = r.duplicate_of, updated_at = $1
             FROM intel_signals r
            WHERE d.duplicate_of = r.signal_id AND r.duplicate_of IS NOT NULL
              AND d.signal_id <> r.duplicate_of
            RETURNING d.signal_id`,
          [now]
        )
      );
      if (!updated.length) break;
    }
  });

  const totalRows = rowsToObjects(
    await db.exec(`SELECT COUNT(*)::int AS n FROM intel_signals WHERE duplicate_of IS NOT NULL`)
  );
  return { marked: rows.length, totalDuplicates: Number(totalRows[0]?.n ?? 0) };
}
