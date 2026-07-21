import { Linking } from 'react-native';

/** ISO → "7/21" (월/일) */
export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** ISO → "14:30" */
export function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 현재 월 "YYYY-MM" */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "YYYY-MM" 에 delta 개월 가감 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const digits = (num: string) => num.replace(/[^0-9+]/g, '');

export function callPhone(num?: string | null): void {
  if (num) void Linking.openURL(`tel:${digits(num)}`);
}

export function sendSms(num?: string | null): void {
  if (num) void Linking.openURL(`sms:${digits(num)}`);
}
