/**
 * 로고(CI) 이미지에서 대표 색상 추출 — **브라우저 전용**(canvas 픽셀 분석).
 *
 * 배포 이미지 상단의 CI 띠를 로고 색으로 자동 구성하기 위한 것이다.
 * 검출된 색이 1색이면 띠 전체가 그 색, 2색이면 2등분, 3색이면 3등분… (최대 4색).
 *
 * 절차: 축소 렌더 → 무채색·투명 픽셀 제외 → 색상환(hue) 버킷 집계 → 인접 버킷 병합 →
 *       점유율 하한 미달 버킷 탈락 → 로고 내 가로 위치 순으로 정렬(로고의 색 배열 순서를 따른다).
 */

const SAMPLE_MAX = 160; // 분석용 축소 변
const MIN_SHARE = 0.06; // 유효 픽셀의 6% 미만 색은 장식·안티에일리어싱으로 보고 버린다
const MERGE_HUE_DEG = 22; // 이만큼 가까운 색상은 같은 색으로 합친다
const MAX_COLORS = 4;

export interface DetectedColor {
  hex: string;
  /** 유효 픽셀 중 점유율(0~1). */
  share: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("로고 이미지를 읽지 못했습니다."));
    img.src = src;
  });
}

const VIVID_S = 0.45; // 대표색 평균에 쓸 "선명한" 픽셀의 채도 하한

interface Bucket {
  count: number;
  r: number;
  g: number;
  b: number;
  /**
   * 대표색 평균은 선명한 픽셀만으로 낸다 — 경계의 안티에일리어싱 픽셀까지 섞으면
   * 원색보다 눈에 띄게 흐린 색이 나온다(경북개발공사 로고에서 노랑이 연두빛으로 검출된 사례).
   */
  vividCount: number;
  vr: number;
  vg: number;
  vb: number;
  hueSin: number; // 0°/360° 경계를 넘는 빨강 계열을 올바로 평균하기 위해 벡터로 누적
  hueCos: number;
  x: number; // 가로 위치 합(로고 내 배치 순서 참고용)
}

/** 선명 픽셀이 충분하면 그쪽 평균을, 아니면 전체 평균을 대표색으로. */
function bucketHex(b: Bucket): string {
  return b.vividCount >= Math.max(8, b.count * 0.1)
    ? toHex(b.vr / b.vividCount, b.vg / b.vividCount, b.vb / b.vividCount)
    : toHex(b.r / b.count, b.g / b.count, b.b / b.count);
}

/**
 * 로고 data URI 에서 대표 색을 뽑는다. 무채색(흑·백·회색) 로고면 가장 짙은 회색 1색을 돌려준다.
 */
export async function detectLogoColors(dataUrl: string): Promise<DetectedColor[]> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, SAMPLE_MAX / Math.max(img.width || 1, img.height || 1));
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("이미지를 분석할 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const buckets = new Map<number, Bucket>();
  let chromatic = 0;
  // 무채색만 있는 로고 대비 — 가장 짙은 유채색 없는 픽셀 평균
  let grayR = 0;
  let grayG = 0;
  let grayB = 0;
  let grayCount = 0;

  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [hue, s, l] = rgbToHsl(r, g, b);
    if (l > 0.95) continue; // 배경 흰색
    if (s < 0.18 || l < 0.12) {
      // 무채색(로고 먹선·검정 글자) — 띠 색으로 쓰지 않되, 전부 무채색인 로고를 위해 따로 모아 둔다
      if (l < 0.85) {
        grayR += r;
        grayG += g;
        grayB += b;
        grayCount++;
      }
      continue;
    }
    chromatic++;
    const key = Math.floor(hue / 12); // 12° 버킷
    const bk =
      buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, vividCount: 0, vr: 0, vg: 0, vb: 0, hueSin: 0, hueCos: 0, x: 0 };
    bk.count++;
    bk.r += r;
    bk.g += g;
    bk.b += b;
    if (s >= VIVID_S && l >= 0.2 && l <= 0.88) {
      bk.vividCount++;
      bk.vr += r;
      bk.vg += g;
      bk.vb += b;
    }
    const rad = (hue * Math.PI) / 180;
    bk.hueSin += Math.sin(rad);
    bk.hueCos += Math.cos(rad);
    bk.x += px % w;
    buckets.set(key, bk);
  }

  if (chromatic === 0) {
    if (grayCount === 0) return [];
    return [{ hex: toHex(grayR / grayCount, grayG / grayCount, grayB / grayCount), share: 1 }];
  }

  // 색상환에서 가까운 버킷끼리 병합 — 같은 잉크가 명암 차로 두 버킷에 걸친 경우를 합친다.
  const entries = [...buckets.entries()]
    .map(([key, b]) => ({
      hue: ((Math.atan2(b.hueSin, b.hueCos) * 180) / Math.PI + 360) % 360,
      key,
      ...b,
    }))
    .sort((a, b) => a.hue - b.hue);

  const merged: typeof entries = [];
  for (const e of entries) {
    const prev = merged[merged.length - 1];
    const gap = prev ? Math.min(Math.abs(e.hue - prev.hue), 360 - Math.abs(e.hue - prev.hue)) : Infinity;
    if (prev && gap <= MERGE_HUE_DEG) {
      prev.count += e.count;
      prev.r += e.r;
      prev.g += e.g;
      prev.b += e.b;
      prev.vividCount += e.vividCount;
      prev.vr += e.vr;
      prev.vg += e.vg;
      prev.vb += e.vb;
      prev.x += e.x;
      prev.hueSin += e.hueSin;
      prev.hueCos += e.hueCos;
      prev.hue = ((Math.atan2(prev.hueSin, prev.hueCos) * 180) / Math.PI + 360) % 360;
    } else {
      merged.push({ ...e });
    }
  }
  // 색상환은 순환이므로 첫 버킷과 마지막 버킷도 한 번 더 비교(빨강 계열)
  if (merged.length >= 2) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    const gap = Math.min(Math.abs(last.hue - first.hue), 360 - Math.abs(last.hue - first.hue));
    if (gap <= MERGE_HUE_DEG) {
      first.count += last.count;
      first.r += last.r;
      first.g += last.g;
      first.b += last.b;
      first.vividCount += last.vividCount;
      first.vr += last.vr;
      first.vg += last.vg;
      first.vb += last.vb;
      first.x += last.x;
      merged.pop();
    }
  }

  // 띠 순서는 점유율이 큰 색부터 — 로고에서 주조색이 맨 앞에 온다(편집기에서 순서는 바꿀 수 있다).
  const picked = merged
    .filter((b) => b.count / chromatic >= MIN_SHARE)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COLORS);

  if (picked.length === 0) {
    const top = merged.sort((a, b) => b.count - a.count)[0];
    return top ? [{ hex: bucketHex(top), share: 1 }] : [];
  }

  return picked.map((b) => ({
    hex: bucketHex(b),
    share: Math.round((b.count / chromatic) * 1000) / 1000,
  }));
}

/** 파일 입력 → data URI(축소 없이 원본 보존, 용량 상한만 검사). */
export function fileToDataUrl(file: File, maxBytes = 1_500_000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(new Error(`이미지가 너무 큽니다(${Math.round(file.size / 1024)}KB). 1.5MB 이하로 올려주세요.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}
