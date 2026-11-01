import { NextRequest } from "next/server";
import { intelApi } from "@/lib/intel/project-intelligence-api";
import { intelOverview } from "@/lib/intel/discovery-overview";
export const runtime="nodejs"; export const dynamic="force-dynamic";
/** RAG & 영업 발굴 개요 — 중요 변화·내 후속 활동·우선 검토 상위. */
export async function GET(req:NextRequest){return intelApi("sales.view",actor=>intelOverview(actor,{days:Number(req.nextUrl.searchParams.get("days")??14)}));}
