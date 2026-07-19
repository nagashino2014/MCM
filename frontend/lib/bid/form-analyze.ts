import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { anthropicChatJson } from "@/lib/ai/llm-json";
import { readStorageObject } from "@/lib/contracts/document-bundle";
import { parseHwpxForm, serializeFormForLlm } from "@/lib/bid/hwpx-form";
import { PACKAGE_DOC_CATALOG } from "@/lib/bid/package-catalog";
import { getFormById } from "@/lib/bid/package-store";

/*
 * 발주처 입찰 서류 양식(HWPX) LLM 분석 — 표·셀 구조를 표준 문서 타입 8종·필드 수퍼셋에
 * 매핑해 form_profile(jsonb) 로 저장한다. P3 문서 생성이 이 매핑(셀 좌표)으로 값을 주입한다.
 * 미매핑 셀은 UI 미세조정(항목 추가/삭제)으로 보정한다.
 */

export interface ProfileField {
  field: string; // 카탈로그 키 또는 "custom:<라벨>"
  label: string; // 양식에 표기된 라벨
  table: number | null;
  row: number | null;
  col: number | null;
}

export interface ProfileRepeatCol {
  col: number;
  field: string;
  label: string;
}

export interface ProfileRepeat {
  table: number;
  fromRow: number; // 첫 데이터 행(헤더 다음)
  columns: ProfileRepeatCol[];
}

export interface ProfileDoc {
  docType: string; // PACKAGE_DOC_CATALOG type 또는 "unknown"
  title: string; // 양식 내 표제(예: [별첨 서식 4] …)
  tables: number[]; // 이 문서에 속한 표 index
  fields: ProfileField[];
  repeat: ProfileRepeat | null;
  /** 인당 1표 복제형(개별 경력사항) — 표 전체를 인원수만큼 복제. */
  perPersonTable: boolean;
}

export interface FormProfile {
  analyzedAt: string;
  model: string;
  documents: ProfileDoc[];
}

const MODEL = process.env.SCRAPER_ANALYZE_MODEL || "claude-sonnet-5";
const VALID_TYPES = new Set([...PACKAGE_DOC_CATALOG.map((d) => d.type), "unknown"]);

function catalogForPrompt(): string {
  return PACKAGE_DOC_CATALOG.map((d) => {
    const fields = d.fields.map((f) => `${f.key}(${f.label}${f.hint ? ` — ${f.hint}` : ""})`).join(", ");
    const repeats = (d.repeatFields ?? []).map((f) => `${f.key}(${f.label})`).join(", ");
    return `- ${d.type} "${d.label}"\n  단일 필드: ${fields || "(없음)"}\n  반복 행 필드: ${repeats || "(없음)"}`;
  }).join("\n");
}

