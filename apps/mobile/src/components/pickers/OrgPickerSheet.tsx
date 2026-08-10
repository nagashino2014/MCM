import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, Button, EmptyState, OutlineButton, SearchBar, Sheet, SkeletonList } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useTheme } from '@/theme/useTheme';

/**
 * 조직도 인원 선택 시트 — 결재선·참조자·양식의 `user_select`/`dept_select` 가 공유한다.
 * 웹 `components/approval/OrgPickerModal.tsx` 대응.
 *
 * ⚠ 데이터원이 `/api/sales/org`(조직도 스냅샷)인 이유: 결재선에는 **userId** 가 필요한데
 *   주소록(`/api/directory`)은 employeeId 까지만 준다. 웹도 같은 이유로 이 엔드포인트를 쓴다.
 *   다만 이 API 는 `sales.view` 권한이라, 영업 권한이 없는 사용자는 조직도를 못 받는다
 *   (웹과 동일한 제약 — 실사용에서 문제가 되면 /api/directory 응답에 userId 를 더한다).
 */

export interface OrgEmployee {
  employeeId: string;
  userId: string | null;
  name: string;
  deptId: string | null;
  positionName: string | null;
  positionRankOrder: number | null;
  status: 'active' | 'inactive';
  /** 등록된 증명사진 경로(`/api/admin/employees/{id}/photo`). 없으면 이니셜 아바타. */
  photoPath?: string | null;
}
interface OrgDept {
  deptId: string;
  deptName: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
  isActive: boolean;
}
export interface OrgSnapshot {
  departments: OrgDept[];
  employees: OrgEmployee[];
}

export function useOrgSnapshot(skip?: boolean) {
  return useApi<OrgSnapshot>('/api/sales/org', { cache: true, skip });
}

