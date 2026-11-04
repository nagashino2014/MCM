import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerSheet } from '@/components/calendar/DatePickerSheet';
import { Chip, ConfirmSheet, GradientButton, Input, Sheet, useToast } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { useTheme } from '@/theme/useTheme';

/**
 * 전자세금계산서(바로빌) 발행 시트 — 웹 TaxInvoiceIssueModal 의 모바일판(2026-11-02).
 * 같은 API(GET 프리필 · POST action=issue)를 쓰고, 발행 성공 시 서버가 단계를 발행 완료로 기록해
 * 발행 요청이 수신함에서 자동 해소된다. 모바일은 품목 1행만 다룬다 — 여러 품목·단계 묶음 발행은 웹에서.
 */

interface Contact {
  name: string;
  title: string | null;
  email: string | null;
  tel: string | null;
  mobile: string | null;
  billing?: boolean;
}
interface Prefill {
  contractTitle: string;
  stageLabel: string;
  stageAmount: number;
  defaultRemark: string;
  writeDate: string;
  invoicer: {
    corpNum: string; corpName: string; ceoName: string; addr: string;
    bizClass: string; bizType: string; tel: string; contactId: string; contactName: string; email: string;
  };
  invoicee: { facilityId: string | null; corpNum: string; corpName: string; ceoName: string; addr: string; bizType?: string; bizClass?: string };
  contacts: Contact[];
  issuerEmails: { email: string; label: string | null }[];
  existing: { invoiceId: string; writeDate: string; totalAmount: number; ntsSendKey: string | null; canceledAt: string | null }[];
  cert: { ok: boolean; message: string };
}

const digits = (s: string) => s.replace(/[^0-9]/g, '');
const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const fmtCorpNum = (value: string) => {
  const d = digits(value).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};
const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const TAX_TYPES = [
  { key: 1, label: '과세' },
  { key: 2, label: '영세' },
  { key: 3, label: '면세' },
];
const PURPOSES = [
  { key: 2, label: '청구' },
  { key: 1, label: '영수' },
];

