import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { resolveActionSuggestion } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function PATCH(req:NextRequest,ctx:{params:Promise<{actionId:string}>}){return intelApi("sales.edit",async actor=>resolveActionSuggestion((await ctx.params).actionId,await intelBody<Parameters<typeof resolveActionSuggestion>[1]>(req),actor));}
