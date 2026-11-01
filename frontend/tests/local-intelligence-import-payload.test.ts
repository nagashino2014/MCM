import assert from "node:assert/strict";
import { test } from "node:test";
import { explicitImportedSourceIds, importedPublicRaw, importedSignalFingerprint, importedSignalRaw, mergeImportedSourceRows } from "../scripts/local-intelligence-import-payload";
import { createNewsContentQuality, isNewsContentQualityAccepted, newsInputHash } from "../lib/intel/news-content-quality";

const signal = () => ({ signal_id: "source-1", source: "news", report_name: "검증 기업의 공장 증설", summary: "분류 요약", channel: "naver", created_at: "2026-10-01", updated_at: "2026-10-01", public_raw: {
  description: "검증 기업이 공장 증설 계획을 발표했다.", originalLink: "https://example.test/article", apiKey: "fixture-secret", cookies: "fixture-cookie",
  classification: { isSignal: true, companyName: "검증 기업", summary: "분류 요약", privatePrompt: "fixture-internal" },
} });
test("명시한 기존 원본만 추가로 동기화하며 최근 선택 목록과 ID별 제목·본문 짝을 유지한다", () => {
  const known = new Set(["current", "outside-limit"]);
  assert.deepEqual(explicitImportedSourceIds(undefined,known),[]);
  assert.deepEqual(explicitImportedSourceIds(["outside-limit","outside-limit"],known),["outside-limit"]);
  assert.throws(()=>explicitImportedSourceIds(["unimported"],known));assert.throws(()=>explicitImportedSourceIds(Array(201).fill("current"),known));
  const current={signal_id:"current",report_name:"현재 제목",summary:"현재 본문"}, other={signal_id:"outside-limit",report_name:"과거 제목",summary:"과거 본문"};
  assert.deepEqual(mergeImportedSourceRows([current],[current,other]),[current,other]);
  assert.deepEqual(mergeImportedSourceRows([current],[]),[current]);
});
test("기사 발췌·원문 링크·분류만 가져오고 원본 변경을 fingerprint에 반영한다", () => {
  const row = signal(), before = JSON.stringify(row), raw = importedPublicRaw(row);
  assert.deepEqual(Object.keys(raw).sort(), ["channel", "classification", "description", "originalLink"]);
  assert.deepEqual(raw.classification, { isSignal: true, companyName: "검증 기업", summary: "분류 요약" });
  assert.equal(JSON.stringify(raw).includes("fixture-"), false);
  const digest = importedSignalFingerprint(row);
  assert.equal(importedSignalFingerprint({ ...row, created_at: "changed", updated_at: "changed" }), digest);
  for (const next of [
    { ...row, report_name: "변경된 제목" },
    { ...row, public_raw: { ...row.public_raw, description: "변경된 원문 발췌" } },
    { ...row, public_raw: { ...row.public_raw, originalLink: "https://example.test/revised" } },
    { ...row, public_raw: { ...row.public_raw, classification: { ...row.public_raw.classification, summary: "수정된 분류" } } },
  ]) assert.notEqual(importedSignalFingerprint(next), digest);
  assert.equal(JSON.stringify(row), before);
});

test("로컬 정정 후 원본 변경은 검증대기로 돌아가고 새 검증판정은 보존한다", () => {
  const row = signal();
  const accepted = createNewsContentQuality({ title: row.report_name, description: row.public_raw.description, decision: "accepted", titleRelation: "main", evidenceQuotes: [row.public_raw.description], reason: "원문 투자 발표 확인" });
  const previous = { classification: { ...row.public_raw.classification, contentQuality: accepted } };
  const raw = importedSignalRaw(row, "source-1", "import-2", previous);
  assert.equal(isNewsContentQualityAccepted(raw), false);
  assert.equal((raw.classification as any).contentQuality.decision, "needs_review");
  assert.deepEqual(raw.localImport, { sourceSignalId: "source-1", importId: "import-2" });
  assert.equal(isNewsContentQualityAccepted(importedSignalRaw(row, "source-1", "import-1")), true, "품질표기 없는 과거 자료 전체를 임의 제외하지 않는다");
  const validated = { ...row, public_raw: { ...row.public_raw, classification: { ...row.public_raw.classification, contentQuality: accepted } } };
  assert.equal(isNewsContentQualityAccepted(importedSignalRaw(validated, "source-1", "import-3", previous)), true);
  assert.equal(isNewsContentQualityAccepted(importedSignalRaw({ ...validated, report_name: "서로 다른 기사 제목" }, "source-1", "import-4", previous)), false, "과거 입력 해시에 대한 accepted를 변경된 원문에 재사용하지 않는다");
  assert.notEqual(importedSignalFingerprint(validated), importedSignalFingerprint(row), "품질 판정 자체도 원본 변경이다");
});

