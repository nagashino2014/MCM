import { Suspense } from "react";
import { MailComposePage } from "@/components/mail/MailComposePage";

export const dynamic = "force-dynamic";

export default function MailComposeRoute() {
  return (
    <Suspense fallback={null}>
      <MailComposePage />
    </Suspense>
  );
}
