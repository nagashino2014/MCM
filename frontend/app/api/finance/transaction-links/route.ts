import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { listTransactionLinks, createTransactionLinks, cancelTransactionLinks, type CreateTransactionLinksInput, type CancelTransactionLinksInput } from "@/lib/finance/transaction-links";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function allowed(permission:string):Promise<boolean>{try{await requirePermission(permission);return true;}catch(error){if((error as {status?:number}).status===403)return false;throw error;}}
export async function GET(req:NextRequest){try{await requirePermission('finance.view');const sp=req.nextUrl.searchParams;
  const state=await listTransactionLinks({from:sp.get('from')||undefined,to:sp.get('to')||undefined});
  return NextResponse.json({...state,permissions:{manage:await allowed('finance.manage'),bank:await allowed('recon.confirm')}});
}catch(error){return authErrorToResponse(error);}}
export async function POST(req:NextRequest){try{
  const actor=await requirePermission('finance.manage');const body=await req.json().catch(()=>null);
  if(!body||typeof body!=='object')return NextResponse.json({error:'요청 본문이 올바르지 않습니다.'},{status:400});
  if(body.action==='create'){
    if(Array.isArray(body.links)&&body.links.some((link:{relation?:string;left?:{kind?:string}})=>link?.relation==='bank_invoice'||link?.left?.kind==='bank'))await requirePermission('recon.confirm');
    const input:CreateTransactionLinksInput={requestId:body.requestId,links:body.links};return NextResponse.json(await createTransactionLinks(input,actor.userId));
  }
  if(body.action==='cancel'){
    if(!Array.isArray(body.linkIds)||body.linkIds.some((id:unknown)=>typeof id!=='string')||body.linkIds.length>100)return NextResponse.json({error:'취소 대상이 올바르지 않습니다.'},{status:400});
    const db=await getDb();if(rowsToObjects(await db.exec("SELECT link_id FROM transaction_links WHERE link_id=ANY($1::text[]) AND left_kind='bank' LIMIT 1",[body.linkIds])).length)await requirePermission('recon.confirm');
    const input:CancelTransactionLinksInput={requestId:body.requestId,linkIds:body.linkIds,reason:body.reason};return NextResponse.json(await cancelTransactionLinks(input,actor.userId));
  }
  return NextResponse.json({error:'지원하지 않는 작업입니다.'},{status:400});
}catch(error){return authErrorToResponse(error);}}
