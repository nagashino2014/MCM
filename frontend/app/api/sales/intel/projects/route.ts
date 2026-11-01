import { NextRequest } from "next/server";
import { intelApi, intelBody, intelFilter } from "@/lib/intel/project-intelligence-api";
import { createIntelProject, queryBriefingProjects } from "@/lib/intel/project-intelligence";
import { discoveryExtras } from "@/lib/intel/discovery-overview";
import type { IntelProjectInput } from "@/lib/intel/project-intelligence-types";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(req:NextRequest){return intelApi("sales.view",async actor=>{const result=await queryBriefingProjects(intelFilter(req));return {...result,extras:await discoveryExtras(result.projects.map(p=>p.projectId),actor)};});}
export async function POST(req:NextRequest){return intelApi("sales.edit",async actor=>({project:await createIntelProject(await intelBody<IntelProjectInput>(req),actor)}),201);}
