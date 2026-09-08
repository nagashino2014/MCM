import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readNaverCard, bizno } from "../lib/facility-enrichment/browser";
import type { Snapshot } from "../lib/facility-quality/rules";
test("카드 영역만 추출: 뉴스·관련기업·숨김 항목 제외, 복수 카드는 실패",async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent(`<h2>뉴스</h2><dl><dt>대표자</dt><dd>뉴스속다른사람</dd></dl>
      <section><h2><a>검증회사(주)</a><span>채용중</span></h2><dl><div><dt>대표자</dt><dd>공동대표 A, B</dd></div><div><dt>본사</dt><dd>경기도 파주시 산업단지길 76</dd></div><div hidden><dt>전화</dt><dd>02-000-0000</dd></div></dl><button>기업정보 안내</button><a href="https://search.naver.com/search.naver?pkid=594&amp;os=123">기본정보</a></section>
      <footer><dl><dt>대표자</dt><dd>사이트운영자</dd></dl></footer>`);
    const card=await page.evaluate(readNaverCard);
    assert.equal(card.status,"success");assert.equal(card.name,"검증회사(주)");assert.equal(card.values.representative_name,"공동대표 A, B");assert.equal(card.values.phone_number,undefined);assert.ok(!JSON.stringify(card).includes("사이트운영자"));
    await page.setContent(`<section><h2>회사1</h2><button>기업정보 안내</button></section><section><h2>회사2</h2><button>기업정보 안내</button></section>`);
    assert.equal((await page.evaluate(readNaverCard)).status,"ambiguous");
    await page.setContent(`<h2>뉴스</h2><dl><dt>대표자</dt><dd>다른사람</dd></dl>`);
    assert.equal((await page.evaluate(readNaverCard)).status,"not_found");
  } finally {await browser.close();}
});
test("비즈노: 대표자 값에 접근하지 않고 허용 항목만 반환, 두 주소를 합치지 않음",async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    let calls=0;
    const result=await bizno(browser,{company_name:"검증회사(주)"} as Snapshot,async(page,url)=>{
      calls++;
      if(url.includes("?query=")) await page.setContent(`<a href="https://bizno.net/article/2078100390">검증회사(주)</a>`);
      else {
        await page.setContent(`<h1>검증회사(주)</h1><table><tr><th>대표자명</th><td id="forbidden">금지대표자</td></tr><tr><th>전화번호</th><td>031-123-4567</td></tr><tr><th>사업자등록번호</th><td>207-81-00390</td></tr><tr><th>회사주소</th><td>경기도 파주시 산업단지길 76<br><br>경기도 파주시 문발동 494</td></tr></table>`);
        await page.evaluate(()=>{Object.defineProperty(document.getElementById("forbidden"),"innerText",{get(){throw new Error("대표자 추출 시도");}});});
      }
    });
    assert.equal(calls,2);assert.equal(result.profiles.length,1);assert.equal(result.profiles[0].values.site_address,"경기도 파주시 산업단지길 76");assert.ok(!JSON.stringify(result).includes("금지대표자"));assert.equal(result.profiles[0].values.representative_name,undefined);
  } finally {await browser.close();}
});
