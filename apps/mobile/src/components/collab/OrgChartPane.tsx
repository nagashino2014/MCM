import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, EmptyState, SkeletonList } from '@/components/ui';
import { useTheme } from '@/theme/useTheme';
import { useDirectory, type DirDept, type DirPerson } from './DirectoryPane';

/**
 * 조직도 — 웹의 수평 조직도를 모바일에서는 **세로 아코디언 트리**로 재해석한다
 * (좁은 화면에서 가로 트리는 읽을 수 없다 — 축소 대신 재배치 원칙).
 */
export function OrgChartPane() {
  const { c } = useTheme();
  const { data, loading, refreshing, reload, error } = useDirectory();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { roots, childrenOf, peopleOf } = useMemo(() => {
    const depts = data?.departments ?? [];
    const people = data?.people ?? [];
    const childrenOf = new Map<string, DirDept[]>();
    const roots: DirDept[] = [];
    for (const d of depts) {
      if (d.parentDeptId) {
        const arr = childrenOf.get(d.parentDeptId) ?? [];
        arr.push(d);
        childrenOf.set(d.parentDeptId, arr);
      } else {
        roots.push(d);
      }
    }
    const peopleOf = new Map<string, DirPerson[]>();
    for (const p of people) {
      if (!p.deptId) continue;
      const arr = peopleOf.get(p.deptId) ?? [];
      arr.push(p);
      peopleOf.set(p.deptId, arr);
    }
    // 직급 높은 순(rank_order 내림차순).
    for (const arr of peopleOf.values()) {
      arr.sort(
        (a, b) => (b.positionRankOrder ?? 0) - (a.positionRankOrder ?? 0) || a.name.localeCompare(b.name)
      );
    }
    return { roots, childrenOf, peopleOf };
  }, [data]);

  if (loading && !data) {
    return (
      <View className="p-4">
        <SkeletonList count={4} />
      </View>
    );
  }
  if (!data || (!roots.length && !(data.departments ?? []).length)) {
    return (
      <EmptyState
        icon="git-network-outline"
        title={error ? '불러오지 못했습니다' : '조직 정보가 없습니다'}
        description={error ?? undefined}
      />
    );
  }

  const renderDept = (d: DirDept, depth: number) => {
    const kids = childrenOf.get(d.deptId) ?? [];
    const members = peopleOf.get(d.deptId) ?? [];
    const expanded = open[d.deptId] ?? depth === 0;
    return (
      <View key={d.deptId} style={{ paddingLeft: depth * 14 }}>
        <Pressable
          onPress={() => setOpen((p) => ({ ...p, [d.deptId]: !expanded }))}
          className="min-h-[48px] flex-row items-center gap-2 border-b border-cd-border px-4 active:bg-cd-surface">
          <View
            style={{ backgroundColor: d.accentColor ?? c.primary }}
            className="h-2 w-2 rounded-full"
          />
          <Text className="flex-1 text-[15px] font-bold text-cd-text">{d.deptName}</Text>
          <Text className="text-[12px] text-cd-faint">{members.length}명</Text>
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.faint} />
        </Pressable>

        {expanded ? (
          <>
            {members.map((p) => (
              <View
                key={p.employeeId}
                className="flex-row items-center gap-2.5 border-b border-cd-border py-2 pl-8 pr-4">
                <Avatar name={p.name} photoPath={p.photoPath} size="sm" />
                <Text className="flex-1 text-[14px] text-cd-text">
                  {p.name}
                  {p.positionName ? (
                    <Text className="text-[12px] text-cd-faint"> {p.positionName}</Text>
                  ) : null}
                </Text>
              </View>
            ))}
            {kids.map((k) => renderDept(k, depth + 1))}
          </>
        ) : null}
      </View>
    );
  };

  return (
    <ScrollView
      className="flex-1"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
      contentContainerStyle={{ paddingBottom: 24 }}>
      {roots.map((d) => renderDept(d, 0))}
    </ScrollView>
  );
}
