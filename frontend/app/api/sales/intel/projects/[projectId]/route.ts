import { NextRequest } from "next/server";
import { intelApi, intelBody } from "@/lib/intel/project-intelligence-api";
import { getIntelProjectDetail, updateIntelProject } from "@/lib/intel/project-intelligence";
export const runtime="nodejs"; export const dynamic="force-dynamic";
type Context={params:Promise<{projectId:string}>};
export async function GET(_req:NextRequest,ctx:Context){return intelApi("sales.view",async actor=>getIntelProjectDetail((await ctx.params).projectId,actor));}
export async function PATCH(req:NextRequest,ctx:Context){return intelApi("sales.edit",async actor=>({project:await updateIntelProject((await ctx.params).projectId,await intelBody<Parameters<typeof updateIntelProject>[1]>(req),actor)}));}
