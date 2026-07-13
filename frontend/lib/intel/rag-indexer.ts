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
