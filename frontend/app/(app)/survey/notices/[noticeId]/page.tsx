import { NoticeEditorBoard } from "@/components/survey/NoticeEditorBoard";

export const dynamic = "force-dynamic";

export default async function SurveyNoticeEditPage({ params }: { params: Promise<{ noticeId: string }> }) {
  const { noticeId } = await params;
  return <NoticeEditorBoard noticeId={noticeId} />;
}
