import assert from "node:assert/strict";
import test from "node:test";
import { getDb, invalidateDb, rowsToObjects, withDbWrite } from "../lib/db";
import { decideCompany, ingestContactFile, loadFacilityRefs } from "../lib/contact-import/store";
import type { ImportedContact } from "../lib/contact-import/amaranth-xlsx";
import {
  confirmQuick, getQuickRegistration, listQuickRegistrations, lookupQuickContact, normalizeEmail, quickRegister,
  QuickRegisterConflict, requestPersonDetails, supplementPerson,
} from "../lib/contact-quick/store";
import { openQuickPersonIds } from "../lib/contact-quick/flags";

// 주소록 간이 등록(357)·연락처 가져오기 재업로드(2026-11-12).
// DB 시험은 CONTACT_QUICK_TEST_DATABASE_URL(로컬 일회용 PG, 스테이징 스키마 + 357)이 있을 때만 돈다.

test("메일 주소 정리 — 표시 이름·대소문자를 걷어낸다", () => {
  assert.equal(normalizeEmail("홍길동 <Hong@Example.CO.KR>"), "hong@example.co.kr");
  assert.equal(normalizeEmail(" a.b@c.kr "), "a.b@c.kr");
  assert.equal(normalizeEmail("이름만"), null);
  assert.equal(normalizeEmail("a@b"), null);
});

const url = process.env.CONTACT_QUICK_TEST_DATABASE_URL;

