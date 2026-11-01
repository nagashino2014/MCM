import { readFile } from "node:fs/promises";

export function localIntelligenceMode(value = process.env.MCM_LOCAL_INTELLIGENCE_MODE) {
  const mode = value?.trim() || "demo";
  if (mode !== "demo" && mode !== "real") throw new Error("로컬 실행 모드는 demo 또는 real이어야 합니다. 예시 모드로 자동 전환하지 않습니다.");
  return mode;
}

export function localIntelligenceSourceUrl(value) {
  let source;
  try { source = new URL(value); } catch { throw new Error("수집 DB 연결 주소 형식을 확인하세요."); }
  if (!["postgres:", "postgresql:"].includes(source.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(source.hostname) || source.port !== "15432" || source.pathname.length < 2 || source.search || source.hash) {
    throw new Error("원본 수집 DB는 인증된 localhost:15432 터널 연결만 지원합니다. 직접 원격 연결은 허용하지 않습니다.");
  }
  if (["/intel_demo", "/intel_live"].includes(source.pathname)) throw new Error("실증 DB 자체를 실제 수집 DB 원본으로 사용할 수 없습니다.");
  return source;
}

// 기존 MCM 설정 중 필요한 항목만 메모리로 읽는다. 비밀값을 파일·콘솔에 복제하지 않는다.
export async function loadLocalIntelligenceEnvironment() {
  const path = process.env.MCM_INTEL_SOURCE_ENV_FILE || "C:/CodingProject/MCM/frontend/.env.local";
  const content = await readFile(path, "utf8");
  const entries = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    entries[match[1]] = value;
  }
  let sourceDatabaseUrl = process.env.MCM_INTEL_SOURCE_DATABASE_URL || entries.DATABASE_URL;
  if (!sourceDatabaseUrl) {
    if (!entries.PGHOST || !entries.PGUSER || !entries.PGDATABASE) throw new Error("기존 MCM 설정에서 수집 DB 접속 정보를 찾을 수 없습니다.");
    const target = new URL("postgresql://localhost");
    target.hostname = entries.PGHOST; target.port = entries.PGPORT || "5432";
    target.username = entries.PGUSER; target.password = entries.PGPASSWORD || ""; target.pathname = `/${entries.PGDATABASE}`;
    sourceDatabaseUrl = target.href;
  }
  localIntelligenceSourceUrl(sourceDatabaseUrl);
  const apiKey = entries.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("실제 AI 호출에 필요한 Anthropic 인증키가 없습니다.");
  return { sourceDatabaseUrl, apiKey, authSecret: entries.AUTH_SECRET || process.env.AUTH_SECRET, sourceSsl: entries.PGSSL === "disable" || entries.PGSSLMODE === "disable" ? "disable" : "require" };
}
