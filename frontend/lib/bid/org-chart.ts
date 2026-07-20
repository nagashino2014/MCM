import type { PackageData, PackagePerson } from "@/lib/bid/package-data";

/*
 * 사업수행 조직도(org_chart) 표 생성 — 표 테두리 기법.
 * 박스는 4변 실선 셀, 연결선은 빈 셀의 특정 변(우변=세로선, 상변=가로선)만 실선인
 * borderFill 로 그린다(발주처 양식의 조직도 작성예시와 동일한 방식 — 양식3 실측).
 *
 * 계층: PM(최상위) → 사업장기준 파트(2순위) → 업무기준 파트(3순위) → 팀장/팀원 박스.
 * orgLayout.mode: nested = 업무파트를 각 사업장 산하 배치 /
 *                 separate = separatePart(예: 품질보증팀)만 사업장과 동급 배치.
 * 겸직(assignments 복수)은 해당하는 모든 팀 박스에 이름이 들어간다.
 */

/** 조직도에 필요한 borderFill 5종(id) — hwpx-fill 이 header.xml 에 등록 후 전달 */
export interface OrgBorderFills {
  none: number; // 무테두리(여백·간격 셀)
  box: number; // 4변 실선(박스)
  right: number; // 우변만 실선(세로 연결선)
  top: number; // 상변만 실선(가로 분배선)
  topRight: number; // 상변+우변(가로선과 만나는 세로선)
}

