import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  autoLinkTarget, baseKey, buildFacilityIndex, companyDomain, companyKey, contactDedupeKey, formatPhone, isNonCorporateBrn, judgeProfiles, lookupNames, matchFacilities, roadKey, suggestCategory,
  type FacilityRef,
} from "../../scraper/lib/contact-import/rules";
import type { Profile } from "../../scraper/lib/facility-quality/rules";
import { parseAmaranthContacts } from "../lib/contact-import/amaranth-xlsx";
import { normalizeHomepage } from "../lib/sales/business-card-parser";

const facility = (facilityId: string, companyName: string, address: string | null, aliases: string[] = []): FacilityRef => ({ facilityId, companyName, address, aliases });
// 실제 사업자번호를 쓰지 않는다. 검증자리만 맞춘 시험 번호.
const BRN_A = "1234567891";
const BRN_B = "2208162517";
const profile = (over: Partial<Profile> & { name: string; brn?: string; address?: string }): Profile => ({
  source: over.source ?? "fsc", name: over.name, url: "https://example.test", retrievedAt: "2026-11-06T00:00:00Z", scope: "headquarters", homepage: over.homepage,
  values: { business_registration_no: over.brn, site_address: over.address },
});

test("회사 키는 법인격·표기 차이를 무시한다", () => {
  for (const name of ["(주)알룩스", "㈜알룩스", "주식회사 알룩스", "알룩스 주식회사", "(주) 알룩스", "알룩스 Co., Ltd."]) assert.equal(companyKey(name), "알룩스", name);
  assert.equal(companyKey("무림P&P(주)"), "무림pp");
  assert.equal(baseKey(companyKey("영풍전자㈜ 2공장")), "영풍전자");
  assert.equal(baseKey(companyKey("현대제철㈜ 포항1공장")), "현대제철포항");
});

test("기존 사업장 대조 — 실측에서 나온 경우", () => {
  const index = buildFacilityIndex([
    facility("a", "㈜알룩스", "경기도 안산시 단원구 해봉로 1"),
    facility("b1", "영풍전자㈜ 1공장", "경기도 화성시 양감면 정문송산로 1"),
    facility("b2", "영풍전자㈜ 2공장", "경기도 화성시 양감면 정문송산로 2"),
    facility("c", "경기환경에너지㈜", "경기도 수원시 팔달구 효원로 1"),
    facility("d", "한국환경공단", "인천광역시 서구 환경로 42"),
    facility("e", "에스케이에너지㈜", "울산광역시 남구 고사동 1", ["SK에너지"]),
  ]);
  const same = matchFacilities("(주) 알룩스", "경기 안산시 단원구 해봉로 1", index);
  assert.deepEqual(same.map((c) => [c.facilityId, c.kind]), [["a", "name_region"]]);
  assert.equal(autoLinkTarget(same), "a");

  const elsewhere = matchFacilities("알룩스", "서울특별시 강남구 테헤란로 1", index);
  assert.equal(elsewhere[0].kind, "name");
  assert.equal(autoLinkTarget(elsewhere), null, "지역이 다르면 본사·공장 차이일 수 있어 자동 연결하지 않는다");

  const twoSites = matchFacilities("영풍전자", "경기도 화성시 양감면 정문송산로 1", index);
  assert.equal(twoSites.length, 2);
  assert.equal(autoLinkTarget(twoSites), null, "공장이 둘이면 사람이 고른다");

  const prefix = matchFacilities("경기환경에너지진흥원", "경기도 수원시 팔달구 다른로 9", index);
  assert.equal(prefix[0].kind, "prefix_region");
  assert.equal(autoLinkTarget(prefix), null, "이름 앞부분만 맞으면 다른 기관일 수 있다");

  const building = matchFacilities("국립환경인재개발원", "인천광역시 서구 환경로 42", index);
  assert.deepEqual(building.map((c) => [c.facilityId, c.kind]), [["d", "address"]]);
  assert.equal(autoLinkTarget(building), null, "주소만 같으면 같은 건물의 다른 기관일 수 있다");

  assert.equal(matchFacilities("SK에너지", "울산광역시 남구 고사동 1", index)[0].facilityId, "e", "별칭으로 찾는다");
  assert.deepEqual(matchFacilities("없는회사", "부산광역시 중구 중앙대로 1", index), []);
});

