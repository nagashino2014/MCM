import { Suspense } from "react";
import { BoardWriteBoard } from "@/components/board/BoardWriteBoard";

export const dynamic = "force-dynamic";

export default function BoardWritePage() {
  return (
    <Suspense fallback={null}>
      <BoardWriteBoard />
    </Suspense>
  );
}
