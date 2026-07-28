import { BoardPostBoard } from "@/components/board/BoardPostBoard";

export const dynamic = "force-dynamic";

export default async function BoardPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  return <BoardPostBoard postId={postId} />;
}