test("사업자번호 판정", () => {
  const company = { name: "(주)테스트산업", address: "경기도 안산시 단원구 해봉로 1", homepage: "www.test-ind.co.kr", emailDomain: "other.co.kr" };
  const inRegion = judgeProfiles(company, [profile({ name: "㈜테스트산업", brn: BRN_A, address: "경기도 안산시 단원구 해봉로 200" })]);
  assert.equal(inRegion.verdict, "recommend");
  assert.equal(inRegion.brn, BRN_A);

  const byDomain = judgeProfiles(company, [profile({ name: "테스트산업", brn: BRN_A, address: "서울특별시 중구 세종대로 1", homepage: "http://test-ind.co.kr/" })]);
  assert.equal(byDomain.verdict, "recommend", "지역이 달라도 홈페이지 도메인이 같으면 같은 회사다");

  const nameOnly = judgeProfiles(company, [profile({ name: "테스트산업", brn: BRN_A, address: "서울특별시 중구 세종대로 1" })]);
  assert.equal(nameOnly.verdict, "review", "이름만 같으면 추천하지 않는다");
  assert.equal(nameOnly.brn, BRN_A);

  const twoNumbers = judgeProfiles(company, [
    profile({ name: "테스트산업", brn: BRN_A, address: "경기도 안산시 단원구 해봉로 1" }),
    profile({ source: "bizno", name: "테스트산업", brn: BRN_B, address: "경기도 안산시 단원구 해봉로 2" }),
  ]);
  assert.equal(twoNumbers.verdict, "review");
  assert.equal(twoNumbers.brn, null);

  assert.equal(judgeProfiles(company, [profile({ name: "전혀다른회사", brn: BRN_A })]).verdict, "not_found", "이름이 다른 결과는 버린다");
  assert.equal(judgeProfiles(company, [profile({ name: "테스트산업", brn: "1234567890" })]).verdict, "review", "검증자리가 틀린 번호는 번호로 치지 않는다");
  assert.equal(judgeProfiles(company, []).verdict, "not_found");
});

test("외부 조회 이름 변형", () => {
  for (const [name, expected] of [
    // 실제 명단에 있던 모양. 등기명으로 읽거나 병기된 한글을 뗀다.
    ["LG이노텍", "엘지이노텍"], ["SK하이닉스", "에스케이하이닉스"], ["PI첨단소재", "피아이첨단소재"], ["주식회사 KCC", "케이씨씨"],
    ["쌍용C&E", "쌍용씨앤이"], ["DL E&C", "디엘이앤씨"], ["LS MnM Inc.", "엘에스엠앤엠"], ["상원 EnC", "상원이앤씨"], ["GMB Korea Corp.", "지엠비코리아"],
    ["SAMSUNG DISPLAY 삼성 디스플레이", "삼성디스플레이"], ["KEIA 한국환경산업협회", "한국환경산업협회"], ["경인양행 KISCO 인천사업장", "경인양행"],
    ["AKC Co., Ltd.(주식회사 에이케이씨)", "에이케이씨"], ["청해ENV(주)/청해환경", "청해환경"], ["성산하이텍(성산정밀)", "성산정밀"],
    ["SCHMID Group/슈미드코리아(주)", "슈미드코리아"], ["KOBI ASSET(코비에셋)", "코비에셋"],
  ] as const) {
    const names = lookupNames(name);
    assert.equal(names[0], name, "표시 이름을 먼저 조회한다");
    assert.ok(names.includes(expected), `${name} → ${names.join(", ")}`);
    assert.ok(names.length <= 3, `${name} 조회 수 제한`);
  }
  assert.deepEqual(lookupNames("태양금속공업(주)"), ["태양금속공업(주)"], "한글 이름은 변형 없이 한 번만 조회한다");
  assert.deepEqual(lookupNames("주식회사 심텍"), ["주식회사 심텍"]);
  assert.ok(!lookupNames("풍산 FNS").includes("풍산"), "두 글자 토막은 다른 회사와 겹치므로 이름으로 쓰지 않는다");
  assert.ok(!lookupNames("(주)대우C&M").includes("대우"), "붙어 있는 이름은 쪼개지 않는다");
  assert.ok(!lookupNames("NANO 상주공장").includes("상주공장"), "공장 이름만으로는 찾지 않는다");
});

