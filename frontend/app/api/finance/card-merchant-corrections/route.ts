import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getCardMerchantCorrection, changeCardMerchantCorrection } from "@/lib/finance/card-merchant-corrections";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    let manage = true;
    try { await requirePermission("finance.manage"); } catch(error) {if((error as {status?:number}).status===403)manage=false;else throw error;}
    return NextResponse.json({...await getCardMerchantCorrection(req.nextUrl.searchParams.get("cardTxnId") || ""),permissions:{manage}},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {return authErrorToResponse(error);}
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    return NextResponse.json(await changeCardMerchantCorrection(await req.json().catch(()=>null),actor.userId));
  } catch(error) {return authErrorToResponse(error);}
}
