// 세금계산서 발행 시퀀스 실증 (테스트베드 전용) — 발행 → 상태 조회 → 원본 URL → 취소.
// 공급자·공급받는자를 모두 우리 회사로 두는 자가 발행이라 외부에 나가는 것이 없다.
// (테스트베드는 국세청 미전송. 그래도 안전하게 마지막에 DeleteTaxInvoice 로 되돌린다.)
//
// 목적: lib/barobill/tax-invoice.ts 가 만드는 것과 동일한 XML 구조(요소 순서·필수값)가
//       실제로 통과하는지 확인하는 것. 앱 DB 는 건드리지 않는다.
'use strict';
const { loadEnv, call, result, pick, unesc, isErrCode } = require('./barobill');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const el = (tag, v) => (String(v ?? '').trim() ? `<${tag}>${esc(v)}</${tag}>` : '');

async function errString(env, CERTKEY, code) {
  const { xml } = await call(env, 'BANKACCOUNT', 'GetErrString', { CERTKEY, ErrCode: code });
  return unesc(result(xml, 'GetErrString') || `오류코드 ${code}`);
}

function partyXml(tag, p) {
  return `<${tag}>` +
    el('ContactID', p.contactId) + el('CorpNum', p.corpNum) + el('MgtNum', p.mgtNum) +
    el('CorpName', p.corpName) + el('CEOName', p.ceoName) + el('Addr', p.addr) +
    el('BizClass', p.bizClass) + el('BizType', p.bizType) + el('ContactName', p.contactName) +
    el('TEL', p.tel) + el('HP', p.hp) + el('Email', p.email) +
    `</${tag}>`;
}

(async () => {
  loadEnv();
  const env = process.env.BAROBILL_ENV || 'test';
  if (env !== 'test') { console.error('❌ 이 스크립트는 테스트베드 전용입니다(BAROBILL_ENV=test).'); process.exit(1); }
  const CERTKEY = process.env.BAROBILL_CERTKEY;
  const CorpNum = (process.env.BAROBILL_CORPNUM || '').replace(/[^0-9]/g, '');
  const ID = process.env.BAROBILL_ID;
  const Email = process.env.BAROBILL_INVOICER_EMAIL || 'kaikan00@koensain.com';

  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const writeDate = now.toISOString().slice(0, 10).replace(/-/g, '');
  const mgtKey = `TEST${now.toISOString().replace(/[^0-9]/g, '').slice(2, 14)}`;

  const party = {
    contactId: ID, corpNum: CorpNum, corpName: '(주)한국환경안전연구원',
    ceoName: '테스트', addr: '서울', bizClass: '서비스', bizType: '기술서비스',
    contactName: '발행담당', tel: '02-0000-0000', email: Email,
  };
  const invoice =
    partyXml('InvoicerParty', { ...party, mgtNum: mgtKey }) +
    partyXml('InvoiceeParty', party) +
    '<IssueDirection>1</IssueDirection><TaxInvoiceType>1</TaxInvoiceType>' +
    '<TaxType>1</TaxType><TaxCalcType>1</TaxCalcType><PurposeType>2</PurposeType>' +
    el('WriteDate', writeDate) +
    '<AmountTotal>10000</AmountTotal><TaxTotal>1000</TaxTotal><TotalAmount>11000</TotalAmount>' +
    el('Remark1', '연동 테스트 — 발행 직후 취소') +
    '<TaxInvoiceTradeLineItems><TaxInvoiceTradeLineItem>' +
    el('PurchaseExpiry', writeDate) + el('Name', '연동 테스트 품목') +
    '<ChargeableUnit>1</ChargeableUnit><UnitPrice>10000</UnitPrice><Amount>10000</Amount><Tax>1000</Tax>' +
    '</TaxInvoiceTradeLineItem></TaxInvoiceTradeLineItems>';

  // 중첩 구조체라 문자열 그대로 넣어야 한다(앱의 rawXml() 과 동일한 처리).
  const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <RegistAndIssueTaxInvoice xmlns="http://ws.baroservice.com/">
      <CERTKEY>${esc(CERTKEY)}</CERTKEY><CorpNum>${esc(CorpNum)}</CorpNum>
      <Invoice>${invoice}</Invoice>
      <SendSMS>false</SendSMS><ForceIssue>false</ForceIssue><MailTitle>연동 테스트</MailTitle>
    </RegistAndIssueTaxInvoice>
  </soap:Body>
</soap:Envelope>`;

  console.log(`문서번호(MgtKey) = ${mgtKey} · 작성일자 ${writeDate} · 11,000원`);
  const res = await fetch('https://testws.baroservice.com/TI.asmx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://ws.baroservice.com/RegistAndIssueTaxInvoice' },
    body,
  });
  const xml = await res.text();
  const code = result(xml, 'RegistAndIssueTaxInvoice');
  console.log(`\n① 발행: HTTP ${res.status} · 반환 ${code}`);
  if (code !== '1') {
    console.log('   ❌', isErrCode(code) ? await errString(env, CERTKEY, code) : xml.slice(0, 400));
    process.exit(1);
  }
  console.log('   ✅ 발행 성공');

  const st = await call(env, 'TI', 'GetTaxInvoiceState', { CERTKEY, CorpNum, MgtKey: mgtKey });
  const stBody = pick(st.xml, 'GetTaxInvoiceStateResult') || '';
  const g = (t) => unesc(pick(stBody, t) || '');
  console.log(`\n② 상태: BarobillState=${g('BarobillState')} · NTSSendState=${g('NTSSendState')} · NTSSendKey=${g('NTSSendKey') || '(없음)'} · IsOpened=${g('IsOpened')}`);

  const url = await call(env, 'TI', 'GetTaxInvoicePopUpURL', { CERTKEY, CorpNum, MgtKey: mgtKey, ID, PWD: '' });
  const urlText = unesc(result(url.xml, 'GetTaxInvoicePopUpURL') || '');
  console.log(`\n③ 원본 URL: ${isErrCode(urlText) ? '❌ ' + (await errString(env, CERTKEY, urlText)) : urlText.slice(0, 120) + '…'}`);

  const del = await call(env, 'TI', 'DeleteTaxInvoice', { CERTKEY, CorpNum, MgtKey: mgtKey });
  const delCode = result(del.xml, 'DeleteTaxInvoice');
  console.log(`\n④ 취소: 반환 ${delCode}${delCode === '1' ? ' ✅' : ' ❌ ' + (isErrCode(delCode) ? await errString(env, CERTKEY, delCode) : '')}`);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
