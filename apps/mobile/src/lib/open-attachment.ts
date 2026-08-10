import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { API_BASE_URL } from './config';
import { getAccessToken } from './tokens';

/**
 * 인증 프록시 첨부(상대경로)를 받아 여는 네이티브 구현 —
 * 캐시에 내려받아 공유 시트로 넘긴다(뷰어·저장은 OS 에 위임).
 * 웹은 open-attachment.web.ts (blob 다운로드) 로 갈아끼워진다.
 */
export async function openAttachment(path: string, fileName: string): Promise<void> {
  const token = await getAccessToken();
  const dest = `${FileSystem.cacheDirectory}${encodeURIComponent(fileName)}`;
  const dl = await FileSystem.downloadAsync(`${API_BASE_URL}${path}`, dest, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (dl.status !== 200) throw new Error('다운로드에 실패했습니다.');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dl.uri);
  } else {
    throw new Error('이 기기에서 파일을 열 수 없습니다.');
  }
}
