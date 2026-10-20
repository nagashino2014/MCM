import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button, Chip, EmptyState, Input, ListRow, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { TODO_LINK_KIND_LABELS, type TodoLinkKind } from '@/lib/todo-types';
import { useTheme } from '@/theme/useTheme';

/**
 * 관련(연결) 선택 시트 — 할 일 상세 '관련' 프레임의 연결 추가·변경(웹 LinkPickerModal 과 같은 API·라벨 규칙).
 * 종류 칩(가로 스크롤) → 검색 → 행 탭이면 바로 onPick. URL 종류만 주소·표시명 입력 + 하단 [연결].
 * - 계약: /api/todo/boards/contract-candidates?q= (모바일은 트리 없이 후보 검색만)
 * - 사업장: /api/facilities?q=&limit=30&sort=name · 결재: /api/approval/docs?box=4종 합집합 클라이언트 필터
 * - 영업: /api/sales/projects?q= (비우면 status=open) · 업무추진계획: /api/work-plan/my-tasks + dept-tasks
 * - 지시(directive)는 목록 API 가 부서 id 필수라 제외. 401/403 은 "권한이 없어 검색할 수 없습니다".
 */

// 메일·메신저 연결(286)은 메일·메신저 화면의 [할 일로] 버튼으로만 만든다 — 피커 대상 아님(웹 LinkPickerModal 과 같음)
export type LinkPickKind = Exclude<TodoLinkKind, 'directive' | 'mail' | 'chat'>;
const KINDS: LinkPickKind[] = ['contract', 'facility', 'approval_doc', 'sales_project', 'work_task', 'url'];
const ICON: Record<LinkPickKind, keyof typeof Ionicons.glyphMap> = {
  contract: 'document-text-outline',
  facility: 'business-outline',
  approval_doc: 'checkmark-done-outline',
  sales_project: 'briefcase-outline',
  work_task: 'list-outline',
  url: 'link-outline',
};
const PLACEHOLDER: Record<Exclude<LinkPickKind, 'url'>, string> = {
  contract: '용역명·발주처 검색',
  facility: '회사명·사업장명 검색',
  approval_doc: '제목·문서번호·양식명 검색',
  sales_project: '영업건·업체명 검색',
  work_task: 'Task 이름·분류 검색',
};
const DOC_STATUS: Record<string, string> = { draft: '작성중', in_progress: '결재중', approved: '승인', rejected: '반려', canceled: '취소' };
const STAGE: Record<string, string> = { lead: '리드', contact: '컨택', proposal: '제안', bidding: '입찰', won: '수주', lost: '실주', hold: '보류' };

export interface LinkPick {
  linkKind: TodoLinkKind;
  linkId: string | null;
  linkLabel: string | null;
}

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

