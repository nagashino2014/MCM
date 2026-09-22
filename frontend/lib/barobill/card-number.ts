/** Card identifiers stay strings: preserve leading zeroes and values beyond Number's safe range. */
export function canonicalCardNumber(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9 -]+$/.test(value)) {
    throw invalidCardNumber();
  }
  const number = value.replace(/[ -]/g, "");
  if (!/^[0-9]{12,19}$/.test(number)) throw invalidCardNumber();
  return number;
}

function invalidCardNumber(): Error & { status: number; code: string } {
  return Object.assign(new Error("카드번호 형식을 확인하세요. 등록 자료는 변경하지 않았습니다."), {
    status: 409,
    code: "finance_card_number_invalid",
  });
}

/** Validate both complete provider lists before any registry write. Never merge ambiguous entries. */
export function normalizeCardRegistryLists<T extends { cardNum: string }>(all: T[], active: T[]): { all: T[]; activeNumbers: Set<string> } {
  const normalize = (rows: T[]): T[] => {
    const numbers = new Set<string>();
    return rows.map(row => {
      const cardNum = canonicalCardNumber(row.cardNum);
      if (numbers.has(cardNum)) {
        throw Object.assign(new Error("같은 카드번호의 복수 등록 항목을 확인하세요. 등록 자료는 변경하지 않았습니다."), {
          status: 409,
          code: "finance_card_registry_duplicate",
        });
      }
      numbers.add(cardNum);
      return { ...row, cardNum };
    });
  };
  const normalizedAll = normalize(all);
  const normalizedActive = normalize(active);
  const allNumbers = new Set(normalizedAll.map(row => row.cardNum));
  const activeNumbers = new Set(normalizedActive.map(row => row.cardNum));
  if (normalizedActive.some(row => !allNumbers.has(row.cardNum))) {
    throw Object.assign(new Error("전체 목록과 사용 중 카드 목록이 다릅니다. 목록을 다시 확인하세요."), {
      status: 409,
      code: "finance_card_registry_inconsistent",
    });
  }
  return { all: normalizedAll, activeNumbers };
}
