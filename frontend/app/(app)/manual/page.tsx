import { auth } from "@/lib/auth/config";
import { permsOf } from "@/lib/auth/perms";
import { ManualPage } from "@/components/manual/ManualPage";

export const dynamic = "force-dynamic";

export default async function ManualIndexPage() {
  const session = await auth();
  return <ManualPage perms={permsOf(session?.user)} />;
}
