import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { unlinkIntelProject } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function DELETE(req:NextRequest,ctx:{params:Promise<{projectId:string;linkId:string}>}){return intelApi("sales.edit",async actor=>{const p=await ctx.params;return unlinkIntelProject(p.projectId,p.linkId,await intelBody<Parameters<typeof unlinkIntelProject>[2]>(req),actor);});}
