// 외부 메일 프로그램(아웃룩 등) IMAP/SMTP 게이트웨이 엔트리 — 상시 ECS 서비스(infra/aws/mail-gateway.tf).
// next 이미지의 node_modules(pg·smtp-server 등)를 쓰고, 소스는 esbuild 단일 번들(.next/mail-gateway.cjs).
// 실행: node .next/mail-gateway.cjs  (DB(PG*)·MCM_STORAGE_BUCKET·MAIL_INBOUND_BUCKET·AWS_REGION 은 next task def env 와 같다)
// 로컬 확인: MAIL_GW_PROXY_PROTOCOL=0 으로 띄우고 평문 1143(IMAP)·1465(SMTP)에 붙는다. 설계: docs/mail-external-client-plan.md
import { PgGatewayStore } from "@/lib/mail/gateway/pg-store";
import { gwLog, startGateway } from "@/lib/mail/gateway/server";

async function main() {
  const stop = await startGateway(new PgGatewayStore());
  const shutdown = (signal: string) => {
    gwLog("gateway.stopping", { signal });
    // IMAP 연결은 오래 붙어 있어 close 가 끝나길 기다리지 않는다 — 새 연결만 막고 잠시 뒤 종료(클라이언트가 재접속).
    void stop();
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[mail-gateway] 시작 실패:", err);
  process.exit(1);
});