/** header.xml 의 borderFill 항목 XML 5종 생성(등록용). */
export function orgBorderFillXml(id: number, edges: { l?: boolean; r?: boolean; t?: boolean; b?: boolean }): string {
  const border = (on: boolean | undefined) =>
    on ? 'type="SOLID" width="0.12 mm" color="#000000"' : 'type="NONE" width="0.1 mm" color="#000000"';
  return (
    `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    `<hh:leftBorder ${border(edges.l)}/><hh:rightBorder ${border(edges.r)}/>` +
    `<hh:topBorder ${border(edges.t)}/><hh:bottomBorder ${border(edges.b)}/>` +
    '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>'
  );
}

interface OrgNode {
  /** 박스 줄들 — twoTier 면 [0]=라벨행, 나머지=내용행(개행 나열) */
  lines: string[];
  twoTier: boolean;
  children: OrgNode[];
}

const personLabel = (p: PackagePerson): string => [p.name, p.positionName].filter(Boolean).join(" ");

/** 팀(또는 사업장 직속) 아래 팀장/팀원 박스 체인 생성 — 팀장 박스 → 팀원 박스 세로 연결. */
function memberChain(members: PackagePerson[]): OrgNode[] {
  const leaders = members.filter((p) => p.role === "팀장");
  const others = members.filter((p) => p.role !== "팀장");
  const chain: OrgNode[] = [];
  const memberBox = (label: string, list: PackagePerson[]): OrgNode => ({
    lines: [label, ...list.map(personLabel)],
    twoTier: true,
    children: [],
  });
  if (leaders.length > 0) chain.push(memberBox("팀장", leaders));
  if (others.length > 0) chain.push(memberBox("팀원", others));
  // 세로 체인으로 연결(팀장 박스 아래 팀원 박스)
  for (let i = chain.length - 1; i > 0; i -= 1) chain[i - 1].children = [chain[i]];
  return chain.length > 0 ? [chain[0]] : [];
}

/** staffConfig·persons → 조직도 트리. 그릴 내용이 없으면 null. */
export function buildOrgTree(data: PackageData): OrgNode | null {
  const cfg = data.staffConfig;
  if (!cfg) return null;
  const persons = data.persons;
  const pms = persons.filter((p) => p.role === "PM");
  const nonPm = persons.filter((p) => p.role !== "PM");

  const assigned = (site: string, work: string): PackagePerson[] =>
    nonPm.filter((p) => p.assignments.some((a) => a.sitePart === site && a.workPart === work));
  const assignedToWork = (work: string): PackagePerson[] =>
    nonPm.filter((p) => p.assignments.some((a) => a.workPart === work));

  const separate = cfg.orgLayout.mode === "separate" && cfg.orgLayout.separatePart ? cfg.orgLayout.separatePart : null;
  const siteWorkParts = cfg.workParts.filter((w) => w !== separate);

  const teamNode = (work: string, members: PackagePerson[]): OrgNode => ({
    lines: [work],
    twoTier: false,
    children: memberChain(members),
  });

  const siteNodes: OrgNode[] = cfg.siteParts.map((site) => {
    const children: OrgNode[] = siteWorkParts.map((w) => teamNode(w, assigned(site, w)));
    // 업무파트 없이 사업장만 배정된 인원은 사업장 직속 박스로
    const direct = nonPm.filter((p) => p.assignments.some((a) => a.sitePart === site && !a.workPart));
    children.push(...memberChain(direct));
    return { lines: [site], twoTier: false, children };
  });

  const rootChildren: OrgNode[] = [...siteNodes];
  if (separate) {
    rootChildren.push(teamNode(separate, assignedToWork(separate)));
  }
  if (cfg.siteParts.length === 0) {
    // 사업장기준 미사용 — 업무파트가 2순위
    rootChildren.length = 0;
    for (const w of siteWorkParts) rootChildren.push(teamNode(w, assignedToWork(w)));
    if (separate) rootChildren.push(teamNode(separate, assignedToWork(separate)));
  }

  const root: OrgNode = {
    lines: pms.length > 0 ? ["PM", ...pms.map(personLabel)] : ["PM"],
    twoTier: pms.length > 0,
    children: rootChildren,
  };
  if (rootChildren.length === 0 && pms.length === 0) return null;
  return root;
}

/* ---------- 그리드 레이아웃 ---------- */

interface GridCell {
  col: number;
  span: number;
  rowSpan: number;
  border: keyof OrgBorderFills;
  lines: string[]; // 셀 안 문단들
}

interface GridRow {
  height: number; // HWPUNIT(최소 높이 — 내용이 많으면 한글이 자동 확장)
  cells: GridCell[]; // col 오름차순, 빈 구간은 렌더 시 none 셀로 채움
}

const ROW_LABEL_H = 560;
const ROW_BODY_H = 420;
const ROW_CONN_H = 330;

interface PlacedNode {
  node: OrgNode;
  centerCol: number; // 세로선이 지나는 열(이 열의 우변이 노드 중앙)
  children: PlacedNode[];
}

function countLeaves(node: OrgNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
}

/** 리프당 2열을 배정하고 각 노드의 중앙 열을 계산한다. */
function placeNode(node: OrgNode, colStart: number): PlacedNode {
  if (node.children.length === 0) {
    return { node, centerCol: colStart, children: [] };
  }
  const children: PlacedNode[] = [];
  let cursor = colStart;
  for (const c of node.children) {
    children.push(placeNode(c, cursor));
    cursor += countLeaves(c) * 2;
  }
  const center = Math.floor((children[0].centerCol + children[children.length - 1].centerCol) / 2);
  return { node, centerCol: center, children };
}

/** 레벨별 노드 수집. */
function byLevel(root: PlacedNode): PlacedNode[][] {
  const levels: PlacedNode[][] = [];
  const walk = (n: PlacedNode, depth: number) => {
    (levels[depth] ??= []).push(n);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return levels;
}

/** 트리 → 행/셀 그리드. */
export function layoutOrgChart(root: OrgNode): { rows: GridRow[]; totalCols: number } {
  const placed = placeNode(root, 0);
  const totalCols = countLeaves(root) * 2;
  const levels = byLevel(placed);
  const rows: GridRow[] = [];

  levels.forEach((nodes, li) => {
    // 이 레벨의 박스 행수 — twoTier 노드가 있으면 2행(1단 박스는 rowSpan 2 로 병합)
    const tier = nodes.some((n) => n.node.twoTier) ? 2 : 1;
    const rowLabel: GridRow = { height: ROW_LABEL_H, cells: [] };
    const rowBody: GridRow = { height: ROW_BODY_H, cells: [] };
    for (const n of nodes) {
      const col = n.centerCol; // 박스 = 중앙 2열(centerCol, centerCol+1)
      if (n.node.twoTier) {
        rowLabel.cells.push({ col, span: 2, rowSpan: 1, border: "box", lines: [n.node.lines[0]] });
        rowBody.cells.push({ col, span: 2, rowSpan: 1, border: "box", lines: n.node.lines.slice(1) });
      } else {
        rowLabel.cells.push({ col, span: 2, rowSpan: tier, border: "box", lines: n.node.lines });
      }
    }
    rows.push(rowLabel);
    if (tier === 2) rows.push(rowBody);

    // 커넥터 2행 — 이 레벨에서 자식이 있는 노드들
    const parents = nodes.filter((n) => n.children.length > 0);
    if (parents.length > 0) {
      const connA: GridRow = { height: ROW_CONN_H, cells: [] };
      const connB: GridRow = { height: ROW_CONN_H, cells: [] };
      for (const p of parents) {
        // A: 부모 중앙 세로선
        connA.cells.push({ col: p.centerCol, span: 1, rowSpan: 1, border: "right", lines: [] });
        // B: 가로 분배선 + 자식 세로선
        const centers = p.children.map((c) => c.centerCol);
        const cmin = Math.min(...centers, p.centerCol);
        const cmax = Math.max(...centers, p.centerCol);
        const childSet = new Set(centers);
        for (let c = cmin; c <= cmax; c += 1) {
          const isChild = childSet.has(c);
          const inSpan = c >= cmin + 1; // 상변 가로선은 cmin 우변 경계부터 시작
          if (isChild && inSpan) connB.cells.push({ col: c, span: 1, rowSpan: 1, border: "topRight", lines: [] });
          else if (isChild) connB.cells.push({ col: c, span: 1, rowSpan: 1, border: "right", lines: [] });
          else if (inSpan) connB.cells.push({ col: c, span: 1, rowSpan: 1, border: "top", lines: [] });
        }
      }
      rows.push(connA, connB);
    }
  });
  return { rows, totalCols };
}

/* ---------- HWPX 표 렌더 ---------- */

export interface OrgRenderStyle {
  paraPrIDRef: string;
  charPrIDRef: string;
  /**
   * 교체 대상 예시 표의 프리앰블 — 여는 태그부터 첫 <hp:tr 이전까지(hp:sz·hp:pos·
   * hp:outMargin·hp:inMargin 등 표 속성 요소 포함). rowCnt/colCnt/sz 는 재계산해 치환.
   */
  tblPreamble: string;
  totalWidthHwp: number;
}

function escapeXml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 조직도 그리드 → hp:tbl XML. */
export function renderOrgTableXml(
  grid: { rows: GridRow[]; totalCols: number },
  fills: OrgBorderFills,
  style: OrgRenderStyle
): string {
  const colW = Math.floor(style.totalWidthHwp / grid.totalCols);
  const para = (text: string) =>
    `<hp:p id="0" paraPrIDRef="${style.paraPrIDRef}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
    `<hp:run charPrIDRef="${style.charPrIDRef}"><hp:t>${escapeXml(text)}</hp:t></hp:run></hp:p>`;
  const cell = (row: number, c: GridCell, height: number): string => {
    const paras = (c.lines.length > 0 ? c.lines : [""]).map(para).join("");
    return (
      `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="${fills[c.border]}">` +
      `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paras}</hp:subList>` +
      `<hp:cellAddr colAddr="${c.col}" rowAddr="${row}"/>` +
      `<hp:cellSpan colSpan="${c.span}" rowSpan="${c.rowSpan}"/>` +
      `<hp:cellSz width="${colW * c.span}" height="${height}"/>` +
      `<hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`
    );
  };

  // rowSpan 병합으로 아래 행에서 건너뛸 열 추적
  const occupied = new Map<number, number>(); // col → 남은 rowSpan
  const trs: string[] = [];
  grid.rows.forEach((row, ri) => {
    const cells: string[] = [];
    const explicit = new Map<number, GridCell>();
    for (const c of row.cells) explicit.set(c.col, c);
    let col = 0;
    while (col < grid.totalCols) {
      const remain = occupied.get(col) ?? 0;
      if (remain > 0) {
        occupied.set(col, remain - 1);
        col += 1;
        continue;
      }
      const c = explicit.get(col);
      if (c) {
        cells.push(cell(ri, c, row.height));
        if (c.rowSpan > 1) {
          for (let k = 0; k < c.span; k += 1) occupied.set(col + k, c.rowSpan - 1);
        }
        col += c.span;
      } else {
        cells.push(cell(ri, { col, span: 1, rowSpan: 1, border: "none", lines: [] }, row.height));
        col += 1;
      }
    }
    trs.push(`<hp:tr>${cells.join("")}</hp:tr>`);
  });

  const totalH = grid.rows.reduce((acc, r) => acc + r.height, 0);
  const preamble = style.tblPreamble
    .replace(/rowCnt="\d+"/, `rowCnt="${grid.rows.length}"`)
    .replace(/colCnt="\d+"/, `colCnt="${grid.totalCols}"`)
    .replace(/(<hp:sz width=")\d+(" height=")\d+(")/, (_, a, b, c) => a + String(colW * grid.totalCols) + b + String(totalH) + c);
  return `${preamble}${trs.join("")}</hp:tbl>`;
}