export function LinkPickerSheet({
  visible,
  initialKind,
  onPick,
  onClose,
}: {
  visible: boolean;
  initialKind?: TodoLinkKind | null;
  onPick: (pick: LinkPick) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [kind, setKind] = useState<LinkPickKind>('contract');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const docsCache = useRef<Row[] | null>(null);
  const tasksCache = useRef<Row[] | null>(null);
  const reqId = useRef(0);

  // 열릴 때 초기화 — effect 대신 렌더 중 파생(setState-in-effect 경고 회피, TimeField 와 같은 규칙).
  const [prevVisible, setPrevVisible] = useState(visible);
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    if (visible) {
      setKind(initialKind && initialKind !== 'directive' && initialKind !== 'mail' && initialKind !== 'chat' ? initialKind : 'contract');
      setQ('');
      setHits([]);
      setError(null);
      setUrl('');
      setUrlLabel('');
      setUrlError(null);
    }
  }

  const changeKind = (k: LinkPickKind) => {
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
      tasksCache.current = null;
      return;
    }
    if (kind === 'url') return;
    const term = q.trim();
    if (term.length === 1) return;
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        let out: Hit[] = [];
        const s = term.toLowerCase();
        if (kind === 'contract') {
          const d = await getJson<{ contracts?: Row[] }>(`/api/todo/boards/contract-candidates?q=${encodeURIComponent(term)}&limit=${LIMIT}`);
          out = (d.contracts ?? []).map((o) => ({ id: str(o.contractId), title: str(o.contractTitle), sub: joinSub([str(o.counterpartyName), str(o.facilityName)]) }));
        } else if (kind === 'facility') {
          const d = await getJson<{ items?: Row[] }>(`/api/facilities?q=${encodeURIComponent(term)}&limit=${LIMIT}&sort=name`);
          out = (d.items ?? []).map((o) => ({
            id: str(o.facilityId),
            title: str(o.companyName),
            sub: joinSub([[str(o.regionSido), str(o.regionSigungu)].filter(Boolean).join(' ') || str(o.siteAddress), str(o.industryName)]),
          }));
        } else if (kind === 'approval_doc') {
          if (!docsCache.current) {
            const lists = await Promise.all(['in_progress', 'completed', 'pending', 'acted'].map((b) => getJson<{ docs?: Row[] }>(`/api/approval/docs?box=${b}`)));
            const seen = new Set<string>();
            const all: Row[] = [];
            for (const l of lists)
              for (const d of l.docs ?? []) {
                const k = str(d.docId);
                if (!seen.has(k)) {
                  seen.add(k);
                  all.push(d);
                }
              }
            all.sort((a, b) => (str(a.updatedAt) < str(b.updatedAt) ? 1 : -1));
            docsCache.current = all.slice(0, 100);
          }
          out = docsCache.current
            .filter((d) => !s || `${str(d.title)} ${str(d.docNo)} ${str(d.formName)}`.toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((d) => ({
              id: str(d.docId),
              title: d.docNo ? `${str(d.title)} (${str(d.docNo)})` : str(d.title),
              sub: joinSub([str(d.formName), str(d.docNo), DOC_STATUS[str(d.status)] ?? str(d.status), str(d.drafterName)]),
            }));
        } else if (kind === 'sales_project') {
          const d = await getJson<{ projects?: Row[] }>(term ? `/api/sales/projects?q=${encodeURIComponent(term)}` : '/api/sales/projects?status=open');
          out = (d.projects ?? []).slice(0, LIMIT).map((p) => ({
            id: str(p.projectId),
            title: joinSub([str(p.title), str(p.facilityName)]),
            sub: joinSub([STAGE[str(p.stage)] ?? str(p.stage), str(p.status) === 'closed' ? '종결' : null, str(p.ownerEmployeeName) || str(p.leadMemberName)]),
          }));
        } else if (kind === 'work_task') {
          if (!tasksCache.current) {
            const mine = await getJson<{ tasks?: Row[] }>('/api/work-plan/my-tasks');
            const dept = await getJson<{ tasks?: Row[] }>('/api/work-plan/dept-tasks').catch(() => ({ tasks: [] as Row[] }));
            const seen = new Set<string>();
            const all: Row[] = [];
            for (const t of [...(mine.tasks ?? []), ...(dept.tasks ?? [])]) {
              const k = str(t.taskId);
              if (!seen.has(k)) {
                seen.add(k);
                all.push(t);
              }
            }
            tasksCache.current = all;
          }
          out = tasksCache.current
            .filter((t) => !s || `${str(t.taskName)} ${str(t.categoryName)}`.toLowerCase().includes(s))
            .slice(0, LIMIT)
            .map((t) => ({
              id: str(t.taskId),
              title: str(t.taskName),
              sub: joinSub([t.completed ? '완료' : str(t.status) === 'active' ? '진행' : str(t.status), str(t.categoryName), str(t.lastStage)]),
            }));
        }
        if (reqId.current === id) setHits(out);
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

  const submitUrl = () => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) {
      setUrlError('주소는 http:// 또는 https:// 로 시작해야 합니다.');
      return;
    }
    onPick({ linkKind: 'url', linkId: u, linkLabel: urlLabel.trim() || u });
  };

  const term = q.trim();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="연결 선택"
      fillHeight={0.85}
      footer={kind === 'url' ? <Button label="연결" disabled={!url.trim()} onPress={submitUrl} /> : undefined}>
      <View className="flex-1 gap-2">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8 }}>
          {KINDS.map((k) => (
            <Chip key={k} label={TODO_LINK_KIND_LABELS[k]} active={kind === k} onPress={() => changeKind(k)} />
          ))}
        </ScrollView>

        {kind === 'url' ? (
          <View className="gap-3 pt-1">
            <Input
              label="주소"
              value={url}
              onChangeText={(t: string) => {
                setUrl(t);
                setUrlError(null);
              }}
              placeholder="https://…"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              error={urlError ?? undefined}
            />
            <Input label="표시 이름(선택)" value={urlLabel} onChangeText={setUrlLabel} placeholder="비우면 주소가 그대로 보입니다" maxLength={120} />
          </View>
        ) : (
          <>
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
                    icon={ICON[kind]}
                    title={h.title}
                    subtitle={h.sub || undefined}
                    right={<Ionicons name="add-circle-outline" size={18} color={c.primary} />}
                    onPress={() => onPick({ linkKind: kind, linkId: h.id, linkLabel: h.title })}
                  />
                ))}
              </ScrollView>
            )}
          </>
        )}
      </View>
    </Sheet>
  );
}
