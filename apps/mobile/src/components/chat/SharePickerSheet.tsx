import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Chip, EmptyState, ListRow, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { CHAT_SHARE_ICONS, CHAT_SHARE_LABELS, CHAT_SHARE_TYPES, type ChatShare, type ChatShareType } from '@/lib/chat-share';
import { fmtDate } from '@/lib/format';
import { TODO_STATUS_LABELS, type TodoStatus } from '@/lib/todo-types';
import { useTheme } from '@/theme/useTheme';

/**
 * 문서 공유 선택 시트 — 대화방 입력창의 더하기 메뉴 [문서 공유](2026-11-06).
 * 할 일의 연결 선택(todo/LinkPickerSheet)과 같은 모양·같은 조회 API 다: 종류 칩 → 검색 → 행을 누르면 바로 onPick.
 * - 결재 문서: /api/approval/docs?box=4종 합집합을 한 번 받아 클라이언트에서 거른다
 * - 할 일: /api/todo/items?view=my|shared (내 것 + 공유받은 것)
 * - 사업장: /api/facilities?q=&limit=30&sort=name
 * 목록은 보는 사람 권한으로 조회되므로 볼 수 없는 문서는 고를 수 없다. 401/403 은 "권한이 없어 검색할 수 없습니다".
 */
const PLACEHOLDER: Record<ChatShareType, string> = {
  approval_doc: '제목·문서번호·양식명 검색',
  todo: '할 일 제목 검색',
  facility: '회사명·사업장명 검색',
};
const DOC_STATUS: Record<string, string> = { draft: '작성중', in_progress: '결재중', approved: '승인', rejected: '반려', canceled: '취소' };

interface Hit {
  id: string;
  title: string;
  sub: string;
}

class DeniedError extends Error {}
const str = (v: unknown): string => (v == null ? '' : String(v));
const joinSub = (parts: (string | null | undefined)[]): string => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(' · ');
const LIMIT = 30;

async function getJson<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (res.status === 401 || res.status === 403) throw new DeniedError('권한이 없어 검색할 수 없습니다.');
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(str(body.error) || `요청 실패 (HTTP ${res.status})`);
  return body as T;
}

type Row = Record<string, unknown>;

/** 여러 목록을 id 기준으로 합친다(먼저 온 것 우선). */
function mergeById(lists: Row[][], idKey: string): Row[] {
  const seen = new Set<string>();
  const all: Row[] = [];
  for (const l of lists)
    for (const r of l) {
      const k = str(r[idKey]);
      if (k && !seen.has(k)) {
        seen.add(k);
        all.push(r);
      }
    }
  return all;
}

export function SharePickerSheet({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (share: ChatShare) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [kind, setKind] = useState<ChatShareType>('approval_doc');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const docsCache = useRef<Row[] | null>(null);
  const todosCache = useRef<Row[] | null>(null);
  const reqId = useRef(0);

  // 열릴 때 초기화 — effect 대신 렌더 중 파생(setState-in-effect 경고 회피, LinkPickerSheet 와 같은 규칙).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setKind('approval_doc');
      setQ('');
      setHits([]);
      setError(null);
    }
  }

  const changeKind = (k: ChatShareType) => {
    setKind(k);
    setQ('');
    setHits([]);
    setError(null);
  };

  // 검색(300ms) — 빈 검색은 상위 30건, 1자는 대기.
  useEffect(() => {
    if (!visible) {
      // 닫히면 캐시를 비운다(다음 열림에서 새로 받는다).
      docsCache.current = null;
      todosCache.current = null;
      return;
    }
    const term = q.trim();
    if (term.length === 1) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        let out: Hit[] = [];
        const s = term.toLowerCase();
        if (kind === 'approval_doc') {
          if (!docsCache.current) {
            const lists = await Promise.all(
              ['in_progress', 'completed', 'pending', 'acted'].map((b) => getJson<{ docs?: Row[] }>(`/api/approval/docs?box=${b}`))
            );
            const all = mergeById(lists.map((l) => l.docs ?? []), 'docId');
            all.sort((a, b) => (str(a.updatedAt) < str(b.updatedAt) ? 1 : -1));
            docsCache.current = all.slice(0, 100);
          }
          out = docsCache.current
            .filter((d) => !s || `${str(d.title)} ${str(d.docNo)} ${str(d.formName)}`.toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((d) => ({
              id: str(d.docId),
              title: d.docNo ? `${str(d.title)} (${str(d.docNo)})` : str(d.title),
              sub: joinSub([str(d.formName), DOC_STATUS[str(d.status)] ?? str(d.status), str(d.drafterName)]),
            }));
        } else if (kind === 'todo') {
          if (!todosCache.current) {
            const mine = await getJson<{ items?: Row[] }>('/api/todo/items?view=my&done=1');
            const shared = await getJson<{ items?: Row[] }>('/api/todo/items?view=shared&done=1').catch(() => ({ items: [] as Row[] }));
            todosCache.current = mergeById([mine.items ?? [], shared.items ?? []], 'itemId');
          }
          out = todosCache.current
            .filter((t2) => !s || str(t2.title).toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((t2) => ({
              id: str(t2.itemId),
              title: str(t2.title),
              sub: joinSub([
                TODO_STATUS_LABELS[str(t2.status) as TodoStatus] ?? str(t2.status),
                t2.dueDate ? `마감 ${fmtDate(str(t2.dueDate))}` : null,
                str(t2.assigneeName) || str(t2.ownerName),
              ]),
            }));
        } else {
          const d = await getJson<{ items?: Row[] }>(`/api/facilities?q=${encodeURIComponent(term)}&limit=${LIMIT}&sort=name`);
          out = (d.items ?? []).map((o) => ({
            id: str(o.facilityId),
            title: str(o.companyName),
            sub: joinSub([[str(o.regionSido), str(o.regionSigungu)].filter(Boolean).join(' ') || str(o.siteAddress), str(o.industryName)]),
          }));
        }
        if (reqId.current === id) setHits(out.filter((h) => h.id && h.title));
      } catch (e) {
        if (reqId.current !== id) return;
        setHits([]);
        setError((e as Error).message);
      } finally {
        if (reqId.current === id) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [visible, kind, q]);

  const term = q.trim();

  return (
    <Sheet visible={visible} onClose={onClose} title="문서 공유" fillHeight={0.85}>
      <View className="flex-1 gap-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8 }}>
          {CHAT_SHARE_TYPES.map((k) => (
            <Chip key={k} label={CHAT_SHARE_LABELS[k]} active={kind === k} onPress={() => changeKind(k)} />
          ))}
        </ScrollView>

        <SearchBar value={q} onChangeText={setQ} placeholder={PLACEHOLDER[kind]} />
        {error ? (
          <EmptyState icon="lock-closed-outline" title={error} />
        ) : loading && !hits.length ? (
          <View className="pt-3">
            <SkeletonList count={3} />
          </View>
        ) : term.length === 1 ? (
          <EmptyState icon="search-outline" title="2자 이상 입력하세요" />
        ) : !hits.length ? (
          <EmptyState icon="search-outline" title="검색 결과가 없습니다" />
        ) : (
          <ScrollView automaticallyAdjustKeyboardInsets className="flex-1" keyboardShouldPersistTaps="handled">
            {hits.map((h) => (
              <ListRow
                key={h.id}
                icon={CHAT_SHARE_ICONS[kind]}
                title={h.title}
                subtitle={h.sub || undefined}
                right={<Ionicons name="add-circle-outline" size={18} color={c.primary} />}
                onPress={() => onPick({ type: kind, id: h.id, title: h.title })}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </Sheet>
  );
}
