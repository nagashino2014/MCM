import { RecruitEditorBoard } from "@/components/recruit/RecruitEditorBoard";

export const dynamic = "force-dynamic";

export default async function RecruitEditorPage({ params }: { params: Promise<{ postingId: string }> }) {
  const { postingId } = await params;
  return <RecruitEditorBoard postingId={postingId} />;
}