test("변형 이름의 판정", () => {
  const company = { name: "LG이노텍", address: "서울특별시 강서구 마곡중앙10로 30", homepage: null, emailDomain: "lginnotek.com" };
  const legal = judgeProfiles(company, [profile({ name: "엘지이노텍(주)", brn: BRN_A, address: "서울특별시 강서구 마곡중앙10로 30" })]);
  assert.equal(legal.verdict, "recommend", "등기명으로 읽은 이름은 같은 이름이다");
  assert.equal(judgeProfiles(company, [profile({ name: "엘지이노텍(주)", brn: BRN_A, address: "경상북도 구미시 수출대로 1" })]).verdict, "review", "지역·도메인이 안 맞으면 변형 이름도 추천하지 않는다");
  assert.equal(judgeProfiles(company, [profile({ name: "엘지화학", brn: BRN_A, address: "서울특별시 강서구 마곡중앙10로 30" })]).verdict, "not_found");
  const many = { name: "트라코월드/(주)월마텍", address: "서울특별시 중구 세종대로 1", homepage: null, emailDomain: null };
  const split = judgeProfiles(many, [
    profile({ name: "트라코월드", brn: BRN_A, address: "서울특별시 중구 세종대로 1" }),
    profile({ name: "월마텍", brn: BRN_B, address: "서울특별시 중구 세종대로 1" }),
  ]);
  assert.equal(split.verdict, "review", "두 회사가 함께 적힌 이름은 번호를 고르지 않는다");
});

test("기관 구분 어림", () => {
  for (const [name, category] of [
    ["KB국민은행", "금융기관"], ["한국환경산업협회", "협회·조합"], ["한국환경공단", "공기업"], ["수도권매립지관리공사", "공기업"],
    ["환경부", "공공기관"], ["환경부 원주지방환경청", "공공기관"], ["금천구청", "공공기관"], ["안동시", "공공기관"], ["경기도의회", "공공기관"],
    ["태양금속공업(주)", "민간기업"], ["주식회사 심텍", "민간기업"],
  ] as const) assert.equal(suggestCategory(name), category, name);
});

test("사업자번호 구분코드 — 기업이 아닌 곳", () => {
  for (const brn of ["123-80-00001", "123-82-00001", "1238300001", "123-89-00001"]) assert.equal(isNonCorporateBrn(brn), true, brn);
  for (const brn of ["123-81-00001", "123-84-00001", "123-85-00001", "123-86-00001", "123-87-00001", "123-88-00001", "123-12-00001", "123-90-00001"]) assert.equal(isNonCorporateBrn(brn), false, brn);
  for (const brn of [null, "", "123-83", "123-83-00001, 123-83-00002"]) assert.equal(isNonCorporateBrn(brn), false, String(brn));
});

test("도메인·전화·중복 키", () => {
  assert.equal(companyDomain("kim@naver.com"), null, "무료 메일은 회사 근거가 아니다");
  assert.equal(companyDomain("kim@iljin.co.kr"), "iljin.co.kr");
  assert.equal(companyDomain("https://www.iljin.co.kr/about"), "iljin.co.kr");
  assert.equal(formatPhone("+82 010-9307-2030"), "010-9307-2030");
  assert.equal(formatPhone("01093072030"), "010-9307-2030");
  assert.equal(formatPhone("0316782611"), "031-678-2611");
  assert.equal(formatPhone("027079603"), "02-707-9603");
  assert.equal(contactDedupeKey("회사", "홍 길동", "010-1234-5678", null), contactDedupeKey("회사", "홍길동", "01012345678", "a@b.c"));
  assert.notEqual(contactDedupeKey("회사", "홍길동", "010-1234-5678", null), contactDedupeKey("회사", "홍길동", "010-9999-5678", null));
  assert.ok(roadKey("경기도 안성시 시청길 25")?.endsWith("시청길|25"));
});

