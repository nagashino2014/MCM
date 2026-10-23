/**
 * 문서 노드 트리 공용 핵심 — 홍보·채용공고 편집기(lib/recruit)와 회사소개서 스튜디오(lib/catalog/studio)가 함께 쓴다.
 * 노드는 `{ id, children? }` 모양이면 된다(트리별 추가 필드는 그대로 따라온다). 모든 함수는 순수 함수다.
 */

export interface TreeNodeLike {
  id: string;
  children?: TreeNodeLike[];
}

/** 깊은 사본(JSON 직렬화 가능한 트리 전용). */
export function cloneTree<T>(tree: T): T {
  return JSON.parse(JSON.stringify(tree)) as T;
}

/** 새 노드 id — 영문 소문자로 시작하는 짧은 무작위 문자열. */
export function genNodeId(prefix = "n"): string {
  return prefix + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/** id 로 노드와 그 부모를 찾는다(깊이 우선, 스택). */
export function findWithParent<T extends TreeNodeLike>(root: T, id: string): { node: T; parent: T | null } | null {
  if (root.id === id) return { node: root, parent: null };
  const stack: T[] = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of (cur.children ?? []) as T[]) {
      if (child.id === id) return { node: child, parent: cur };
      stack.push(child);
    }
  }
  return null;
}

/** 앞쪽 순회(부모 먼저). visit 이 false 를 돌려주면 그 노드의 자식은 건너뛴다. */
export function walkTree<T extends TreeNodeLike>(root: T, visit: (node: T, parent: T | null, depth: number) => boolean | void): void {
  const step = (node: T, parent: T | null, depth: number) => {
    if (visit(node, parent, depth) === false) return;
    for (const child of (node.children ?? []) as T[]) step(child, node, depth + 1);
  };
  step(root, null, 0);
}
