#!/usr/bin/env npx ts-node
/**
 * 대외 신고 보조 CLI — MCM 신고 대기열(/contracts/filings)의 건을 통합환경허가시스템(IEPS)·
 * 엔지니어링종합정보시스템(ETIS)에 반자동으로 입력한다. 담당자 PC 에서 실행한다(로컬 전용).
 *
 * 사용법:
 *   npm run filings -- mcm-login [--base https://mcm.example]   MCM 계정으로 토큰 발급(비밀번호 저장 안 함)
 *   npm run filings -- list [--kind ieps_staff]                  대기 건 목록
 *   npm run filings -- login --site ieps|etis                    사이트 로그인(사람이 문자인증/인증서) → 세션 저장
 *   npm run filings -- check --site ieps|etis                    저장된 세션이 살아 있는지 확인
 *   npm run filings -- open --kind ieps_staff|ieps_agency|etis_career   신고 화면 열고 패널로 순차 입력
 *   npm run filings -- open --id <filingId>                      한 건만
 *   npm run filings -- probe --site ieps [--url <화면 URL>]       신고 화면의 입력 요소 덤프(자동 채우기 셀렉터 확보)
 *   npm run filings -- done <filingId> [--receipt <접수번호>] [--date YYYY-MM-DD]   제출 완료 표시(패널 없이)
 *   npm run filings -- config                                    설정 파일 경로·현재 값
 *   npm run filings -- handle-url "mcm-filings://open?id=<filingId>"   앱의 [신고 보조 열기] 링크 처리(설치 패키지가 등록)
 *   npm run filings -- version                                   도구 버전
 *
 * 권장 순서: mcm-login → login --site ieps → check → open --kind ieps_staff → (제출 후 패널의 [제출 완료])
 *
 * 주의
 * - 두 사이트 모두 무인 자동 제출은 하지 않는다(문자인증·공동인증서, 오제출 방지). 제출 버튼은 사람이 누른다.
 * - 산출물(브라우저 프로필·쿠키·MCM refresh 토큰)은 `data/filings/` 아래(git 제외). 외부 공유 금지.
 * - IEPS 세션은 약 1시간 — 만료되면 `login --site ieps` 를 다시 실행한다.
 */
import { runAssist } from "../lib/filings/assist";
import { DEFAULT_CONFIG, FILINGS_DIR, FilingKind, FilingSite, IS_REPO_MODE, KIND_LABEL, KIND_SITE, configFile, ensureConfigFile, loadConfig } from "../lib/filings/config";
import { authFile, getFiling, hasMcmAuth, listPendingFilings, markFiling, mcmBaseUrl, mcmLogin, promptLine, promptSecret } from "../lib/filings/mcm-api";
import { runProbe } from "../lib/filings/probe";
import { checkSession, hasSession, interactiveLogin } from "../lib/filings/session";

interface Args {
  command: string;
  positional: string[];
  site?: FilingSite;
  kind?: FilingKind;
  id?: string;
  base?: string;
  url?: string;
  receipt?: string;
  date?: string;
}

const KINDS: FilingKind[] = ["ieps_staff", "ieps_agency", "etis_career"];
const SITES: FilingSite[] = ["ieps", "etis"];

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const opt: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "";
      opt[key] = val;
    } else positional.push(rest[i]);
  }
  const site = opt.site as FilingSite | undefined;
  const kind = opt.kind as FilingKind | undefined;
  if (site && !SITES.includes(site)) throw new Error(`--site 는 ${SITES.join("|")} 중 하나입니다.`);
  if (kind && !KINDS.includes(kind)) throw new Error(`--kind 는 ${KINDS.join("|")} 중 하나입니다.`);
  return { command: command || "", positional, site, kind, id: opt.id, base: opt.base, url: opt.url, receipt: opt.receipt, date: opt.date };
}

