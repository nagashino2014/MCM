// 매뉴얼 캡처용 로그인 — 사용자가 직접 로그인한다(자격증명은 스크립트가 다루지 않음). 프로필은 scratchpad 에만 남고 작업 후 지운다.
import { createRequire } from "node:module";
const require = createRequire(new URL("../../scraper/package.json", import.meta.url));
const { chromium } = require("playwright");
const profile = process.argv[2];
const ctx = await chromium.launchPersistentContext(profile, { headless: false, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://koensain.app/login");
const deadline = Date.now() + 15 * 60 * 1000;
let ok = false;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const p = ctx.pages()[0];
    if (!p) break;
    const s = await p.evaluate(() => fetch("/api/auth/session").then((r) => r.json()).catch(() => null));
    if (s && s.user) { ok = true; break; }
  } catch {}
}
console.log(ok ? "LOGIN_OK" : "LOGIN_TIMEOUT");
await ctx.close();