test("일회용 PostgreSQL: 다른 직원 파일 재업로드·간이 등록·상세정보 요청", { skip: !url && "CONTACT_QUICK_TEST_DATABASE_URL 없음" }, async (t) => {
  const parsed = new URL(url!);
  assert(["127.0.0.1", "localhost"].includes(parsed.hostname), "로컬 DB 에서만 돈다");
  Object.assign(process.env, { DATABASE_URL: url, PGSSL: "disable", MAIL_DOMAIN: "koensain.app" });
  delete process.env.MCM_DB_EXPECTED_ROLE;
  delete process.env.MCM_DB_ROLE_REQUIRED;
  t.after(() => invalidateDb());
  const run = Date.now().toString(36);
  const now = new Date().toISOString();
  const ua = `u_qa_${run}`;
  const ub = `u_qb_${run}`;
  const q = async (sql: string, params: unknown[] = []) => rowsToObjects(await (await getDb()).exec(sql, params));
  await withDbWrite(async (db) => {
    for (const [id, name] of [[ua, "직원가"], [ub, "관리자나"]]) {
      await db.run(
        `INSERT INTO users (user_id, email, password_hash, name, role, status, created_at, updated_at) VALUES ($1, $1 || '@example.invalid', 'x', $2, 'member', 'active', $3, $3)`,
        [id, name, now]
      );
      await db.run(`INSERT INTO employee_profiles (employee_id, user_id, name, status, created_at, updated_at) VALUES ($1, $2, $3, 'active', $4, $4)`, [`e_${id}`, id, name, now]);
    }
    await db.run(
      `INSERT INTO facilities (facility_id, company_name, normalized_company_name, source, homepage_url, created_at, updated_at)
       VALUES ($1, '(주)시험알룩스${run}', $2, 'manual', 'https://www.alux${run}.test/', $3, $3)`,
      [`fac_qt_${run}`, `주시험알룩스${run}`, now]
    );
  });
  const facilityId = `fac_qt_${run}`;
  const company = `㈜시험알룩스${run}`;
  const contact = (over: Partial<ImportedContact> & { personName: string }): ImportedContact => ({
    title: null, department: null, companyName: company, mobilePhone: null, officePhone: null, faxNumber: null, email: null, address: null, homepage: null, ...over,
  });

  await t.test("분류된 회사의 새 담당자는 바로 사업장으로, 겹친 사람은 빈 칸만 채운다", async () => {
    const facilities = await loadFacilityRefs(await getDb());
    await withDbWrite((db) => ingestContactFile(db, {
      filename: "a.xlsx", sha256: `a${run}`, userId: ua, facilities,
      file: { totalRows: 2, skippedRows: 0, contacts: [
        contact({ personName: "홍길동", mobilePhone: "010-1111-2222", title: "과장" }),
        contact({ personName: "김철수", mobilePhone: "010-3333-4444" }),
      ] },
    }));
    const [co] = await q(`SELECT company_id FROM contact_import_companies c JOIN contact_import_rows r USING (company_id) JOIN contact_import_batches b USING (batch_id) WHERE b.file_sha256 = $1 LIMIT 1`, [`a${run}`]);
    const decided = await withDbWrite((db) => decideCompany(db, { companyId: String(co.company_id), action: "link", facilityId }, ub));
    assert.equal(decided.status, "ok");
    assert.equal(decided.moved, 2);

    // 다른 직원(ub)의 파일 — 같은 홍길동(이메일 추가), 새 사람 이영희.
    const second = await withDbWrite(async (db) => ingestContactFile(db, {
      filename: "b.xlsx", sha256: `b${run}`, userId: ub, facilities,
      file: { totalRows: 2, skippedRows: 0, contacts: [
        contact({ personName: "홍길동", mobilePhone: "01011112222", email: `hong@alux${run}.test` }),
        contact({ personName: "이영희", email: `lee@alux${run}.test`, title: "대리" }),
      ] },
    }));
    assert.equal(second.newCount, 1);
    assert.equal(second.duplicateCount, 1);
    assert.equal(second.newCompanies, 0);
    const people = await q(`SELECT person_name, title, email FROM facility_contact_people WHERE facility_id = $1 ORDER BY person_name`, [facilityId]);
    assert.deepEqual(people.map((p) => [p.person_name, p.title, p.email]), [
      ["김철수", null, null],
      ["이영희", "대리", `lee@alux${run}.test`],
      ["홍길동", "과장", `hong@alux${run}.test`],
    ]);
    const pending = await q(`SELECT count(*)::int AS n FROM contact_import_rows WHERE company_id = $1 AND status = 'pending'`, [co.company_id]);
    assert.equal(pending[0].n, 0);

    // 관리자가 지운 사람은 다시 올라와도 되살리지 않는다.
    await withDbWrite((db) => db.run(`DELETE FROM facility_contact_people WHERE facility_id = $1 AND person_name = '김철수'`, [facilityId]));
    await withDbWrite((db) => ingestContactFile(db, {
      filename: "c.xlsx", sha256: `c${run}`, userId: ub, facilities,
      file: { totalRows: 1, skippedRows: 0, contacts: [contact({ personName: "김철수", mobilePhone: "010-3333-4444", email: `kim@alux${run}.test` })] },
    }));
    const kim = await q(`SELECT count(*)::int AS n FROM facility_contact_people WHERE facility_id = $1 AND person_name = '김철수'`, [facilityId]);
    assert.equal(kim[0].n, 0);
  });

  let quickPersonId = 0;
  let newFacilityId = "";
  await t.test("메일 주소로 업체 후보를 찾고, 간이 업체·담당자를 만든다", async () => {
    const db = await getDb();
    const look = await lookupQuickContact(db, `박 <Park@ALUX${run}.test>`);
    assert.equal(look.address, `park@alux${run}.test`);
    assert.equal(look.internal, false);
    assert.equal(look.suggestions[0]?.facilityId, facilityId);
    assert.equal(look.existing.length, 0);
    const known = await lookupQuickContact(db, `hong@alux${run}.test`);
    assert.equal(known.existing[0]?.personName, "홍길동");
    assert.equal((await lookupQuickContact(db, "someone@koensain.app")).internal, true);

    // 같은 이름 업체가 있으면 먼저 보여 준다.
    await assert.rejects(
      () => withDbWrite((tx) => quickRegister(tx, { newFacility: { companyName: `시험알룩스${run} 주식회사` }, person: { personName: "박" } }, ua)),
      (err: unknown) => err instanceof QuickRegisterConflict && err.candidates[0]?.facilityId === facilityId
    );
    await assert.rejects(
      () => withDbWrite((tx) => quickRegister(tx, { facilityId, person: { personName: "사내", email: "x@koensain.app" } }, ua)),
      /회사 메일 주소/
    );
    const created = await withDbWrite((tx) => quickRegister(tx, {
      newFacility: { companyName: `간이상사${run}`, homepage: `newco${run}.test` },
      person: { personName: "박지성", title: "팀장", mobilePhone: "010-5555-6666", email: `park@newco${run}.test` },
      source: "mail", sourceAddress: `박지성 <PARK@newco${run}.test>`,
    }, ua));
    assert.equal(created.facilityCreated, true);
    newFacilityId = created.facilityId;
    quickPersonId = created.quickPersonId;
    const [fac] = await q(`SELECT listing, source, trade_roles FROM facilities WHERE facility_id = $1`, [newFacilityId]);
    assert.equal(fac.listing, "other");
    assert.equal(fac.source, "quick-register");
    const rows = await q(`SELECT kind, status, source_address, registered_by FROM contact_quick_registrations WHERE facility_id = $1 ORDER BY kind`, [newFacilityId]);
    assert.deepEqual(rows.map((r) => [r.kind, r.status, r.source_address, r.registered_by]), [
      ["facility", "pending", `park@newco${run}.test`, ua],
      ["person", "pending", `park@newco${run}.test`, ua],
    ]);
    // 기존 업체에 담당자만 — 업체 간이 행은 생기지 않는다.
    const onExisting = await withDbWrite((tx) => quickRegister(tx, { facilityId, person: { personName: "최", email: `choi@alux${run}.test` } }, ua));
    assert.equal(onExisting.facilityCreated, false);
    assert.equal((await q(`SELECT count(*)::int AS n FROM contact_quick_registrations WHERE facility_id = $1 AND kind = 'facility'`, [facilityId]))[0].n, 0);
    assert((await openQuickPersonIds(await getDb())).has(onExisting.personId));
  });

  await t.test("목록은 관리자 전체·직원 본인분, 요청은 메신저 DM 으로 가고 보완하면 끝난다", async () => {
    const db = await getDb();
    const mine = await listQuickRegistrations(db, { userId: ua, all: false, status: "open" });
    assert.equal(mine.items.filter((i) => i.facilityId === newFacilityId).length, 2);
    const others = await listQuickRegistrations(db, { userId: ub, all: false, status: "open" });
    assert.equal(others.items.length, 0);
    const all = await listQuickRegistrations(db, { userId: ub, all: true, status: "open" });
    assert(all.items.some((i) => i.quickId === quickPersonId && i.registeredByName === "직원가"));

    await assert.rejects(() => withDbWrite((tx) => requestPersonDetails(tx, quickPersonId, ua, null)), /본인이 등록한/);
    const sent = await withDbWrite((tx) => requestPersonDetails(tx, quickPersonId, ub, "부서 알려 주세요"));
    assert.equal(sent.recipientId, ua);
    const [msg] = await q(`SELECT body, shared_record FROM chat_messages WHERE message_id = $1`, [sent.messageId]);
    assert.match(String(msg.body), /주소록 상세정보 요청/);
    assert.match(String(msg.body), new RegExp(`/external-parties/quick\\?item=${quickPersonId}`));
    assert.equal((msg.shared_record as { type: string }).type, "facility");
    assert.equal((await getQuickRegistration(db, quickPersonId))?.status, "requested");

    const done = await withDbWrite((tx) => supplementPerson(tx, quickPersonId, ua, {
      personName: "박지성", title: "팀장", departmentName: "구매팀", mobilePhone: "010-5555-6666", officePhone: "02-123-4567", email: `park@newco${run}.test`,
    }));
    assert.equal(done.status, "done");
    assert.equal(done.departmentName, "구매팀");
    assert.equal(done.officePhone, "02-123-4567");
    assert(!(await openQuickPersonIds(db)).has(done.personId!));

    const facilityItem = all.items.find((i) => i.kind === "facility" && i.facilityId === newFacilityId)!;
    const confirmed = await withDbWrite((tx) => confirmQuick(tx, facilityItem.quickId, ub));
    assert.equal(confirmed.status, "done");
    const after = await listQuickRegistrations(db, { userId: ua, all: false, status: "done" });
    assert.equal(after.items.filter((i) => i.facilityId === newFacilityId).length, 2);
  });
});
