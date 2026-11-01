import type { ProposalStore } from "./store";
import { ProposalError, PROPOSAL_MAX_BYTES } from "./validate";

type Context = { params: Promise<{ id: string; edition?: string }> };
interface Dependencies { store: ProposalStore; authorize: (key: string) => Promise<{ userId: string }> }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown): Response {
  const status = Number((error as { status?: number })?.status);
  if (status >= 400 && status < 600) return json({ error: (error as Error).message, ...(status === 409 ? { conflict: true } : {}) }, status);
  console.error("[proposal] 요청 처리 실패", error instanceof Error ? error.name : "unknown");
  return json({ error: "제안서를 처리하지 못했습니다. 저장소 연결과 설정을 확인해 주세요." }, 500);
}
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length")) > PROPOSAL_MAX_BYTES) throw new ProposalError("요청이 30 MB를 넘습니다.", 413);
  if (!req.body) throw new ProposalError("요청 본문이 없습니다.");
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      count += value.byteLength;
      if (count > PROPOSAL_MAX_BYTES) { await reader.cancel(); throw new ProposalError("요청이 30 MB를 넘습니다.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const all = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(all)); } catch { throw new ProposalError("요청 JSON을 읽지 못했습니다."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProposalError("요청 형식이 올바르지 않습니다.");
  return body as Record<string, unknown>;
}

/** 모든 경로에서 먼저 권한 검사. 발행본에도 제안서의 실명·입찰 문안 열람 권한을 요구한다. */
export function createProposalHandlers({ store, authorize }: Dependencies) {
  return {
    async list() {
      try { await authorize("catalog.manage"); return json({ documents: await store.list() }); } catch (e) { return failure(e); }
    },
    async create(req: Request) {
      try { const actor = await authorize("catalog.manage"); const b = await bodyOf(req); return json(await store.create(b.document, b.rev, actor.userId), 201); } catch (e) { return failure(e); }
    },
    async get(_req: Request, ctx: Context) {
      try { await authorize("catalog.manage"); return json(await store.get((await ctx.params).id)); } catch (e) { return failure(e); }
    },
    async save(req: Request, ctx: Context) {
      try { const actor = await authorize("catalog.manage"); const b = await bodyOf(req); return json(await store.save((await ctx.params).id, b.document, b.rev, actor.userId)); } catch (e) { return failure(e); }
    },
    async editions(_req: Request, ctx: Context) {
      try { await authorize("catalog.manage"); return json({ editions: await store.listEditions((await ctx.params).id) }); } catch (e) { return failure(e); }
    },
    async publish(req: Request, ctx: Context) {
      try {
        const actor = await authorize("catalog.manage"); await authorize("catalog.publish"); const b = await bodyOf(req);
        return json({ edition: await store.publish((await ctx.params).id, b.rev, b.figures, actor.userId) }, 201);
      } catch (e) { return failure(e); }
    },
    async download(_req: Request, ctx: Context) {
      try {
        await authorize("catalog.manage"); const p = await ctx.params;
        const { bytes, edition } = await store.download(p.id, p.edition ?? "");
        const fileName = encodeURIComponent(edition.fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/hwp+zip", "Content-Disposition": `attachment; filename="proposal.hwpx"; filename*=UTF-8''${fileName}`, "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      } catch (e) { return failure(e); }
    },
  };
}
