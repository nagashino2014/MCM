import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { listFacilityCandidates,createFacilityCandidate } from "@/lib/intel/project-intelligence";
import { candidateSummaries } from "@/lib/intel/discovery-overview";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:NextRequest){return intelApi("sales.view",async actor=>{const result=await listFacilityCandidates(actor,{status:req.nextUrl.searchParams.get("status")?.trim()||undefined,limit:Number(req.nextUrl.searchParams.get("limit")??50),offset:Number(req.nextUrl.searchParams.get("offset")??0)});return {...result,summaries:await candidateSummaries(result.candidates)};});}
export async function POST(req:NextRequest){return intelApi("sales.edit",async actor=>({candidate:await createFacilityCandidate(await intelBody<Parameters<typeof createFacilityCandidate>[0]>(req),actor)}),201);}
