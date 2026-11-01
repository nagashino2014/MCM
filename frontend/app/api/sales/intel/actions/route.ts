import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { createActionSuggestion } from "@/lib/intel/project-intelligence";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest){return intelApi("sales.edit",async actor=>({action:await createActionSuggestion(await intelBody<Parameters<typeof createActionSuggestion>[0]>(req),actor)}),201);}
