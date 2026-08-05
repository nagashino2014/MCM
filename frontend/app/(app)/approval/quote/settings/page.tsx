import { Suspense } from "react";
import { QuoteSettingsBoard } from "@/components/approval/QuoteSettingsBoard";

export const dynamic = "force-dynamic";

export default function QuoteSettingsPage() {
  return (
    <Suspense fallback={null}>
      <QuoteSettingsBoard />
    </Suspense>
  );
}
