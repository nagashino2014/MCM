/**
 * 폼 실측 — 로그인된 브라우저에서 사용자가 신고 화면까지 이동한 뒤 Enter 를 누르면
 * 그 화면(iframe 포함)의 입력 요소를 라벨과 함께 덤프한다. 결과로 config.json 의 `fill` 셀렉터 매핑을 채운다.
 */
import fs from "node:fs";
import path from "node:path";
import { Frame } from "playwright";
import { FilingSite, SiteConfig, siteDir } from "./config";
import { promptLine } from "./mcm-api";
import { openContext } from "./session";

interface ProbedField {
  frame: string;
  tag: string;
  type: string;
  id: string;
  name: string;
  selector: string;
  label: string;
  value: string;
  options?: string[];
}

async function dumpFrame(frame: Frame): Promise<ProbedField[]> {
  const rows = await frame
    .evaluate(() => {
      const out: Omit<ProbedField, "frame">[] = [];
      const cssEsc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/([^\w-])/g, "\\$1"));
      const labelOf = (el: Element): string => {
        const id = (el as HTMLElement).id;
        if (id) {
          const lb = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
          if (lb?.textContent?.trim()) return lb.textContent.trim();
        }
        const aria = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder");
        if (aria) return aria.trim();
        const td = el.closest("td");
        const th = td?.previousElementSibling;
        if (th && (th.tagName === "TH" || th.tagName === "TD") && th.textContent?.trim()) return th.textContent.trim().slice(0, 40);
        const wrap = el.closest("label");
        if (wrap?.textContent?.trim()) return wrap.textContent.trim().slice(0, 40);
        return "";
      };
      const nodes = Array.from(document.querySelectorAll("input, select, textarea")) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[];
      nodes.forEach((el, i) => {
        const type = (el as HTMLInputElement).type || el.tagName.toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button" || type === "image") return;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const selector = el.id
          ? `#${cssEsc(el.id)}`
          : el.name
            ? `${el.tagName.toLowerCase()}[name="${el.name}"]`
            : `${el.tagName.toLowerCase()}:nth-of-type(${i + 1})`;
        out.push({
          tag: el.tagName.toLowerCase(),
          type,
          id: el.id,
          name: el.name,
          selector,
          label: labelOf(el),
          value: el.tagName === "SELECT" ? (el as HTMLSelectElement).selectedOptions[0]?.text ?? "" : String(el.value ?? "").slice(0, 60),
          options: el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).slice(0, 30) : undefined,
        });
      });
      return out;
    })
    .catch(() => [] as Omit<ProbedField, "frame">[]);
  const name = frame.parentFrame() ? frame.name() || frame.url() : "(main)";
  return rows.map((r) => ({ frame: name, ...r }));
}

export async function runProbe(site: FilingSite, cfg: SiteConfig, url?: string): Promise<string> {
  const { context } = await openContext(site);
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(url || cfg.checkUrl, { waitUntil: "domcontentloaded" });
    console.log(`[${site}] 브라우저에서 실측할 신고 화면(입력 폼이 보이는 상태)까지 이동한 뒤 이 터미널에서 Enter 를 누르세요.`);
    await promptLine("");
    const target = context.pages().filter((p) => !p.isClosed()).pop() ?? page;
    const fields: ProbedField[] = [];
    for (const fr of target.frames()) fields.push(...(await dumpFrame(fr)));
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(siteDir(site), `probe-${stamp}.json`);
    fs.writeFileSync(file, JSON.stringify({ url: target.url(), title: await target.title(), fields }, null, 2), "utf-8");
    console.log(`[${site}] ${target.url()}`);
    console.log(`[${site}] 입력 요소 ${fields.length}개:`);
    for (const f of fields) {
      console.log(`  ${f.frame !== "(main)" ? `[${f.frame}] ` : ""}${f.tag}/${f.type}  ${f.selector}  ← ${f.label || "(라벨 없음)"}${f.value ? `  = ${f.value}` : ""}`);
    }
    console.log(`[${site}] 저장: ${file}`);
    console.log(`[${site}] 이 목록을 공유하면 config.json 의 fill 매핑(양식 라벨 → 셀렉터)을 채울 수 있습니다.`);
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}
