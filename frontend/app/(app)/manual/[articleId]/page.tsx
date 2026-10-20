import { auth } from "@/lib/auth/config";
import { permsOf } from "@/lib/auth/perms";
import { ManualPage } from "@/components/manual/ManualPage";

export const dynamic = "force-dynamic";

export default async function ManualArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  const session = await auth();
  return <ManualPage perms={permsOf(session?.user)} articleId={decodeURIComponent(articleId)} />;
}
