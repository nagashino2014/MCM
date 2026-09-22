import { Suspense } from "react";
import { InternalRuleEditorBoard } from "@/components/rules/InternalRuleEditorBoard";

export const dynamic = "force-dynamic";

export default function InternalRuleEditPage() {
  return (
    <Suspense fallback={null}>
      <InternalRuleEditorBoard />
    </Suspense>
  );
}
