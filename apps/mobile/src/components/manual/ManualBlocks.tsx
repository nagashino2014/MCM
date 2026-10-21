import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { API_BASE_URL } from '@/lib/config';
import { useTheme } from '@/theme/useTheme';

/**
 * 매뉴얼 블록 렌더러(모바일) — 웹 components/manual/ManualBlocks.tsx 와 같은 블록 종류를 RN 으로 그린다.
 * 원본 데이터는 웹 frontend/content/manual 하나이고, 앱은 /api/manual/[articleId] 응답을 그대로 받는다.
 * 인라인 표기: [[버튼 이름]] → 테두리 글자, **강조** → 굵게.
 */
export type ManualBlock =
  | { kind: 'p' | 'tip' | 'warn'; text: string }
  | { kind: 'steps' | 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'flow'; items: { from: string; to: string }[] }
  | { kind: 'link'; article: string; section?: string; label?: string; targetTitle?: string }
  | { kind: 'image'; src: string; alt: string; caption?: string };

const BODY = 'text-[14px] leading-[23px] text-cd-text';

/** [[ ]]·** ** 를 중첩 Text 로. 버튼 이름은 웹처럼 테두리 칩 대신 옅은 바탕 + 굵기로 표시(중첩 Text 는 테두리를 못 그린다). */
export function ManualInline({ text, className = BODY }: { text: string; className?: string }) {
  const { c } = useTheme();
  const parts: React.ReactNode[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      parts.push(
        <Text key={i++} style={{ backgroundColor: c.surface, color: c.text, fontWeight: '600' }}>
          {` ${m[1]} `}
        </Text>
      );
    } else {
      parts.push(
        <Text key={i++} style={{ fontWeight: '700' }}>
          {m[2]}
        </Text>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Text className={className}>{parts}</Text>;
}

export function ManualBlocks({ blocks, onLink }: { blocks: ManualBlock[]; onLink: (article: string, section?: string) => void }) {
  return (
    <View className="gap-3">
      {blocks.map((b, idx) => (
        <BlockView key={idx} block={b} onLink={onLink} />
      ))}
    </View>
  );
}

function BlockView({ block, onLink }: { block: ManualBlock; onLink: (article: string, section?: string) => void }) {
  const { c } = useTheme();
  switch (block.kind) {
    case 'p':
      return <ManualInline text={block.text} />;
    case 'steps':
    case 'list':
      return (
        <View className="gap-1.5">
          {block.items.map((item, i) => (
            <View key={i} className="flex-row gap-2">
              <Text className="w-5 text-right text-[14px] leading-[23px] text-cd-muted">{block.kind === 'steps' ? `${i + 1}.` : '•'}</Text>
              <View className="flex-1">
                <ManualInline text={item} />
              </View>
            </View>
          ))}
        </View>
      );
    case 'tip':
    case 'warn':
      return (
        <View
          className={`flex-row gap-2 rounded-xl border border-cd-border px-3 py-2.5 ${block.kind === 'warn' ? 'bg-cd-warning-soft' : 'bg-cd-surface'}`}>
          <Ionicons
            name={block.kind === 'warn' ? 'warning-outline' : 'bulb-outline'}
            size={16}
            color={block.kind === 'warn' ? c.warning : c.muted}
            style={{ marginTop: 3 }}
          />
          <View className="flex-1">
            <ManualInline text={block.text} />
          </View>
        </View>
      );
    case 'table':
      // 좁은 화면 — 행마다 카드로, "머리글: 값" 줄로 편다.
      return (
        <View className="gap-2">
          {block.rows.map((row, r) => (
            <View key={r} className="gap-1 rounded-xl border border-cd-border bg-cd-card px-3 py-2.5">
              {row.map((cell, ci) => (
                <View key={ci} className="flex-row gap-2">
                  <Text className="w-[34%] text-[12.5px] leading-[21px] text-cd-muted">{block.head[ci] ?? ''}</Text>
                  <View className="flex-1">
                    <ManualInline text={cell} className={ci === 0 ? 'text-[13.5px] font-semibold leading-[21px] text-cd-text' : 'text-[13.5px] leading-[21px] text-cd-text'} />
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    case 'flow':
      return (
        <View className="gap-2">
          {block.items.map((item, i) => (
            <View key={i} className="gap-0.5">
              <ManualInline text={item.from} className="text-[14px] font-semibold leading-[22px] text-cd-text" />
              <View className="flex-row gap-1.5 pl-1">
                <Ionicons name="arrow-forward" size={14} color={c.muted} style={{ marginTop: 4 }} />
                <View className="flex-1">
                  <ManualInline text={item.to} className="text-[13.5px] leading-[22px] text-cd-muted" />
                </View>
              </View>
            </View>
          ))}
        </View>
      );
    case 'link':
      return (
        <Pressable onPress={() => onLink(block.article, block.section)} className="flex-row items-center gap-1 self-start py-1 active:opacity-60">
          <Text className="text-[14px] font-semibold text-cd-primary">{block.label ?? block.targetTitle ?? '관련 기사'}</Text>
          <Ionicons name="arrow-forward" size={14} color={c.primary} />
        </Pressable>
      );
    case 'image':
      return <ManualImage src={block.src} alt={block.alt} caption={block.caption} />;
    default:
      return null;
  }
}

/** 화면 캡처 — 웹 public/ 의 정적 파일. 비율은 받아 온 그림 크기로 맞춘다. */
function ManualImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const [ratio, setRatio] = useState(16 / 10);
  return (
    <View className="gap-1.5">
      <Image
        source={{ uri: `${API_BASE_URL}${src}` }}
        accessibilityLabel={alt}
        contentFit="contain"
        onLoad={(e) => {
          const { width, height } = e.source;
          if (width > 0 && height > 0) setRatio(width / height);
        }}
        style={{ width: '100%', aspectRatio: ratio, borderRadius: 10 }}
        className="border border-cd-border"
      />
      {caption ? <ManualInline text={caption} className="text-[12.5px] leading-[20px] text-cd-muted" /> : null}
    </View>
  );
}
