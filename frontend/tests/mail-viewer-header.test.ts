// 메일 읽기 머리(2026-11-12) — 첨부 형식 아이콘 대응표·주소 정리·주소록 이름표 조회.
// DB 시험은 MAIL_VIEWER_TEST_DATABASE_URL(127.0.0.1 의 mail_viewer_test DB)이 있을 때만 돈다.
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "pg";
import { fileExtension, hasFileTypeIcon } from "../components/mail/FileTypeIcon";
import { normalizeMailAddress, resolveMailAddressBook } from "../lib/mail/address-book";
import { getDb, invalidateDb } from "../lib/db";

test("첨부 아이콘 — 자주 주고받는 형식은 전용 아이콘, 그 밖은 기본 파일 아이콘", () => {
  const wanted = ["hwp", "hwpx", "docx", "xlsx", "pptx", "zip", "rar", "egg", "html", "txt", "dwg", "dwf", "pdf", "jpg", "png", "bmp", "ai"];
  for (const ext of wanted) assert.equal(hasFileTypeIcon(`견적서.${ext}`), true, ext);
  assert.equal(hasFileTypeIcon("견적서.PDF"), true, "대문자 확장자");
  assert.equal(hasFileTypeIcon("설치파일.exe"), false);
  assert.equal(hasFileTypeIcon("확장자없음"), false);
  assert.equal(fileExtension("a.b.tar.gz"), "gz");
});

test("주소 정리 — 표시 이름·대소문자를 걷어내고 형식이 아니면 버린다", () => {
  assert.equal(normalizeMailAddress("이재영 <KaiKan00@Koensain.com>"), "kaikan00@koensain.com");
  assert.equal(normalizeMailAddress(" su3458.byun@samsung.com "), "su3458.byun@samsung.com");
  assert.equal(normalizeMailAddress("이름만"), null);
  assert.equal(normalizeMailAddress(null), null);
});

const rawUrl = process.env.MAIL_VIEWER_TEST_DATABASE_URL;
test("독립 PostgreSQL — 임직원(.app·.com·메일함 없음)·외부 담당자·내 메일 주소록 이름표", { skip: !rawUrl && "MAIL_VIEWER_TEST_DATABASE_URL 없음" }, async (t) => {
  const url = new URL(rawUrl!);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "로컬 DB 에서만 돈다");
  assert.equal(url.pathname, "/mail_viewer_test");
  process.env.DATABASE_URL = rawUrl;
  process.env.PGSSL = "disable";
  const client = new Client({ connectionString: rawUrl, ssl: false });
  t.after(async () => {
    await Promise.allSettled([invalidateDb(), client.end()]);
  });
  await client.connect();
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await client.query(`
    CREATE TABLE users (user_id text PRIMARY KEY, email_local text, status text NOT NULL DEFAULT 'active');
    CREATE TABLE departments (dept_id text PRIMARY KEY, dept_name text);
    CREATE TABLE positions (position_id text PRIMARY KEY, position_name text);
    CREATE TABLE employee_profiles (employee_id text PRIMARY KEY, user_id text, name text, dept_id text, position_id text, status text NOT NULL DEFAULT 'active');
    CREATE TABLE mailboxes (mailbox_id text PRIMARY KEY, user_id text, address text, status text DEFAULT 'active');
    CREATE TABLE mail_domains (domain text PRIMARY KEY);
    CREATE TABLE mailbox_addresses (address text PRIMARY KEY, mailbox_id text, domain text, local_part text, is_primary integer DEFAULT 0);
    CREATE TABLE facilities (facility_id text PRIMARY KEY, company_name text);
    CREATE TABLE facility_contact_people (id bigserial PRIMARY KEY, facility_id text, person_name text, title text, email text, status text NOT NULL DEFAULT 'active');
    CREATE TABLE mail_contacts (mailbox_id text, address text, display_name text, PRIMARY KEY (mailbox_id, address));

    INSERT INTO departments VALUES ('d1', '영업관리본부');
    INSERT INTO positions VALUES ('p1', '부장'), ('p2', '사원');
    INSERT INTO users VALUES ('u1', 'kaikan00', 'active'), ('u2', 'newbie', 'active'), ('u3', 'gone', 'inactive');
    INSERT INTO employee_profiles VALUES ('e1', 'u1', '이재영', 'd1', 'p1', 'active'), ('e2', 'u2', '김신입', 'd1', 'p2', 'active'), ('e3', 'u3', '퇴사자', 'd1', 'p2', 'active');
    INSERT INTO mailboxes VALUES ('mb1', 'u1', 'kaikan00@koensain.app', 'active');
    INSERT INTO mail_domains VALUES ('koensain.app'), ('koensain.com');
    INSERT INTO mailbox_addresses VALUES ('kaikan00@koensain.app', 'mb1', 'koensain.app', 'kaikan00', 0), ('kaikan00@koensain.com', 'mb1', 'koensain.com', 'kaikan00', 1);
    INSERT INTO facilities VALUES ('f1', '삼성전기 부산사업장'), ('f2', '옛 업체');
    INSERT INTO facility_contact_people (facility_id, person_name, title, email, status) VALUES
      ('f2', '변옛날', '대리', 'su3458.byun@samsung.com', 'active'),
      ('f1', '변수현', '과장', 'SU3458.BYUN@samsung.com', 'active'),
      ('f1', '그만둔', '차장', 'left@samsung.com', 'inactive');
    INSERT INTO mail_contacts VALUES ('mb1', 'xogjs1123@naver.com', '태헌 씨');
  `);

  const db = await getDb();
  const book = await resolveMailAddressBook(db, "mb1", [
    "이재영 <KaiKan00@koensain.com>",
    "newbie@koensain.com",
    "gone@koensain.app",
    "su3458.byun@samsung.com",
    "left@samsung.com",
    "xogjs1123@naver.com",
    "nobody@example.com",
  ]);
  assert.deepEqual(book["kaikan00@koensain.com"], { name: "이재영", title: "부장", org: "영업관리본부", kind: "employee" });
  assert.deepEqual(book["newbie@koensain.com"], { name: "김신입", title: "사원", org: "영업관리본부", kind: "employee" }, "메일함 없는 직원은 회사 도메인 로컬파트로");
  assert.equal(book["gone@koensain.app"], undefined, "비활성 계정은 빼낸다");
  assert.deepEqual(book["su3458.byun@samsung.com"], { name: "변수현", title: "과장", org: "삼성전기 부산사업장", kind: "contact" }, "같은 주소는 최근 등록분");
  assert.equal(book["left@samsung.com"], undefined, "비활성 담당자는 빼낸다");
  assert.deepEqual(book["xogjs1123@naver.com"], { name: "태헌 씨", title: null, org: null, kind: "personal" });
  assert.equal(book["nobody@example.com"], undefined);

  // 표가 없는 출처는 건너뛰고 나머지는 그대로 돌려준다(메일 상세 조회를 깨지 않는다).
  await client.query("DROP TABLE mail_contacts; DROP TABLE mailbox_addresses");
  const partial = await resolveMailAddressBook(db, "mb1", ["kaikan00@koensain.app", "su3458.byun@samsung.com", "xogjs1123@naver.com"]);
  assert.equal(partial["kaikan00@koensain.app"]?.name, "이재영", "주소 원장이 없어도 회사 도메인 로컬파트로 찾는다");
  assert.equal(partial["su3458.byun@samsung.com"]?.name, "변수현");
  assert.equal(partial["xogjs1123@naver.com"], undefined);
});