function buildPrompt(serialized: string): string {
  return (
    "다음은 한국 공공입찰 제안요청서(RFP)의 입찰 제출 서류 양식(HWPX)을 표·셀 좌표로 직렬화한 것입니다. " +
    "각 표를 아래 표준 문서 타입 카탈로그에 매핑하고, 데이터가 입력될 셀 위치를 산출하세요.\n\n" +
    "## 표준 문서 타입 카탈로그\n" + catalogForPrompt() + "\n\n" +
    "## 매핑 규칙\n" +
    "1. [문단]의 서식 표제([별첨 서식 N]·【양식 N】·[서식 N] 등)와 표 내용을 근거로 문서 경계를 나누고 docType 을 정하세요. 해당 없으면 \"unknown\".\n" +
    "2. 단일 필드: 양식 라벨 셀 옆/아래의 **값이 들어갈 셀** 좌표를 {table,row,col} 로. 샘플 값이 이미 채워져 있으면 그 값 셀이 대상입니다. 셀이 아닌 본문 치환(동의서 용역명 등)은 그 문단이 담긴 표의 셀 좌표(예: 1x1 표의 r0c0)로.\n" +
    "3. 반복 행(실적·인력 목록): repeat 에 {table, fromRow(첫 데이터 행), columns:[{col,field,label}]} 로. 헤더 행·합계 행은 제외.\n" +
    "4. 개별 경력사항처럼 **한 사람당 표 1개**가 반복되는 문서는 perPersonTable=true 로 하고, 대표 표 1개 기준으로 fields/repeat 를 산출하세요(같은 구조의 표가 여러 개면 tables 에 전부 나열).\n" +
    "5. 카탈로그에 없는 입력 항목은 field 를 \"custom:<간단한영문키>\" 로 만들되 label 에 양식 라벨을 그대로 쓰세요. 발주처 평가 기입란(득점 등)은 score 필드로 매핑만 하고 생성 시 빈칸 유지됩니다.\n" +
    "6. 확실하지 않은 항목은 제외하지 말고 가장 그럴듯한 매핑을 제시하세요(사용자가 화면에서 보정합니다).\n" +
    "7. **[문단](표 밖)에 있는 항목은 fields 에 넣지 마세요** — 셀 좌표가 있는 표 안 항목만 매핑합니다. " +
    "라벨이 인쇄된 셀(예: '구 분', '성 명' 헤더)은 값 셀이 아니므로 매핑하지 마세요.\n" +
    "8. '주요연혁' 라벨 아래/옆의 **큰 내용 셀(또는 라벨 행 바로 다음의 1x1 표)** 이 연혁 목록이 들어갈 " +
    "자리입니다 — company_profile 의 historyList 를 그 내용 셀에 매핑하세요(라벨 셀 아님).\n" +
    "9. 신용평가 등급 서식이 **평가기관 확인서 스캔 이미지를 붙이는 형태**(입력 셀 없이 빈 표/이미지만 있음)면 " +
    "credit_rating 문서로 분류하되 fields 를 빈 배열로 두세요 — 텍스트를 넣을 자리가 아닙니다.\n\n" +
    "## 출력(JSON만, 설명 금지)\n" +
    '{"documents":[{"docType":"","title":"","tables":[0],"fields":[{"field":"","label":"","table":0,"row":0,"col":0}],' +
    '"repeat":{"table":0,"fromRow":1,"columns":[{"col":0,"field":"","label":""}]} 또는 null,"perPersonTable":false}]}\n\n' +
    "## 양식 직렬화\n" + serialized
  );
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function sanitizeProfile(raw: unknown, model: string): FormProfile {
  const root = (raw ?? {}) as Record<string, unknown>;
  const docsRaw = Array.isArray(root.documents) ? root.documents : [];
  const documents: ProfileDoc[] = docsRaw.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const docType = VALID_TYPES.has(String(o.docType)) ? String(o.docType) : "unknown";
    const fields: ProfileField[] = (Array.isArray(o.fields) ? o.fields : [])
      .map((f) => {
        const x = (f ?? {}) as Record<string, unknown>;
        return {
          field: String(x.field ?? "").trim(),
          label: String(x.label ?? "").trim(),
          table: num(x.table),
          row: num(x.row),
          col: num(x.col),
        };
      })
      .filter((f) => f.field);
    let repeat: ProfileRepeat | null = null;
    const r = (o.repeat ?? null) as Record<string, unknown> | null;
    if (r && num(r.table) != null) {
      const columns: ProfileRepeatCol[] = (Array.isArray(r.columns) ? r.columns : [])
        .map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          return { col: num(x.col) ?? 0, field: String(x.field ?? "").trim(), label: String(x.label ?? "").trim() };
        })
        .filter((c) => c.field);
      repeat = { table: num(r.table) ?? 0, fromRow: num(r.fromRow) ?? 1, columns };
    }
    return {
      docType,
      title: String(o.title ?? "").trim(),
      tables: (Array.isArray(o.tables) ? o.tables : []).map((t) => num(t)).filter((t): t is number => t != null),
      fields,
      repeat,
      perPersonTable: o.perPersonTable === true,
    };
  });
  return { analyzedAt: new Date().toISOString(), model, documents };
}

/** HWPX 바이트 → 파싱 → LLM 매핑(저장 없음). 검증·재사용 가능한 분석 코어. */
export async function analyzeFormBytes(bytes: Uint8Array): Promise<FormProfile> {
  const doc = await parseHwpxForm(bytes);
  if (doc.tables.length === 0) {
    throw new Error("양식에서 표를 찾지 못했습니다. 파일을 확인하세요.");
  }
  const serialized = serializeFormForLlm(doc);
  const raw = await anthropicChatJson<unknown>({
    user: buildPrompt(serialized),
    model: MODEL,
    maxTokens: 8000,
    timeoutMs: 180_000,
  });
  const profile = sanitizeProfile(raw, MODEL);
  if (profile.documents.length === 0) {
    throw new Error("양식에서 표준 서류를 식별하지 못했습니다.");
  }
  return profile;
}

/** 양식 파일(S3) 로드 → 분석 → form_profile 저장. */
export async function analyzeFormProfile(formId: string): Promise<FormProfile> {
  const form = await getFormById(formId);
  if (!form) throw new Error("양식을 찾을 수 없습니다.");
  const ext = (form.displayName.split(".").pop() || "").toLowerCase();
  if (ext !== "hwpx") {
    throw new Error("양식 분석은 HWPX 파일만 지원합니다. 한글에서 HWPX 로 저장해 다시 업로드하세요.");
  }
  const bytes = await readStorageObject(form.storageKey);
  const profile = await analyzeFormBytes(bytes);
  await saveFormProfile(formId, profile);
  return profile;
}

export async function getFormProfile(formId: string): Promise<FormProfile | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT form_profile FROM bid_package_forms WHERE form_id = $1", [formId])
  );
  const raw = rows[0]?.form_profile;
  if (raw == null) return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v as FormProfile;
  } catch {
    return null;
  }
}

/** 미세조정 저장 포함 — 프로필 전체 교체. */
export async function saveFormProfile(formId: string, profile: FormProfile): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      "UPDATE bid_package_forms SET form_profile = $2::jsonb, updated_at = $3 WHERE form_id = $1",
      [formId, JSON.stringify(profile), new Date().toISOString()]
    );
  });
}
