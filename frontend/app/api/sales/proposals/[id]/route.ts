import { proposalApi } from "@/lib/proposal/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = proposalApi.get;
export const PUT = proposalApi.save;
