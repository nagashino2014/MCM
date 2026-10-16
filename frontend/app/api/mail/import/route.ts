import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import {
  cancelImportJob,
  createFileImportJob,
  createImapImportJob,
  listImportJobs,
  processImportTick,
  type FolderKind,
} from "@/lib/mail/import/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 가져오기(I-1) — 본인 작업만. 관리자도 남의 메일함으로는 가져올 수 없다(설계 §0).

export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ jobs: await listImportJobs(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 가져오기 작업 생성
//  - 파일: { sourceLabel, inboxPlacement, uploads: [{ key, name, folderKind, folderName }] }
//  - IMAP: { kind: "imap", preset | host·port, user, password, sourceLabel, inboxPlacement, since, folders: [{ path, name, sent }] }
//    비밀번호는 작업 처리 기간에만 암호화 보관하고 끝나면 지운다(설계 §5.3). 응답·로그에 다시 내보내지 않는다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      kind?: string;
      sourceLabel?: string;
      inboxPlacement?: boolean;
      uploads?: { key?: string; name?: string; folderKind?: string; folderName?: string }[];
      preset?: string;
      host?: string;
      port?: number;
      user?: string;
      password?: string;
      since?: string | null;
      folders?: { path: string; name: string; sent: boolean }[];
    };
    const job =
      body.kind === "imap"
        ? await createImapImportJob(ctx.userId, {
            preset: body.preset,
            host: body.host,
            port: typeof body.port === "number" ? body.port : undefined,
            user: body.user,
            password: body.password,
            sourceLabel: body.sourceLabel,
            inboxPlacement: body.inboxPlacement === true,
            since: body.since ?? null,
            folders: Array.isArray(body.folders) ? body.folders : [],
          })
        : await createFileImportJob(ctx.userId, {
            sourceLabel: String(body.sourceLabel ?? ""),
            inboxPlacement: body.inboxPlacement === true,
            uploads: (Array.isArray(body.uploads) ? body.uploads : []).map((u) => ({
              key: String(u.key ?? ""),
              name: String(u.name ?? ""),
              folderKind: (u.folderKind === "sent" || u.folderKind === "custom" ? u.folderKind : "inbox") as FolderKind,
              folderName: String(u.folderName ?? ""),
            })),
          });
    // 1분 틱을 기다리지 않고 바로 처리를 시작한다(응답은 먼저 보냄). running 임대가 있어 틱과 겹쳐도 한 번만 처리되고,
    // 끝나지 못한 분량은 기존 1분 틱이 이어받는다.
    void processImportTick().catch((err) => console.error("[mail-import] immediate tick error", err));
    return NextResponse.json({ job });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?jobId= — 취소(이미 가져온 메일은 남는다).
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
    if (!jobId) return NextResponse.json({ error: "jobId 가 필요합니다." }, { status: 400 });
    await cancelImportJob(ctx.userId, jobId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
