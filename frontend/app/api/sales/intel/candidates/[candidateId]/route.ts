import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { resolveFacilityCandidate } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function PATCH(req:NextRequest,ctx:{params:Promise<{candidateId:string}>}){return intelApi("sales.edit",async actor=>({candidate:await resolveFacilityCandidate((await ctx.params).candidateId,await intelBody<Parameters<typeof resolveFacilityCandidate>[1]>(req),actor)}));}
