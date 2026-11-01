import { proposalApi } from "@/lib/proposal/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = proposalApi.list;
export const POST = proposalApi.create;
