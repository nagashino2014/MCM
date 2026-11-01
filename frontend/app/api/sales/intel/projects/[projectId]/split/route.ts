import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { splitIntelProject } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest,ctx:{params:Promise<{projectId:string}>}){return intelApi("sales.edit",async actor=>splitIntelProject((await ctx.params).projectId,await intelBody<Parameters<typeof splitIntelProject>[1]>(req),actor));}