export function TaxInvoiceIssueSheet({
  target,
  onClose,
  onIssued,
}: {
  target: { contractId: string; milestoneId: string } | null;
  onClose: () => void;
  onIssued: () => void;
}) {
  const { c } = useTheme();
  const toast = useToast();
  // 프리필은 대상(계약·단계)별로 담는다 — 대상이 바뀌면 키가 달라져 로딩 상태가 저절로 된다.
  const targetKey = target ? `${target.contractId}:${target.milestoneId}` : null;
  const [loaded, setLoaded] = useState<{ key: string; prefill: Prefill | null; error: string | null } | null>(null);
  const current = loaded && loaded.key === targetKey ? loaded : null;
  const prefill = current?.prefill ?? null;
  const error = current?.error ?? null;
  const loading = !!targetKey && !current;
  const [busy, setBusy] = useState(false);
  const [datePicker, setDatePicker] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const [writeDate, setWriteDate] = useState('');
  const [taxType, setTaxType] = useState(1);
  const [purposeType, setPurposeType] = useState(2);
  const [amountBase, setAmountBase] = useState<'supply' | 'total'>('supply');
  const [itemName, setItemName] = useState('');
  const [amount, setAmount] = useState('');
  const [remark, setRemark] = useState('');
  const [corpNum, setCorpNum] = useState('');
  const [corpName, setCorpName] = useState('');
  const [ceoName, setCeoName] = useState('');
  const [addr, setAddr] = useState('');
  const [email, setEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactTel, setContactTel] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [invoicerEmail, setInvoicerEmail] = useState('');

  useEffect(() => {
    if (!target) return;
    const key = `${target.contractId}:${target.milestoneId}`;
    let alive = true;
    apiFetch(
      `/api/finance/tax-invoices?contractId=${encodeURIComponent(target.contractId)}&milestoneId=${encodeURIComponent(target.milestoneId)}`
    )
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { prefill?: Prefill; error?: string };
        if (!r.ok || !d.prefill) throw new Error(d.error ?? '발행 정보를 불러오지 못했습니다.');
        if (!alive) return;
        const p = d.prefill;
        setLoaded({ key, prefill: p, error: null });
        setWriteDate(p.writeDate);
        setTaxType(1);
        setPurposeType(2);
        setAmountBase('supply');
        setItemName(p.contractTitle.trim());
        setAmount(String(Math.round(p.stageAmount)));
        setRemark(p.defaultRemark ?? '');
        setCorpNum(p.invoicee.corpNum);
        setCorpName(p.invoicee.corpName);
        setCeoName(p.invoicee.ceoName);
        setAddr(p.invoicee.addr);
        setInvoicerEmail(p.invoicer.email);
        // 웹과 같은 규칙 — '계산서' 태그 담당자의 첫 명이 대표 수신처, 나머지는 추가 수신처.
        const billing = p.contacts.filter((x) => x.billing && x.email);
        const primary = billing[0] ?? p.contacts.find((x) => x.email);
        setEmail(primary?.email ?? '');
        setContactName(primary?.name ?? '');
        setContactTel(primary?.tel ?? primary?.mobile ?? '');
        setCcEmails(billing.filter((x) => x.email && x.email !== primary?.email).map((x) => x.email as string));
      })
      .catch((e) => {
        if (alive) setLoaded({ key, prefill: null, error: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [target]);

  const amounts = useMemo(() => {
    const input = Number(digits(amount) || 0);
    if (taxType === 3) return { supply: input, tax: 0, total: input };
    if (amountBase === 'total') {
      const supply = Math.round(input / 1.1);
      return { supply, tax: input - supply, total: input };
    }
    const tax = Math.round(input * 0.1);
    return { supply: input, tax, total: input + tax };
  }, [amount, amountBase, taxType]);

  const liveExisting = (prefill?.existing ?? []).filter((e) => !e.canceledAt);
  const canIssue =
    !busy &&
    Boolean(prefill?.cert.ok) &&
    amounts.total > 0 &&
    itemName.trim() !== '' &&
    digits(corpNum).length === 10 &&
    isEmail(email) &&
    isEmail(invoicerEmail);

  const pickPrimary = (x: Contact) => {
    if (!x.email) return;
    setEmail(x.email);
    setContactName(x.name);
    setContactTel(x.tel ?? x.mobile ?? '');
    setCcEmails((prev) => prev.filter((e) => e !== x.email));
  };
  const toggleCc = (address: string) =>
    setCcEmails((prev) => (prev.includes(address) ? prev.filter((e) => e !== address) : [...prev, address]));

  const issue = async () => {
    if (!target || !prefill) return;
    setBusy(true);
    try {
      const res = await apiFetch('/api/finance/tax-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'issue',
          contractId: target.contractId,
          milestoneId: target.milestoneId,
          milestoneIds: [target.milestoneId],
          writeDate,
          amountTotal: amounts.supply,
          taxTotal: amounts.tax,
          totalAmount: amounts.total,
          taxType,
          purposeType,
          itemName: itemName.trim(),
          items: [
            {
              name: itemName.trim(),
              remark: remark.trim() || undefined,
              qty: 1,
              unitPrice: amounts.supply || undefined,
              amount: amounts.supply,
              tax: amounts.tax,
            },
          ],
          invoicee: {
            facilityId: prefill.invoicee.facilityId,
            corpNum: digits(corpNum),
            corpName,
            ceoName,
            addr,
            bizType: prefill.invoicee.bizType,
            bizClass: prefill.invoicee.bizClass,
            contactName,
            tel: contactTel,
            email: email.trim(),
            ccEmails: ccEmails.filter((e) => e !== email.trim()),
          },
          invoicer: { ...prefill.invoicer, corpNum: digits(prefill.invoicer.corpNum), email: invoicerEmail.trim() },
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? '발행에 실패했습니다.');
      setConfirm(false);
      toast.show('전자세금계산서를 발행했습니다.', 'success');
      onIssued();
    } catch (e) {
      setConfirm(false);
      toast.show((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const contactsWithEmail = (prefill?.contacts ?? []).filter((x) => x.email);

  return (
    <>
      <Sheet
        visible={!!target && !datePicker && !confirm}
        onClose={onClose}
        title="전자세금계산서 발행"
        fillHeight={0.88}
        footer={
          <View className="flex-1">
            <GradientButton
              label={`${fmt(amounts.total)}원 발행`}
              loading={busy}
              disabled={!canIssue}
              onPress={() => setConfirm(true)}
            />
          </View>
        }>
        <ScrollView automaticallyAdjustKeyboardInsets style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View className="items-center py-10">
              <ActivityIndicator color={c.primary} />
            </View>
          ) : error ? (
            <Text className="py-6 text-center text-[13px] text-cd-error">{error}</Text>
          ) : prefill ? (
            <View className="gap-3 pb-2">
              {!prefill.cert.ok ? (
                <Notice tone="warning" text={`발행할 수 없는 상태입니다 — 바로빌 공동인증서 확인 필요 (${prefill.cert.message})`} />
              ) : null}
              {liveExisting.length ? (
                <Notice
                  tone="warning"
                  text={`이 단계에 이미 발행된 계산서가 ${liveExisting.length}건 있습니다(${liveExisting
                    .map((e) => `${e.writeDate} ${fmt(e.totalAmount)}원`)
                    .join(', ')}). 중복 발행에 주의하세요.`}
                />
              ) : null}

              <Section title="공급받는자 (발주처)">
                <Input label="상호" value={corpName} onChangeText={setCorpName} />
                <Input
                  label="사업자번호"
                  value={fmtCorpNum(corpNum)}
                  onChangeText={(v) => setCorpNum(digits(v).slice(0, 10))}
                  keyboardType="number-pad"
                  placeholder="000-00-00000"
                  error={digits(corpNum).length === 10 ? undefined : '사업자번호 10자리가 필요합니다.'}
                />
                <Input label="대표자" value={ceoName} onChangeText={setCeoName} />
                <Input label="주소" value={addr} onChangeText={setAddr} />
              </Section>

              <Section title="계산서 수신처">
                {contactsWithEmail.length ? (
                  <View className="gap-1">
                    {contactsWithEmail.map((x, i) => {
                      const isPrimary = x.email === email;
                      const isCc = !isPrimary && ccEmails.includes(x.email as string);
                      return (
                        <View key={`${x.email}:${i}`} className="flex-row items-center gap-2 py-1">
                          <View className="flex-1">
                            <Text numberOfLines={1} className="text-[13px] font-semibold text-cd-text">
                              {x.name}
                              {x.title ? ` · ${x.title}` : ''}
                              {x.billing ? ' · 계산서' : ''}
                            </Text>
                            <Text numberOfLines={1} className="text-[12px] text-cd-faint">
                              {x.email}
                            </Text>
                          </View>
                          <Chip label="대표" active={isPrimary} onPress={() => pickPrimary(x)} />
                          {!isPrimary ? (
                            <Chip label="추가" active={isCc} onPress={() => toggleCc(x.email as string)} />
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text className="text-[12px] text-cd-faint">등록된 사업장 담당자가 없습니다. 아래에 직접 입력하세요.</Text>
                )}
                <Input label="담당자" value={contactName} onChangeText={setContactName} />
                <Input label="연락처" value={contactTel} onChangeText={setContactTel} keyboardType="phone-pad" />
                <Input
                  label="이메일 (대표 수신처, 필수)"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  error={email && !isEmail(email) ? '이메일 형식이 올바르지 않습니다.' : undefined}
                />
              </Section>

              <Section title="공급자 (우리 회사)">
                <Text className="text-[13px] text-cd-muted">
                  {prefill.invoicer.corpName} · {fmtCorpNum(prefill.invoicer.corpNum) || '—'}
                </Text>
                <Input
                  label="발행 담당자 이메일 (필수)"
                  value={invoicerEmail}
                  onChangeText={setInvoicerEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                {prefill.issuerEmails.length ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {prefill.issuerEmails.map((it) => (
                      <Chip
                        key={it.email}
                        label={it.label ? `${it.label} ${it.email}` : it.email}
                        active={it.email === invoicerEmail.trim()}
                        onPress={() => setInvoicerEmail(it.email)}
                      />
                    ))}
                  </View>
                ) : null}
              </Section>

              <Section title="발행 내용">
                <View className="gap-1.5">
                  <Text className="text-[13px] font-bold text-cd-muted">작성일자</Text>
                  <Pressable
                    onPress={() => setDatePicker(true)}
                    className="min-h-[44px] flex-row items-center justify-between rounded-xl border border-cd-border bg-cd-card px-3.5 active:opacity-70">
                    <Text className="text-[14px] font-semibold text-cd-text">{writeDate}</Text>
                    <Ionicons name="calendar-outline" size={16} color={c.muted} />
                  </Pressable>
                </View>
                <ChoiceRow label="과세 구분" items={TAX_TYPES} value={taxType} onChange={setTaxType} />
                <ChoiceRow label="영수/청구" items={PURPOSES} value={purposeType} onChange={setPurposeType} />
                <ChoiceRow
                  label="입력 금액 기준"
                  items={[
                    { key: 'supply', label: '공급가액' },
                    { key: 'total', label: '합계(부가세 포함)' },
                  ]}
                  value={amountBase}
                  onChange={setAmountBase}
                />
                <Input label="품목명" value={itemName} onChangeText={setItemName} />
                <Input
                  label={amountBase === 'total' ? '합계금액' : '공급가액'}
                  value={amount ? Number(digits(amount)).toLocaleString('ko-KR') : ''}
                  onChangeText={(v) => setAmount(digits(v))}
                  keyboardType="number-pad"
                />
                <Input label="비고 (지급 단계 · 비중)" value={remark} onChangeText={setRemark} />
                <View className="flex-row justify-between rounded-xl bg-cd-surface px-3 py-2.5">
                  <Text className="text-[13px] text-cd-muted">공급가액 {fmt(amounts.supply)}</Text>
                  <Text className="text-[13px] text-cd-muted">세액 {fmt(amounts.tax)}</Text>
                  <Text className="text-[13px] font-extrabold text-cd-text">합계 {fmt(amounts.total)}원</Text>
                </View>
              </Section>

              <Text className="text-[12px] leading-4 text-cd-faint">
                발행하면 바로빌이 대표 수신처로 계산서 메일을 보내고, 이 단계는 발행 완료로 기록됩니다. 여러 품목·단계 묶음 발행은 웹에서 진행하세요.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </Sheet>

      <DatePickerSheet
        visible={datePicker}
        title="작성일자 선택"
        value={writeDate}
        onConfirm={(d) => {
          setWriteDate(d);
          setDatePicker(false);
        }}
        onClose={() => setDatePicker(false)}
      />

      <ConfirmSheet
        visible={confirm}
        title="전자세금계산서를 발행할까요?"
        message={`${corpName} · ${writeDate} · 합계 ${fmt(amounts.total)}원\n수신 ${email}\n발행된 계산서는 취소할 수 없습니다(정정은 수정발행).`}
        confirmLabel="발행"
        loading={busy}
        onConfirm={() => void issue()}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2.5 rounded-xl border border-cd-border p-3">
      <Text className="text-[13px] font-extrabold text-cd-text">{title}</Text>
      {children}
    </View>
  );
}

function ChoiceRow<T extends string | number>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-[13px] font-bold text-cd-muted">{label}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        {items.map((it) => (
          <Chip key={String(it.key)} label={it.label} active={value === it.key} onPress={() => onChange(it.key)} />
        ))}
      </View>
    </View>
  );
}

function Notice({ tone, text }: { tone: 'warning'; text: string }) {
  const { c } = useTheme();
  return (
    <View className={`flex-row items-start gap-2 rounded-xl px-3 py-2.5 ${tone === 'warning' ? 'bg-cd-warning-soft' : ''}`}>
      <Ionicons name="warning-outline" size={15} color={c.warning} />
      <Text className="flex-1 text-[12px] leading-4 text-cd-warning">{text}</Text>
    </View>
  );
}
