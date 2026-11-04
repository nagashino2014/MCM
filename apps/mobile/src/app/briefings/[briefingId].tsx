import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { EmptyState, Screen, SkeletonList, useToast } from '@/components/ui';
import { apiJson } from '@/lib/api';

interface Briefing {
  question: string; createdAt: string; answerMd: string | null;
  sources: Array<{ signalId: string; reportName: string | null; companyName: string | null; url: string | null }>;
  report: { kpis: Array<{ label: string; value: string }>; trends: string[]; companies: Array<{ name: string; project: string | null; region: string | null; desc: string; facts: Array<{ label: string; value: string }>; note?: { kind: string; text: string } | null }>; insights: Array<{ badge: string; text: string }>; etcNote: string | null } | null;
}
const plain = (text: string) => text.replace(/\*\*/g, '');
const validId = (value?: string) => !!value && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

/** 메신저·푸시가 공통으로 여는 읽기 화면. 매 진입/새로고침에 현재 서버 열람 권한을 확인한다. */
export default function SharedBriefingScreen() {
  const { briefingId, runId } = useLocalSearchParams<{ briefingId: string; runId?: string }>();
  return <BriefingReader key={`${briefingId}:${runId ?? ''}`} briefingId={briefingId} runId={runId} />;
}

function BriefingReader({ briefingId, runId }: { briefingId: string; runId?: string }) {
  const byRun = briefingId === 'run' && validId(runId);
  const valid = byRun || (briefingId !== 'run' && validId(briefingId));
  const path = byRun ? `/api/sales/rag/runs/${encodeURIComponent(runId!)}` : `/api/sales/rag/briefings/${encodeURIComponent(briefingId ?? '')}`;
  const [state, setState] = useState<{ briefing: Briefing | null; loading: boolean; refreshing: boolean; error: string | null }>({ briefing: null, loading: !!valid, refreshing: false, error: null });
  const focused = useRef(false);
  const requestId = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const load = useCallback(async (refresh = false) => {
    if (!focused.current || !valid) return;
    const id = ++requestId.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    // 권한 확인 전에는 이전에 허용됐던 본문도 다시 보여주지 않는다.
    setState({ briefing: null, loading: true, refreshing: refresh, error: null });
    try {
      const result = await apiJson<{ briefing: Briefing | null }>(path, { signal: controller.signal, cache: 'no-store' });
      if (focused.current && requestId.current === id) setState({ briefing: result.briefing, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (focused.current && requestId.current === id) setState({ briefing: null, loading: false, refreshing: false, error: error instanceof Error ? error.message : '브리핑을 확인하지 못했습니다.' });
    } finally {
      if (requestId.current === id) pending.current = null;
    }
  }, [path, valid]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void load();
    return () => {
      focused.current = false;
      requestId.current++;
      pending.current?.abort();
      pending.current = null;
      setState({ briefing: null, loading: !!valid, refreshing: false, error: null });
    };
  }, [load, valid]));
  const { loading, error, refreshing } = state;
  const briefing = !loading && !error && valid ? state.briefing : null;
  const report = briefing?.report;
  const toast = useToast();
  async function openSource(raw: string | null) {
    if (!raw) return;
    try { const url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; await Linking.openURL(url.href); }
    catch { toast.show('출처를 열지 못했습니다.', 'error'); }
  }
  return <Screen refreshing={refreshing} onRefresh={() => void load(true)}>
    {loading ? <SkeletonList count={2} /> : !briefing ? <EmptyState icon="document-outline" title="브리핑을 열 수 없습니다" description={error || (valid ? '공유 대상과 보고서 상태를 확인하세요.' : '공유 링크를 확인하세요.')} /> : <View className="gap-5 rounded-lg border border-cd-border bg-cd-card p-5">
      <View className="gap-2"><Text className="text-[22px] font-semibold text-cd-text">{briefing.question}</Text><Text className="text-[12px] text-cd-muted">{new Date(briefing.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</Text></View>
      {report ? <>
        <View className="flex-row flex-wrap gap-4 border-b border-cd-border pb-4">{report.kpis.slice(0, 4).map((kpi, index) => <View key={index} className="min-w-0 gap-1"><Text className="text-[12px] text-cd-muted">{kpi.label}</Text><Text className="text-[22px] font-medium text-cd-text">{kpi.value}</Text></View>)}</View>
        <View className="gap-3"><Text className="text-[16px] font-medium text-cd-text">핵심 동향</Text>{report.trends.map((text, index) => <Text key={index} className="text-[14px] leading-6 text-cd-text">{plain(text)}</Text>)}</View>
        <View className="gap-3 border-t border-cd-border pt-5"><Text className="text-[16px] font-medium text-cd-text">투자계획 상세</Text>{report.companies.map((company, index) => <View key={index} className="gap-2 border-b border-cd-border pb-4"><Text className="text-[14px] font-medium text-cd-text">{company.name} · {company.project}</Text><Text className="text-[12px] text-cd-muted">{company.region || '지역 미확인'}</Text><Text className="text-[14px] leading-6 text-cd-text">{plain(company.desc)}</Text>{company.facts.map((fact, i) => <Text key={i} className="text-[13px] text-cd-muted">{fact.label}: {fact.value}</Text>)}{company.note ? <Text className="text-[12px] leading-5 text-cd-muted">{company.note.kind} · {plain(company.note.text)}</Text> : null}</View>)}</View>
        <View className="gap-3 border-t border-cd-border pt-5"><Text className="text-[16px] font-medium text-cd-text">영업 시사점</Text>{report.insights.map((item, index) => <View key={index} className="gap-2"><Text className="text-[14px] font-medium text-cd-text">{item.badge}</Text><Text className="text-[14px] leading-6 text-cd-text">{plain(item.text)}</Text></View>)}</View>
        {report.etcNote ? <Text className="text-[12px] leading-5 text-cd-muted">{report.etcNote}</Text> : null}
      </> : <Text className="text-[14px] leading-6 text-cd-text">{plain(briefing.answerMd || '')}</Text>}
      <View className="gap-3 border-t border-cd-border pt-5"><Text className="text-[16px] font-medium text-cd-text">출처</Text>{briefing.sources.map((source, index) => <Pressable key={`${source.signalId}:${index}`} accessibilityRole={source.url ? 'link' : 'text'} disabled={!source.url} onPress={() => void openSource(source.url)} className="border-b border-cd-border py-3 active:opacity-70"><Text className="text-[13px] text-cd-text">[{index + 1}] {source.reportName || source.companyName || '근거 자료'}</Text></Pressable>)}</View>
    </View>}
  </Screen>;
}
