import { Suspense } from "react";
import { InternalRuleListBoard } from "@/components/rules/InternalRuleListBoard";

export const dynamic = "force-dynamic";

export default function InternalRulesPage() {
  return (
    <Suspense fallback={null}>
      <InternalRuleListBoard />
    </Suspense>
  );
}
