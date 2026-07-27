import { Suspense } from "react";
import { MailBoard } from "@/components/mail/MailBoard";

export const dynamic = "force-dynamic";

export default function MailPage() {
  return (
    <Suspense fallback={null}>
      <MailBoard />
    </Suspense>
  );
}
