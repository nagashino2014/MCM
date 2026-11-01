import { NextRequest } from "next/server";
import { intelApi,intelBody } from "@/lib/intel/project-intelligence-api";
import { ingestSignalProjects } from "@/lib/intel/project-intelligence";
import { checkPermission } from "@/lib/auth/rbac";
import { intelError } from "@/lib/intel/project-intelligence-rules";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function POST(req:NextRequest){return intelApi("sales.edit",async actor=>{if(!actor.grants.some(g=>g.permissionKey==="sales.edit"&&g.scopeKind==="all"&&g.effect==="allow")||!checkPermission(actor,"sales.edit"))throw intelError("공용 수집 후보 반영에는 전사 영업 수정 권한이 필요합니다.",403);return ingestSignalProjects(await intelBody<Parameters<typeof ingestSignalProjects>[0]>(req));});}
