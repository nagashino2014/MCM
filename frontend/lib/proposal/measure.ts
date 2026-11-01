"use client";

// 쪽 하나의 넘침 실측(브라우저 전용) — AI 제안을 얹은 쪽을 숨은 틀에 그려 편집기 미리보기와 같은 식으로 잰다.
// 판정: .pp-flow 높이 > .pp-body 높이 + 1(편집기 Canvas 의 넘침 검사와 같은 식). 계획 §3-7.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalPages, proposalFrameCss } from "@/components/sales/proposal/ProposalPages";
import { frameDocument, type StudioKit } from "@/components/sales/catalog/studio/kit";
import { paletteOf } from "./design";
import { optionsOf, type ProposalDocument } from "./types";

/** 편집기 미리보기와 측정이 같이 쓰는 넘침 판정 */
export function pageOverflows(page: HTMLElement): boolean {
  const body = page.querySelector<HTMLElement>(".pp-body"), flow = page.querySelector<HTMLElement>(".pp-flow");
  return !!body && !!flow && flow.offsetHeight > body.clientHeight + 1;
}

let queue: Promise<unknown> = Promise.resolve();

export function measurePageOverflow(kit: StudioKit, doc: ProposalDocument, sectionId: string): Promise<{ over: boolean; px: number }> {
  const job = queue.then(() => measure(kit, doc, sectionId));
  queue = job.catch(() => undefined);
  return job;
}

async function measure(kit: StudioKit, doc: ProposalDocument, sectionId: string): Promise<{ over: boolean; px: number }> {
  const section = doc.sections.find((s) => s.id === sectionId);
  if (!section) return { over: false, px: 0 };
  // 그 쪽만 — 표지는 쪽 구성상 남지만 목차·간지는 뺀다.
  const single: ProposalDocument = { ...doc, sections: [section], options: { ...optionsOf(doc), toc: false, dividers: false } };
  const html = renderToStaticMarkup(createElement(ProposalPages, { document: single }));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "900px", height: "1400px", border: "0", visibility: "hidden" });
  frame.srcdoc = frameDocument(kit, "pretendard", { extraCss: proposalFrameCss(paletteOf(doc)), body: `<div id="st-root">${html}</div>` });
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => { frame.onload = () => resolve(); setTimeout(() => reject(new Error("넘침 측정 틀을 열지 못했습니다.")), 15000); });
    const fd = frame.contentDocument!;
    await fd.fonts.ready;
    const page = fd.querySelector<HTMLElement>(`article[data-section="${CSS.escape(sectionId)}"]`);
    if (!page) return { over: false, px: 0 };
    const body = page.querySelector<HTMLElement>(".pp-body"), flow = page.querySelector<HTMLElement>(".pp-flow");
    const px = body && flow ? Math.max(0, flow.offsetHeight - body.clientHeight) : 0;
    return { over: pageOverflows(page), px };
  } finally {
    frame.remove();
  }
}
