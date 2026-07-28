import { Suspense } from "react";
import { BoardListBoard } from "@/components/board/BoardListBoard";

export const dynamic = "force-dynamic";

export default function BoardPage() {
  return (
    <Suspense fallback={null}>
      <BoardListBoard />
    </Suspense>
  );
}
