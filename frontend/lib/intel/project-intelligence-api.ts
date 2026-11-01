import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { loadProjectIntelligenceActor } from "./project-intelligence";
import { intelError } from "./project-intelligence-rules";
import type { UserAccess } from "@/lib/auth/rbac";
import type { BriefingProjectFilter } from "./project-intelligence-types";

export async function intelApi(permission: "sales.view" | "sales.edit", fn: (actor: UserAccess) => Promise<unknown>, status = 200) {
  try { const ctx = await requirePermission(permission); const actor = await loadProjectIntelligenceActor(ctx.userId); return NextResponse.json(await fn(actor), { status }); }
  catch (error) { return authErrorToResponse(error); }
}
export async function intelBody<T>(request: NextRequest): Promise<T> {
  try { const value = await request.json(); if (!value || Array.isArray(value) || typeof value !== "object") throw intelError("요청 내용을 확인하세요."); return value as T; }
  catch (error) { if (error instanceof SyntaxError) throw intelError("요청 JSON 형식이 올바르지 않습니다."); throw error; }
}
export function intelFilter(req: NextRequest): BriefingProjectFilter {
  const p = req.nextUrl.searchParams; const list = (key: string) => p.get(key)?.split(",").map(v => v.trim()).filter(Boolean);
  const number = (key: string) => { const raw=p.get(key);if(raw==null)return undefined;const value=Number(raw);if(!Number.isFinite(value))throw intelError(`${key} 값을 확인하세요.`);return value; };
  const reviewState=p.get("reviewState")??undefined;if(reviewState&&!['confirmed','needs_review'].includes(reviewState))throw intelError("검토 상태를 확인하세요.");
  return { q:p.get("q")??undefined,reviewState:reviewState as BriefingProjectFilter["reviewState"],sortByPriority:p.get("sortByPriority")!=="false",industries:list("industries"),regions:list("regions"),types:list("types"),companyNames:list("companyNames"),serviceCodes:list("serviceCodes"),amountMin:number("amountMin"),amountMax:number("amountMax"),includeUnknownAmount:p.get("includeUnknownAmount")!=="false",from:p.get("from")??undefined,to:p.get("to")??undefined,limit:number("limit"),offset:number("offset") };
}
