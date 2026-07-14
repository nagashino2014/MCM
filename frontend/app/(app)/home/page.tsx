import { auth } from "@/lib/auth/config";
import { HomeBoard } from "@/components/home/HomeBoard";

export const dynamic = "force-dynamic";

/** 로그인 후 첫 화면(데스크톱). 세션 role 만 서버에서 전달하고, 데이터는 각 위젯이 클라이언트에서 로드한다. */
export default async function HomePage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return <HomeBoard role={role} />;
}
