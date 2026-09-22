import { createHash } from 'node:crypto';

/** 닫힌 proof DTO 전용. 원 단위 안전 정수·문자열·boolean·null만 지원한다. */
export const VAT_CANONICAL_V2 = 'vat-canonical-v2' as const;
const invalid = () => Object.assign(new Error('v2 검증 근거에 지원하지 않는 값이 있습니다.'), { status: 400, code: 'vat_canonical_v2_input' });
function string(value: string): string {
  if (value.includes('\0')) throw invalid();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw invalid();
  }
  return JSON.stringify(value);
}
export function vatCanonicalV2(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return string(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw invalid();
    return Object.is(value, -0) ? '0' : String(value);
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(descriptors).length !== value.length + 1) throw invalid();
    const elements: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const element = descriptors[String(index)];
      if (!element || !element.enumerable || !Object.hasOwn(element, 'value')) throw invalid();
      elements.push(vatCanonicalV2(element.value));
    }
    return '[' + elements.join(',') + ']';
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== Object.keys(value).length) throw invalid();
    return '{' + Object.keys(descriptors).sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')))
      .map(key => {
        const entry = descriptors[key];
        if (!entry.enumerable || !Object.hasOwn(entry, 'value')) throw invalid();
        return string(key) + ':' + vatCanonicalV2(entry.value);
      }).join(',') + '}';
  }
  throw invalid();
}
export const vatHashV2 = (value: unknown): string => createHash('sha256').update(vatCanonicalV2(value), 'utf8').digest('hex');
export const vatTextHash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
