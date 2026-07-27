import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { bulkUpdateMessages, listFolderMessages, type MailBulkAction } from "@/lib/mail/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FOLDERS = new Set(["inbox", "sent", "drafts", "archive", "spam", "trash"]);
const ALLOWED_ACTIONS = new Set<MailBulkAction>([
  "read", "unread", "star", "unstar", "trash", "restore", "move", "delete", "category", "archive", "moveTo", "unspam",
]);
const ALLOWED_MOVE_TARGETS = new Set(["inbox", "archive", "spam"]);

// GET: 메일함 폴더 메시지 목록 — folder=inbox|sent|...|user:<folderId>, q(검색), category(받은편지함 필터), limit, offset
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const folder = String(req.nextUrl.searchParams.get("folder") ?? "inbox");
    if (!ALLOWED_FOLDERS.has(folder) && !folder.startsWith("user:")) {
      return NextResponse.json({ error: "folder 파라미터가 올바르지 않습니다." }, { status: 400 });
    }
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");
    const q = req.nextUrl.searchParams.get("q") ?? undefined;
    const categoryId = req.nextUrl.searchParams.get("category") ?? undefined;
    const res = await listFolderMessages(ctx.userId, folder, { limit, offset, q, categoryId });
    return NextResponse.json(res);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 일괄 상태 변경 — body: { ids: string[], action, target? } (move 시 target=inbox|archive|spam)
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; action?: string; target?: string };
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const action = String(body.action ?? "") as MailBulkAction;
    if (!ids.length) return NextResponse.json({ error: "ids 가 필요합니다." }, { status: 400 });
    if (!ALLOWED_ACTIONS.has(action)) return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
    if (action === "move" && !ALLOWED_MOVE_TARGETS.has(String(body.target ?? ""))) {
      return NextResponse.json({ error: "move 대상 폴더가 올바르지 않습니다." }, { status: 400 });
    }
    // category 액션의 target 은 사용자 폴더 id(lib 에서 소유 검증) — 빈 값은 라벨 해제.
    const res = await bulkUpdateMessages(ctx.userId, ids, action, body.target);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
