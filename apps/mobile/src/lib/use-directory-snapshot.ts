import { useMemo } from 'react';

import type { OrgSnapshot } from '@/components/pickers/OrgPickerSheet';
import { useApi } from './use-api';

/** 주소록(/api/directory) 응답 — OrgPickerSheet 주입용 최소 shape. */
interface DirectoryRes {
  departments: {
    deptId: string;
    deptName: string;
    parentDeptId: string | null;
    displayOrder: number;
    accentColor: string | null;
  }[];
  people: {
    employeeId: string;
    userId: string | null;
    name: string;
    deptId: string | null;
    positionName: string | null;
    positionRankOrder: number | null;
    companyEmail: string | null;
    photoPath: string | null;
  }[];
}

/**
 * 전 직원 조직도 스냅샷(메신저용) — `/api/sales/org`(sales.view 권한) 대신
 * 로그인 전원이 열람 가능한 주소록을 OrgPickerSheet shape 로 매핑한다.
 */
export function useDirectorySnapshot(skip?: boolean): OrgSnapshot | undefined {
  const dir = useApi<DirectoryRes>('/api/directory', { cache: true, skip });
  return useMemo(() => {
    if (!dir.data) return undefined;
    return {
      departments: dir.data.departments.map((d) => ({ ...d, isActive: true })),
      employees: dir.data.people.map((p) => ({
        employeeId: p.employeeId,
        userId: p.userId,
        name: p.name,
        deptId: p.deptId,
        positionName: p.positionName,
        positionRankOrder: p.positionRankOrder,
        status: 'active' as const,
        photoPath: p.photoPath,
      })),
    };
  }, [dir.data]);
}

/**
 * 사내 임직원 사진 인덱스 — 메일 목록처럼 "주소·표시명"만 아는 화면에서 아바타 사진을 찾는다.
 * 같은 `/api/directory` 를 캐시로 공유하므로 추가 요청이 생기지 않는다.
 */
export function useDirectoryPhotos(): { byEmail: Map<string, string>; byName: Map<string, string> } {
  const dir = useApi<DirectoryRes>('/api/directory', { cache: true });
  return useMemo(() => {
    const byEmail = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const p of dir.data?.people ?? []) {
      if (!p.photoPath) continue;
      if (p.companyEmail) byEmail.set(p.companyEmail.trim().toLowerCase(), p.photoPath);
      // 동명이인은 먼저 온 사람 유지(사내 규모상 실질적 충돌 없음).
      if (p.name && !byName.has(p.name)) byName.set(p.name, p.photoPath);
    }
    return { byEmail, byName };
  }, [dir.data]);
}
