import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { suggestRecipients, type RecipientSuggestion } from "@/lib/directory";
import { suggestMailContacts } from "@/lib/mail/sender-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 수신자 자동완성(G6-A) — 임직원·별칭/배포리스트·외부 담당자(주소록 공유) + 내 메일 주소록(305, 보낸 사람 팝업에서 추가).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const q = req.nextUrl.searchParams.get("q") ?? "";
    const [shared, mine] = await Promise.all([
      suggestRecipients(q),
      q.trim() ? suggestMailContacts(ctx.userId, q, 6).catch(() => []) : Promise.resolve([]),
    ]);
    const seen = new Set(shared.map((s) => s.address.toLowerCase()));
    const personal: RecipientSuggestion[] = mine
      .filter((c) => !seen.has(c.address))
      .map((c) => ({ name: c.name ?? c.address, address: c.address, kind: "contact", detail: "내 주소록", title: null }));
    // 공유 결과(최대 12)가 많아도 내 주소록 항목이 잘리지 않게 자리를 먼저 남긴다(요청 9, 2026-11-12).
    return NextResponse.json({ suggestions: [...shared.slice(0, 15 - personal.length), ...personal] });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
