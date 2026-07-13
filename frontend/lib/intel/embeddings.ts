// 텍스트 임베딩 클라이언트 (Voyage AI voyage-3.5-lite, 1024차원).
// news-classifier.ts 의 API 직접 호출 패턴 재사용. VOYAGE_API_KEY 없으면 null(임베딩 skip,
// RAG 검색은 키워드 폴백으로 동작). 차원을 바꾸면 intel_embeddings 테이블(066)도 재생성해야 한다.

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

export const EMBEDDING_MODEL = "voyage-3.5-lite";
export const EMBEDDING_DIM = 1024;

/** 임베딩 키 설정 여부 — 화면에서 벡터 검색 가능 여부 표시에 사용. */
export function isEmbeddingConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}

/**
 * 텍스트 배열을 임베딩. 키 없으면 null, API 오류는 원인 포함 Error throw(화면에 그대로 표시).
 * inputType: 축적 문서='document', 사용자 질의='query' (Voyage 권장 비대칭 프롬프트).
 * Voyage 배치 상한(128개/요청)에 맞춰 내부 분할 호출.
 */
export async function embedTexts(
  texts: string[],
  inputType: "document" | "query"
): Promise<number[][] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) return null;
  if (!texts.length) return [];

  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128);
    let res: Response | null = null;
    // 무료 티어(3 RPM)의 429 는 20 여초 후 재시도. 그 외 오류는 즉시 throw.
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: batch,
            input_type: inputType,
            output_dimension: EMBEDDING_DIM,
          }),
          signal: controller.signal,
        });
      } catch (e) {
        const err = e as Error & { cause?: { code?: string; message?: string } };
        const cause = err.cause ? ` (${err.cause.code ?? err.cause.message ?? ""})` : "";
        throw new Error(`임베딩 API 연결 실패: ${err.name === "AbortError" ? "타임아웃(60s)" : err.message}${cause}`);
      } finally {
        clearTimeout(timer);
      }
      if (res.status !== 429 || attempt === 2) break;
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 21) * 1000));
    }
    if (!res || !res.ok) {
      const detail = res ? await res.text().catch(() => "") : "";
      throw new Error(`임베딩 API 오류 (HTTP ${res?.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
    const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
    if (rows.length !== batch.length) {
      throw new Error(`임베딩 응답 건수 불일치 (요청 ${batch.length} / 응답 ${rows.length})`);
    }
    for (const r of rows) out.push(r.embedding);
  }
  return out;
}

/** number[] → pgvector 리터럴('[0.1,0.2,...]'). 파라미터 바인딩 후 ::vector 캐스트로 사용. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
