/**
 * 배포 이미지 내보내기 — **브라우저 전용**. 캔버스 DOM 을 그대로 PNG 로 캡처한다.
 *
 * 채용공고(lib/recruit/export.ts)와 달리 캔버스가 이미 출력 크기(1080×1920 / 1600×900)라
 * 축소·슈퍼샘플링이 필요 없고, pixelRatio 만 올리면 2배 해상도가 된다.
 *
 * ⚠ `skipFonts: true` 는 필수다. 설치된 html-to-image 1.11.13 은 캡처 때 문서의 웹폰트 CSS 를
 * 통째로 수집·인라인하려다 극단적으로 느려진다(같은 캔버스 실측: 25.4초 → 51ms, 1.11.11 은 42ms).
 * 캡처는 폰트가 이미 로드된 같은 브라우저에서 이뤄지므로 건너뛰어도 결과 이미지는 동일했다
 * (PNG data URI 길이 390,458 로 일치).
 */
import { toPng } from "html-to-image";

export async function exportNoticePng(el: HTMLElement, filename: string, pixelRatio: 1 | 2 = 2): Promise<void> {
  const dataUrl = await toPng(el, { pixelRatio, backgroundColor: "#ffffff", skipFonts: true });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = /\.png$/i.test(filename) ? filename : `${filename}.png`;
  a.click();
}
