import { useState } from "react";
import { CdTable, CdBadge } from "mcm-cdash";

type Contract = { id: string; title: string; client: string; date: string; amount: number; status: "진행" | "완료" | "보류" };

const ROWS: Contract[] = [
  { id: "C-2026-041", title: "통합환경허가 신청 대행", client: "한빛화학㈜ 울산공장", date: "2026-03-12", amount: 48000000, status: "진행" },
  { id: "C-2026-038", title: "사후환경영향조사 1차년도", client: "대성에너지㈜", date: "2026-02-27", amount: 23500000, status: "진행" },
  { id: "C-2026-031", title: "대기배출시설 변경신고", client: "세종정밀㈜ 아산공장", date: "2026-01-19", amount: 6600000, status: "완료" },
  { id: "C-2025-122", title: "배출영향분석 보완", client: "미래소재㈜", date: "2025-12-04", amount: 15400000, status: "보류" },
];

const TONE = { 진행: "info", 완료: "success", 보류: "warn" } as const;
const won = (n: number) => n.toLocaleString("ko-KR");

const columns = [
  { key: "id", header: "계약번호", render: (r: Contract) => <span className="font-mono">{r.id}</span>, widthClass: "w-32" },
  { key: "title", header: "계약명", render: (r: Contract) => r.title, sortable: true },
  { key: "client", header: "발주처", render: (r: Contract) => r.client },
  { key: "date", header: "계약일", render: (r: Contract) => r.date, sortable: true },
  { key: "amount", header: "계약금액(원)", render: (r: Contract) => won(r.amount), align: "right" as const, sortable: true },
  { key: "status", header: "상태", render: (r: Contract) => <CdBadge tone={TONE[r.status]}>{r.status}</CdBadge>, align: "center" as const },
];

export const ContractList = () => {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>({ key: "date", dir: "desc" });
  return <CdTable columns={columns} rows={ROWS} rowKey={(r) => r.id} sort={sort} onSortChange={setSort} onRowClick={() => {}} />;
};

export const Selectable = () => {
  const [sel, setSel] = useState<Set<string>>(new Set(["C-2026-038"]));
  return <CdTable columns={columns} rows={ROWS} rowKey={(r) => r.id} selectedKeys={sel} onSelectChange={setSel} dense />;
};

export const Loading = () => <CdTable columns={columns} rows={[]} rowKey={(r) => r.id} loading />;

export const Empty = () => <CdTable columns={columns} rows={[]} rowKey={(r) => r.id} />;