export function OrgPickerSheet({
  visible,
  title = '인원 선택',
  hint,
  multi,
  selectedIds = [],
  onSelect,
  onDone,
  onClose,
  snapshot,
  onSelectDept,
  onClearAll,
}: {
  visible: boolean;
  title?: string;
  hint?: string;
  /** 복수 선택 — 탭해도 닫히지 않고 하단 완료 버튼으로 끝낸다. */
  multi?: boolean;
  /** 이미 선택된 employeeId 목록(체크 표시). */
  selectedIds?: string[];
  onSelect: (emp: OrgEmployee) => void;
  onDone?: () => void;
  onClose: () => void;
  /**
   * 조직도 데이터 주입 — 기본은 `/api/sales/org`(sales.view 권한)를 스스로 부른다.
   * 메신저처럼 전 직원이 써야 하는 화면은 `/api/directory` 응답을 이 shape 로 매핑해 넘긴다.
   */
  snapshot?: OrgSnapshot;
  /**
   * 부서 일괄 선택(multi 전용, MSG-P1) — 주면 부서 행 우측에 체크박스가 생기고,
   * 탭 시 해당 부서 + 하위 부서의 활성 인원 전체가 넘어온다(전체선택/해제 판단은 호출측).
   */
  onSelectDept?: (members: OrgEmployee[]) => void;
  /** 선택 전체 해제(multi 전용) — 주면 footer 에 "모두 해제" 버튼이 생긴다. */
  onClearAll?: () => void;
}) {
  const { c } = useTheme();
  const { data: fetched, loading: fetching } = useOrgSnapshot(!!snapshot);
  const data = snapshot ?? fetched;
  const loading = snapshot ? false : fetching;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const { roots, childrenOf, peopleOf, hits } = useMemo(() => {
    const depts = (data?.departments ?? []).filter((d) => d.isActive !== false);
    const emps = (data?.employees ?? []).filter((e) => e.status !== 'inactive');

    const childrenOf = new Map<string, OrgDept[]>();
    const roots: OrgDept[] = [];
    for (const d of [...depts].sort((a, b) => a.displayOrder - b.displayOrder)) {
      if (d.parentDeptId) {
        const arr = childrenOf.get(d.parentDeptId) ?? [];
        arr.push(d);
        childrenOf.set(d.parentDeptId, arr);
      } else {
        roots.push(d);
      }
    }
    const peopleOf = new Map<string, OrgEmployee[]>();
    for (const e of emps) {
      if (!e.deptId) continue;
      const arr = peopleOf.get(e.deptId) ?? [];
      arr.push(e);
      peopleOf.set(e.deptId, arr);
    }
    // 직급이 높을수록 rank_order 가 크다 → 내림차순(웹·주소록과 동일 규칙).
    for (const arr of peopleOf.values()) {
      arr.sort((a, b) => (b.positionRankOrder ?? 0) - (a.positionRankOrder ?? 0) || a.name.localeCompare(b.name));
    }

    const s = q.trim().toLowerCase();
    const deptName = new Map(depts.map((d) => [d.deptId, d.deptName]));
    const hits = s
      ? emps
          .filter((e) =>
            [e.name, e.positionName, e.deptId ? deptName.get(e.deptId) : null].some((v) =>
              (v ?? '').toLowerCase().includes(s)
            )
          )
          .sort((a, b) => (b.positionRankOrder ?? 0) - (a.positionRankOrder ?? 0) || a.name.localeCompare(b.name))
      : [];
    return { roots, childrenOf, peopleOf, hits };
  }, [data, q]);

  const deptNameOf = useMemo(
    () => new Map((data?.departments ?? []).map((d) => [d.deptId, d.deptName])),
    [data?.departments]
  );

  const Person = ({ e, indent }: { e: OrgEmployee; indent?: boolean }) => {
    const picked = selectedIds.includes(e.employeeId);
    return (
      <Pressable
        onPress={() => {
          onSelect(e);
          if (!multi) onClose();
        }}
        className={`flex-row items-center gap-2.5 border-b border-cd-grid-line py-2.5 ${indent ? 'pl-6' : ''} active:opacity-70`}>
        <Avatar name={e.name} photoPath={e.photoPath} size="sm" />
        <View className="flex-1">
          <Text className="text-[14px] font-semibold text-cd-text">
            {e.name}
            {e.positionName ? <Text className="text-[12px] font-normal text-cd-faint"> {e.positionName}</Text> : null}
          </Text>
          {e.deptId ? (
            <Text className="text-[11.5px] text-cd-faint">{deptNameOf.get(e.deptId) ?? ''}</Text>
          ) : null}
        </View>
        {picked ? <Ionicons name="checkmark-circle" size={20} color={c.primary} /> : null}
      </Pressable>
    );
  };

  // 부서 + 하위 부서의 활성 인원 전체(부서 일괄 선택용).
  const deptTreeMembers = (deptId: string): OrgEmployee[] => {
    const out = [...(peopleOf.get(deptId) ?? [])];
    for (const k of childrenOf.get(deptId) ?? []) out.push(...deptTreeMembers(k.deptId));
    return out;
  };

  const renderDept = (d: OrgDept, depth: number) => {
    const kids = childrenOf.get(d.deptId) ?? [];
    const members = peopleOf.get(d.deptId) ?? [];
    const expanded = open[d.deptId] ?? depth === 0;
    const treeMembers = onSelectDept && multi ? deptTreeMembers(d.deptId) : [];
    const allPicked =
      treeMembers.length > 0 && treeMembers.every((e) => selectedIds.includes(e.employeeId));
    const somePicked = !allPicked && treeMembers.some((e) => selectedIds.includes(e.employeeId));
    return (
      <View key={d.deptId} style={{ paddingLeft: depth * 10 }}>
        <Pressable
          onPress={() => setOpen((p) => ({ ...p, [d.deptId]: !expanded }))}
          className="min-h-[44px] flex-row items-center gap-2 border-b border-cd-border active:opacity-70">
          <View style={{ backgroundColor: d.accentColor ?? c.primary }} className="h-2 w-2 rounded-full" />
          <Text className="flex-1 text-[14px] font-bold text-cd-text">{d.deptName}</Text>
          <Text className="text-[12px] text-cd-faint">{members.length}명</Text>
          {onSelectDept && multi ? (
            // 부서 전체 선택/해제 — 하위 부서 인원 포함. 전원 선택이면 체크, 일부면 중간 표시.
            <Pressable
              hitSlop={10}
              disabled={!treeMembers.length}
              onPress={() => onSelectDept(treeMembers)}
              className="active:opacity-60"
              style={{ opacity: treeMembers.length ? 1 : 0.35 }}>
              <Ionicons
                name={allPicked ? 'checkbox' : somePicked ? 'remove-circle-outline' : 'square-outline'}
                size={21}
                color={allPicked || somePicked ? c.primary : c.faint}
              />
            </Pressable>
          ) : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={c.faint} />
        </Pressable>
        {expanded ? (
          <>
            {members.map((e) => (
              <Person key={e.employeeId} e={e} indent />
            ))}
            {kids.map((k) => renderDept(k, depth + 1))}
          </>
        ) : null}
      </View>
    );
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      footer={
        // ⚠ Sheet 의 footer 래퍼가 이미 flex-row 다 — 여기서 한 겹 더 감싸면 네이티브(yoga)에서
        //   부모 폭이 0 으로 잡혀 버튼이 세로 선으로 찌부러진다(2026-08-09 실기기 실측). ConfirmSheet 패턴.
        multi ? (
          <>
            {onClearAll && selectedIds.length ? (
              <View className="flex-1">
                <OutlineButton label="모두 해제" onPress={onClearAll} />
              </View>
            ) : null}
            <View className="flex-[2]">
              <Button
                label={`완료${selectedIds.length ? ` (${selectedIds.length})` : ''}`}
                onPress={() => {
                  // ⚠ 닫기를 먼저 커밋한다 — onDone 이 라우팅으로 이어질 때 Modal 이 열린 채
                  // 화면이 전환되면 뒤 화면이 freeze 되어 시트가 영영 안 닫힌다(2026-08-09 실측).
                  onClose();
                  onDone?.();
                }}
              />
            </View>
          </>
        ) : undefined
      }>
      <View style={{ height: 420 }}>
        <SearchBar value={q} onChangeText={setQ} placeholder="이름·부서·직급 검색" />
        {loading && !data ? (
          <View className="pt-3">
            <SkeletonList count={4} />
          </View>
        ) : !data?.employees?.length ? (
          <EmptyState icon="git-network-outline" title="조직 정보를 불러오지 못했습니다" />
        ) : (
          <ScrollView className="mt-2 flex-1" keyboardShouldPersistTaps="handled">
            {q.trim() ? (
              hits.length ? (
                hits.map((e) => <Person key={e.employeeId} e={e} />)
              ) : (
                <Text className="py-6 text-center text-[13px] text-cd-faint">검색 결과가 없습니다.</Text>
              )
            ) : (
              roots.map((d) => renderDept(d, 0))
            )}
          </ScrollView>
        )}
        {hint ? <Text className="pt-2 text-[11px] text-cd-faint">{hint}</Text> : null}
      </View>
    </Sheet>
  );
}