function usage(): void {
  console.log(`사용법:
  npm run filings -- mcm-login [--base <MCM URL>]
  npm run filings -- list [--kind ${KINDS.join("|")}]
  npm run filings -- login --site ${SITES.join("|")}
  npm run filings -- check --site ${SITES.join("|")}
  npm run filings -- open --kind <종류> | --id <filingId>
  npm run filings -- probe --site <사이트> [--url <URL>]
  npm run filings -- done <filingId> [--receipt <접수번호>] [--date YYYY-MM-DD]
  npm run filings -- config
  npm run filings -- handle-url "mcm-filings://open?id=<filingId>"
  npm run filings -- version`);
}

/** 빌드 스크립트가 버전을 넣는다(저장소 실행은 dev) */
declare const __FILINGS_VERSION__: string | undefined;
const FILINGS_VERSION = typeof __FILINGS_VERSION__ === "string" ? __FILINGS_VERSION__ : "dev";

/**
 * mcm-filings:// 링크 해석 — 웹 페이지가 넘긴 문자열이므로 모양을 엄격히 검사한다.
 * 허용: mcm-filings://open?id=rf-… | mcm-filings://open?kind=ieps_agency
 */
function parseFilingsLink(raw: string): { id: string | null; kind: FilingKind | null } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error(`신고 보조 링크를 읽지 못했습니다: ${raw.slice(0, 80)}`);
  }
  const action = (u.hostname || u.pathname.replace(/^\/+/, "")).replace(/\/+$/, "");
  if (u.protocol !== "mcm-filings:" || action !== "open") throw new Error("지원하지 않는 신고 보조 링크입니다.");
  const id = u.searchParams.get("id");
  const kind = u.searchParams.get("kind");
  if (id && !/^rf-[a-z0-9]{6,40}$/i.test(id)) throw new Error("신고 항목 번호가 올바르지 않습니다.");
  if (kind && !KINDS.includes(kind as FilingKind)) throw new Error("신고 종류가 올바르지 않습니다.");
  if (!id && !kind) throw new Error("열 신고 항목이 없습니다.");
  return { id: id ?? null, kind: (kind as FilingKind | null) ?? null };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  switch (args.command) {
    case "mcm-login": {
      const base = args.base || mcmBaseUrl() || cfg.mcmBaseUrl;
      console.log(`[filings] MCM: ${base}`);
      const identifier = await promptLine("사번 또는 이메일: ");
      const password = await promptSecret("비밀번호: ");
      const auth = await mcmLogin(base, identifier, password);
      console.log(`[filings] 로그인 성공: ${auth.user?.name ?? identifier} — 토큰 저장 ${authFile()} (refresh 30일)`);
      return;
    }
    case "list": {
      const rows = await listPendingFilings(args.kind);
      if (rows.length === 0) {
        console.log("[filings] 대기 건이 없습니다.");
        return;
      }
      for (const r of rows) {
        const due = r.daysLeft == null ? "기한 없음" : r.daysLeft < 0 ? `${-r.daysLeft}일 초과` : `D-${r.daysLeft}`;
        console.log(`  ${r.filingId}  [${KIND_LABEL[r.filingKind]}] ${r.title}  ${r.subtitle ? `· ${r.subtitle} ` : ""}(${r.occurredOn}, ${due})`);
      }
      console.log(`[filings] 총 ${rows.length}건`);
      return;
    }
    case "login": {
      if (!args.site) throw new Error("--site 가 필요합니다.");
      const ok = await interactiveLogin(args.site, cfg.sites[args.site]);
      console.log(`[${args.site}] ${ok ? "✅ 세션 저장" : "⚠ 로그인이 끝나지 않은 것 같습니다 — 다시 실행하세요"}`);
      return;
    }
    case "check": {
      if (!args.site) throw new Error("--site 가 필요합니다.");
      if (!hasSession(args.site)) {
        console.log(`[${args.site}] 세션이 없습니다. 먼저 login 을 실행하세요.`);
        return;
      }
      const ok = await checkSession(args.site, cfg.sites[args.site]);
      console.log(`[${args.site}] 세션 ${ok ? "✅ 유효" : "❌ 만료 — login 을 다시 실행하세요"}`);
      return;
    }
    case "open": {
      if (!hasMcmAuth()) throw new Error("먼저 'mcm-login' 으로 MCM 에 로그인하세요.");
      await runAssist({ cfg, kind: args.kind, filingId: args.id });
      return;
    }
    case "probe": {
      if (!args.site) throw new Error("--site 가 필요합니다.");
      await runProbe(args.site, cfg.sites[args.site], args.url);
      return;
    }
    case "done": {
      const id = args.positional[0] || args.id;
      if (!id) throw new Error("filingId 가 필요합니다.");
      const row = await markFiling(id, { status: "submitted", receiptNo: args.receipt || null, submittedAt: args.date || null });
      console.log(`[filings] ${row.title} → 제출 완료 기록`);
      return;
    }
    case "version": {
      console.log(`MCM 신고 보조 ${FILINGS_VERSION} (${IS_REPO_MODE ? "저장소" : "설치"} 모드 · 데이터 ${FILINGS_DIR})`);
      return;
    }
    case "handle-url": {
      // 앱의 [신고 보조 열기] → mcm-filings:// 링크 → 설치 패키지가 등록한 이 명령. 콘솔 창에서 돈다.
      process.title = "MCM 신고 보조";
      // 사람은 브라우저를 보고 있어 콘솔의 y/n 에 답하지 못한다 — 사이트 확인창은 확인으로 잇는다(session.ts)
      process.env.FILINGS_AUTO_CONFIRM = "1";
      try {
        const link = parseFilingsLink(args.positional[0] ?? "");
        console.log(`[filings] MCM 신고 보조 ${FILINGS_VERSION} — ${link.id ? `신고 항목 ${link.id}` : `${KIND_LABEL[link.kind as FilingKind]} 전체`}`);
        if (!hasMcmAuth()) {
          const base = mcmBaseUrl() || cfg.mcmBaseUrl;
          console.log(`[filings] 처음 사용합니다 — MCM(${base}) 계정으로 로그인하세요(비밀번호는 저장하지 않습니다).`);
          const identifier = await promptLine("사번 또는 이메일: ");
          const password = await promptSecret("비밀번호: ");
          const auth = await mcmLogin(base, identifier, password);
          console.log(`[filings] MCM 로그인: ${auth.user?.name ?? identifier}`);
        }
        const kind: FilingKind = link.kind ?? (await getFiling(link.id as string)).filingKind;
        const site = KIND_SITE[kind];
        const siteCfg = cfg.sites[site];
        const alive = hasSession(site) && (await checkSession(site, siteCfg));
        if (!alive) {
          console.log(`[filings] ${siteCfg.label} 로그인이 필요합니다 — 뜨는 창에서 로그인(문자인증)한 뒤 창을 닫으면 신고 화면이 열립니다.`);
          const ok = await interactiveLogin(site, siteCfg);
          if (!ok) throw new Error("로그인이 끝나지 않았습니다 — 앱에서 [신고 보조 열기] 를 다시 누르세요.");
        }
        await runAssist({ cfg, kind: link.id ? undefined : kind, filingId: link.id ?? undefined });
      } catch (err) {
        console.error(`[filings] 오류: ${err instanceof Error ? err.message : String(err)}`);
        await promptLine("Enter 를 누르면 이 창이 닫힙니다.").catch(() => {});
        process.exit(1);
      }
      return;
    }
    case "config": {
      const file = ensureConfigFile();
      console.log(`[filings] 설정 파일: ${file}`);
      console.log(`[filings] MCM: ${mcmBaseUrl() ?? cfg.mcmBaseUrl} (mcm-auth: ${hasMcmAuth() ? "있음" : "없음"})`);
      for (const s of SITES) console.log(`[filings] ${s}: 세션 ${hasSession(s) ? "있음" : "없음"} · ${cfg.sites[s].loginUrl}`);
      console.log(`[filings] fill 매핑: ${Object.keys(cfg.fill).length ? Object.keys(cfg.fill).join(", ") : "없음(패널 수동 채우기만)"}`);
      console.log(`[filings] 기본값 참고: ${JSON.stringify(DEFAULT_CONFIG.sites.ieps.screens)}`);
      console.log(`[filings] 설정 파일 위치: ${configFile()}`);
      return;
    }
    default:
      usage();
  }
}

main().catch((err) => {
  console.error(`[filings] 오류: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