test("명함 홈페이지 정규화", () => {
  assert.equal(normalizeHomepage("http://www.iljinm.co.kr/"), "www.iljinm.co.kr");
  assert.equal(normalizeHomepage("홈페이지: www.anseong.go.kr"), "www.anseong.go.kr");
  assert.equal(normalizeHomepage("Web. example"), null);
  assert.equal(normalizeHomepage("kim@iljin.co.kr"), null, "이메일을 홈페이지로 넣지 않는다");
  assert.equal(normalizeHomepage(null), null);
});

function workbook(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Sheet 1");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const KEYS = ["기본정보", "name", "title", "email0", "phone0", "companyName0", "divisionName0", "rank0", "position0", "회사정보", "compFax0", "businessNum0", "corpNum0", "address0", "homepage0", "추가기본정보", "compNum2", "faxNum1"];
const LABELS = ["유형", "이름", "호칭", "이메일", "휴대전화", "회사명", "부서명", "직급", "직책", "대표전화", "대표팩스", "사업자등록번호", "법인등록번호", "대표주소", "홈페이지", "추가회사번호1", "추가회사번호2", "추가팩스번호1"];

test("아마란스10 내보내기 파일 읽기 — 머리글 2줄", () => {
  const parsed = parseAmaranthContacts(workbook([
    KEYS, LABELS,
    ["개인", "시험사람", null, "KIM@TEST.CO.KR", "010-1111-2222", "(주)시험", "환경팀", "팀장", null, null, null, null, null, "경기도 안산시 단원구 해봉로 1", "http://www.test.co.kr/", "031-111-2222", null, "031-111-3333"],
    // 휴대전화 칸의 유선 번호는 사무실 번호로 옮긴다.
    ["개인", "유선사람", null, null, "02-123-4567", "기관갑", null, null, "과장", null, null, null, null, null, null, null, null, null],
    ["개인", "회사없음", null, null, "010-3333-4444", null, null, null, null, null, null, null, null, null, null, null, null, null],
  ]));
  assert.equal(parsed.totalRows, 3);
  assert.equal(parsed.skippedRows, 1);
  assert.deepEqual(parsed.contacts[0], {
    personName: "시험사람", companyName: "(주)시험", title: "팀장", department: "환경팀", mobilePhone: "010-1111-2222", officePhone: "031-111-2222",
    faxNumber: "031-111-3333", email: "kim@test.co.kr", address: "경기도 안산시 단원구 해봉로 1", homepage: "www.test.co.kr",
  });
  assert.equal(parsed.contacts[1].mobilePhone, null);
  assert.equal(parsed.contacts[1].officePhone, "02-123-4567");
  assert.equal(parsed.contacts[1].title, "과장");
  assert.throws(() => parseAmaranthContacts(workbook([["이름", "전화"], ["가", "1"]])), /아마란스10 연락처 내보내기 파일이 아닙니다/);
});

test("아마란스10 새 내보내기(1행 필드 키 없음) — 2행 한글 이름으로 읽는다", () => {
  // 2026-11-12 내보내기: 1행에는 병합된 묶음 이름만 남고 필드 키 칸이 비어 있다.
  const groupsOnly = KEYS.map((k) => (["기본정보", "회사정보", "추가기본정보"].includes(k) ? k : null));
  const row = ["개인", "시험사람", null, "KIM@TEST.CO.KR", "010-1111-2222", "(주)시험", "환경팀", "팀장", null, null, "031-999-0000", null, null, "경기도 안산시 단원구 해봉로 1", "http://www.test.co.kr/", "031-111-2222", null, null];
  const keyed = parseAmaranthContacts(workbook([KEYS, LABELS, row]));
  const labelled = parseAmaranthContacts(workbook([groupsOnly, LABELS, row]));
  assert.deepEqual(labelled, keyed);
  assert.equal(labelled.contacts[0].faxNumber, "031-999-0000");
  // 묶음 이름까지 없는 다른 엑셀은 한글 이름이 같아도 받지 않는다.
  assert.throws(() => parseAmaranthContacts(workbook([[null], LABELS, row])), /아마란스10 연락처 내보내기 파일이 아닙니다/);
});