test("press 공개 본문만 동기화하며 뉴스 fingerprint와 비공개 필드는 보존 범위에서 제외한다", () => {
  const news=signal();
  assert.equal(importedSignalFingerprint({...news,public_raw:{...news.public_raw,body:null}}),importedSignalFingerprint(news));
  assert.equal(importedSignalFingerprint({...news,public_raw:{...news.public_raw,body:'뉴스용 미허용 본문'}}),importedSignalFingerprint(news));
  assert.equal(Object.hasOwn(importedPublicRaw({...news,public_raw:{...news.public_raw,body:'뉴스용 미허용 본문'}}),'body'),false);
  const press={...news,source:'press',public_raw:{body:'지자체가 공장 증설의 환경 검토 현황을 발표했다.',dept:'공개기관',privateMemo:'fixture-private',classification:{isSignal:true,privatePrompt:'fixture-internal'}}};
  const raw=importedPublicRaw(press);assert.equal(raw.body,press.public_raw.body);assert.equal(JSON.stringify(raw).includes('fixture-'),false);assert.equal(Object.hasOwn(raw,'dept'),false);
  assert.notEqual(importedSignalFingerprint({...press,public_raw:{...press.public_raw,body:'정정된 보도자료 본문'}}),importedSignalFingerprint(press));
});

test("press 정정 후 원문 변경은 full_text 해시로 보류하고 검증 완료 본문만 유지한다", () => {
  const row={...signal(),source:'press',public_raw:{body:'검증기업이 공장 증설을 발표했다.',classification:{isSignal:true}}};
  const accepted=createNewsContentQuality({title:row.report_name,description:row.public_raw.body,inputKind:'full_text',decision:'accepted',titleRelation:'main',evidenceQuotes:[row.public_raw.body],reason:'공개 본문 확인'});
  const previous={classification:{contentQuality:accepted}};
  const changed=importedSignalRaw(row,'press-source','import-press',previous);
  const quality=(changed.classification as any).contentQuality;
  assert.equal(quality.decision,'needs_review');assert.equal(quality.inputKind,'full_text');assert.equal(quality.inputHash,newsInputHash(row.report_name,row.public_raw.body,'full_text'));
  assert.equal(changed.body,row.public_raw.body);assert.deepEqual(changed.localImport,{sourceSignalId:'press-source',importId:'import-press'});
  const valid={...row,public_raw:{...row.public_raw,classification:{isSignal:true,contentQuality:accepted}}};
  assert.equal(isNewsContentQualityAccepted(importedSignalRaw(valid,'press-source','import-press',previous)),true);
  assert.equal(isNewsContentQualityAccepted(importedSignalRaw({...valid,public_raw:{...valid.public_raw,body:'다른 사업 주체의 정정 본문'}},'press-source','import-press',previous)),false);
});

test("명시적으로 검증한 press 목록 발췌는 inputKind 해시를 보존하여 불필요 보류하지 않는다", () => {
  const row={...signal(),source:'press',public_raw:{body:'기업이 공장 증설을 발표했다는 공개 목록 발췌'}};
  const quality=createNewsContentQuality({title:row.report_name,description:row.public_raw.body,inputKind:'search_excerpt',decision:'accepted',titleRelation:'main',evidenceQuotes:[row.public_raw.body],reason:'목록 발췌 범위의 발표 확인'});
  const incoming={...row,public_raw:{...row.public_raw,classification:{isSignal:true,contentQuality:quality}}};
  const raw=importedSignalRaw(incoming,'press-excerpt','import-press');
  assert.equal(isNewsContentQualityAccepted(raw),true);assert.deepEqual((raw.classification as any).contentQuality,quality);
  const changed=importedSignalRaw({...incoming,public_raw:{...incoming.public_raw,body:'다른 내용의 목록 발췌'}},'press-excerpt','import-press');
  assert.equal(isNewsContentQualityAccepted(changed),false);assert.equal((changed.classification as any).contentQuality.inputKind,'search_excerpt');
});
