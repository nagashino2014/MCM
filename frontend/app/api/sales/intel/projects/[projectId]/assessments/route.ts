import { NextRequest } from "next/server";
import { intelApi } from "@/lib/intel/project-intelligence-api";
import { assessIntelProject } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(_req:NextRequest,ctx:{params:Promise<{projectId:string}>}){return intelApi("sales.edit",async actor=>assessIntelProject((await ctx.params).projectId,actor));}
