import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { IS_IN_WIDGET, IS_STANDALONE_PWA } from './platform';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    /** +html.tsx 의 부트 스크립트가 붙잡아 둔 설치 프롬프트(React 마운트 전에 발생할 수 있어 전역에 둔다). */
    __mcmInstallPrompt?: BeforeInstallPromptEvent;
  }
}

/**
 * 브라우저 "앱으로 설치"(PWA) 진입(2026-11-04) — 설치 파일(exe) 없이 Edge/Chrome 이 직접 설치하므로 SmartScreen 경고가 없다.
 *  - `available`: 설치 항목을 보일지(웹이고, 위젯 iframe 이 아니고, 이미 앱 창이 아닐 때).
 *  - `install()`: 브라우저가 프롬프트를 줬으면 바로 띄우고 true, 아니면 false(호출 쪽이 수동 안내를 보인다 — 주소창의 설치 아이콘).
 */
export function useInstallPrompt(): { available: boolean; install: () => Promise<boolean> } {
  // 부트 스크립트가 React 마운트 전에 붙잡아 둔 프롬프트는 초기값으로(effect 안 setState 금지).
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    Platform.OS === 'web' && typeof window !== 'undefined' ? (window.__mcmInstallPrompt ?? null) : null
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__mcmInstallPrompt = e as BeforeInstallPromptEvent;
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      window.__mcmInstallPrompt = undefined;
      setPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const available = Platform.OS === 'web' && !IS_IN_WIDGET && !IS_STANDALONE_PWA;
  const install = async () => {
    if (!prompt) return false;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') {
        window.__mcmInstallPrompt = undefined;
        setPrompt(null);
      }
      return true;
    } catch {
      return false;
    }
  };
  return { available, install };
}
