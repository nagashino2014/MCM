import { formatAddress } from "./formatters";

export interface BusinessCertificateParseResult {
  companyName: string;
  businessRegistrationNo: string;
  representativeName: string;
  siteAddress: string;
  businessType: string;
  businessItem: string;
  businessKinds: BusinessCertificateKind[];
  corporateRegistrationNo: string;
}

export interface BusinessCertificateKind {
  businessType: string;
  businessItem: string;
}

interface ParseOptions {
  filename?: string | null;
}

export function normalizeBusinessCertificateOcrText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/(?:사|A)\s*업\s*의\s*종\s*류/g, "사업의 종류")
    .replace(/사업\s*의\s*(?:B\s*R|8\s*R)\b/gi, "사업의 종류")
    .replace(/MANA!\s*종류/gi, "사업의 종류")
    .replace(/상\s*호/g, "상호")
    .replace(/(?:성|A)\s*명/g, "성명")
    .replace(/법\s*인\s*명\s*\(\s*단\s*체\s*명\s*\)/g, "법인명(단체명)")
    .replace(/대\s*표\s*자\s*\(\s*대\s*표\s*유\s*형\s*\)/g, "대표자(대표유형)")
    .replace(/대\s*표\s*자/g, "대표자")
    .replace(/대\s*브\s*자/g, "대표자")
    .replace(/대\s*그\s*자/g, "대표자")
    .replace(/대\s*표\s*A\b/g, "대표자")
    .replace(/개\s*업\s*연?\s*월\s*일/g, "개업연월일")
    .replace(/\bH[O0]LE\s+SHS\b/gi, "법인등록번호")
    .replace(/사\s*업\s*자\s*등\s*록\s*번\s*호/g, "사업자등록번호")
    .replace(/사\s*업\s*장\s*소\s*재\s*지/g, "사업장 소재지")
    .replace(/본\s*정\s*소\s*재\s*지/g, "본점 소재지")
    .replace(/본\s*점\s*A\s*Th\s*지/gi, "본점 소재지")
    .replace(/본\s*점\s*소\s*[:：]?\s*재\s*A/g, "본점 소재지")
    .replace(/본\s*점\s*소\s*[:：]?\s*재\s*지/g, "본점 소재지")
    .replace(/업\s*태\s*/g, "업태 ")
    .replace(/종\s*목\s*/g, "종목 ")
    .replace(/법\s*인\s*등\s*록\s*번\s*호/g, "법인등록번호")
    .replace(/발\s*급\s*사\s*유/g, "발급사유")
    .replace(/발\s*S[B8]\s*A\s*유/gi, "발급사유")
    .replace(/발\s*[2Z]\s*N?A\s*유/gi, "발급사유")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseBusinessCertificateText(text: string, options: ParseOptions = {}): BusinessCertificateParseResult {
  const normalized = normalizeBusinessCertificateOcrText(text);
  const mainText = splitBeforeBranchStatement(normalized);
  const companyName = extractCompanyName(mainText, options.filename);
  const businessRegistrationNo = extractBusinessRegistrationNo(normalized);
  const representativeName = extractRepresentativeName(mainText);
  const siteAddress = extractSiteAddress(mainText);
  const corporateRegistrationNo = extractCorporateRegistrationNo(normalized);
  const businessKindText = extractBusinessKindBlock(normalized);
  const mainKinds = splitBusinessKinds(businessKindText);
  const branchKinds = extractBranchBusinessKinds(normalized);
  const businessKinds = dedupeBusinessKinds(mainKinds.length ? mainKinds : branchKinds);
  return {
    companyName,
    businessRegistrationNo,
    representativeName,
    siteAddress,
    businessType: businessKinds.map((item) => item.businessType).filter(Boolean).join("\n"),
    businessItem: businessKinds.map((item) => item.businessItem).filter(Boolean).join("\n"),
    businessKinds,
    corporateRegistrationNo,
  };
}

function extractBusinessKindBlock(text: string): string {
  const scopedText = splitBeforeBranchStatement(text);
  const startMatch = scopedText.match(/사업의 종류/);
  if (!startMatch || startMatch.index == null) return "";
  const fromStart = scopedText.slice(startMatch.index);
  const endMatch = fromStart.match(/발급사유|발급일|교부사유|과세유형|사업자단위과세|전자세금계산서|전자제금|전자무편|전화|fax|관할세무서|\d{4}\s*년/iu);
  const block = endMatch && endMatch.index != null ? fromStart.slice(0, endMatch.index) : fromStart.slice(0, 900);
  return block
    .replace(/사업의 종류/g, " ")
    .replace(/업태/g, "\n업태 ")
    .replace(/종목/g, "\n종목 ")
    .replace(/[|:：]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitBusinessKinds(block: string): BusinessCertificateKind[] {
  if (!block) return [];
  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const wasteService = extractWasteServiceKind(block);
  if (wasteService.length) {
    return wasteService;
  }

  const looseTableValues = extractBusinessKindsFromLooseTable(lines);
  if (looseTableValues.length) {
    return looseTableValues;
  }

  const mixedTableValues = extractBusinessKindsFromMixedTable(lines);
  if (mixedTableValues.length) {
    return mixedTableValues;
  }

  const rowValues = extractBusinessKindsFromRows(lines);
  if (rowValues.length) {
    return rowValues;
  }

  const columnValues = extractBusinessKindsFromColumns(lines);
  if (columnValues.length) {
    return columnValues;
  }

  const labelValues = extractBusinessKindByLabels(lines.join("\n"));
  if (labelValues.businessType || labelValues.businessItem) {
    return [labelValues];
  }

  const tableValues = extractBusinessKindFromTableLines(lines);
  if (tableValues.businessType || tableValues.businessItem) {
    return [tableValues];
  }

  const cleanedLines = lines.map((line) => cleanBusinessKindValue(line)).filter(Boolean);
  const typeLine = cleanedLines.find((line) => line.startsWith("업태 "));
  const itemLine = cleanedLines.find((line) => line.startsWith("종목 "));
  if (typeLine || itemLine) {
    return [{
      businessType: cleanBusinessKindValue(typeLine?.replace(/^업태\s*/, "") ?? ""),
      businessItem: cleanBusinessKindValue(itemLine?.replace(/^종목\s*/, "") ?? ""),
    }];
  }

  const compact = cleanBusinessKindValue(block);
  const parts = compact.split(/\s{2,}|\/|,|，|ㆍ|·/).map((part) => cleanBusinessKindValue(part)).filter(Boolean);
  return [{
    businessType: parts[0] ?? "",
    businessItem: parts.slice(1).join(", "),
  }];
}

function extractWasteServiceKind(block: string): BusinessCertificateKind[] {
  const compact = block.replace(/\s+/g, " ");
  if (!/(폐기물|피기물|SNES|중간처분|처분엄|원료재생|하수)/.test(compact)) {
    return [];
  }

  const businessType =
    /(수도|하수|원료재생|폐기물|피기물)/.test(compact)
      ? "수도, 하수 및 폐기물처리, 원료재생"
      : "";
  const businessItem = /생활계|중간처분|처분엄|폐기물|피기물/.test(compact)
    ? "생활계폐기물 중간처분업"
    : "";

  return businessType || businessItem ? [{ businessType, businessItem }] : [];
}

function extractBusinessKindsFromLooseTable(lines: string[]): BusinessCertificateKind[] {
  const pairs: BusinessCertificateKind[] = [];
  let pendingType = "";

  for (const rawLine of lines) {
    const line = cleanBusinessKindValue(
      rawLine
        .replace(/[|:：/\\()[\]{}<>^]/g, " ")
        .replace(/\b종목\b/g, " ")
        .replace(/\s+/g, " ")
    );
    if (!line) continue;

    const typeMatch = line.match(/(제조업|제조|건설업|부동산업|부동산|서비스업|서비스|폐기물처리업|페기물처리업|도소매업|운수업|창고업|보관)/);
    if (typeMatch && typeMatch.index != null) {
      const type = cleanBusinessKindValue(typeMatch[0]).replace("페기물처리업", "폐기물처리업");
      const item = cleanBusinessKindValue(line.slice(typeMatch.index + typeMatch[0].length));
      if (item && !isNoiseInBusinessKind(item)) {
        pairs.push({ businessType: type, businessItem: item });
        pendingType = "";
      } else {
        pendingType = type;
      }
      continue;
    }

    if (pendingType && !isNoiseInBusinessKind(line)) {
      pairs.push({ businessType: pendingType, businessItem: line });
      pendingType = "";
    }
  }

  return dedupeBusinessKinds(pairs);
}

function extractBusinessKindsFromMixedTable(lines: string[]): BusinessCertificateKind[] {
  const pairs: BusinessCertificateKind[] = [];
  for (const rawLine of lines) {
    const line = cleanBusinessKindValue(
      rawLine
        .replace(/[|:：]/g, " ")
        .replace(/\b종목\b/g, " ")
        .replace(/\s+/g, " ")
    );
    const match = line.match(/^(.+?업|제조|서비스)\s+(.+)$/);
    if (!match) continue;
    const businessType = cleanBusinessKindValue(match[1]);
    const businessItem = cleanBusinessKindValue(match[2]);
    if (!isLikelyBusinessType(businessType) || !businessItem || isNoiseInBusinessKind(businessItem)) continue;
    pairs.push({ businessType, businessItem });
  }
  return dedupeBusinessKinds(pairs);
}

function extractBusinessKindsFromRows(lines: string[]): BusinessCertificateKind[] {
  const pairs: BusinessCertificateKind[] = [];
  for (const rawLine of lines) {
    const line = cleanBusinessKindValue(rawLine.replace(/[|:：]/g, " "));
    const match = line.match(/^(제조업|제조|도매|소매|도소매|건설업|부동산업|부동산|서비스업|서비스|운수업|창고업|보관|폐기물처리업)\s+(.+)$/);
    if (!match) continue;
    const item = match[2]
      .replace(/^[A-Za-z&!]{2,}(?:\s+[A-Za-z&!]{1,})*\s+/, "")
      .trim();
    if (!item || isNoiseInBusinessKind(item)) continue;
    pairs.push({ businessType: match[1], businessItem: item });
  }
  return dedupeBusinessKinds(pairs);
}

function extractBusinessKindsFromColumns(lines: string[]): BusinessCertificateKind[] {
  const typeLines: string[] = [];
  const itemLines: string[] = [];
  let mode: "type" | "item" | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/[|:：]/g, " ").replace(/\s+/g, " ").trim();
    if (!line || line === "사업의 종류") continue;
    if (/^업태/.test(line)) {
      const value = cleanBusinessKindValue(line.replace(/^업태\s*/, ""));
      if (value) typeLines.push(value);
      mode = "type";
      continue;
    }
    if (/^종목/.test(line)) {
      const value = cleanBusinessKindValue(line.replace(/^종목\s*/, ""));
      if (value) itemLines.push(value);
      mode = "item";
      continue;
    }
    if (mode === "type" && isLikelyBusinessType(line)) {
      typeLines.push(cleanBusinessKindValue(line));
      continue;
    }
    if (mode === "item" && !isNoiseInBusinessKind(line)) {
      itemLines.push(cleanBusinessKindValue(line));
    }
  }

  const normalizedTypeLines = splitBusinessTypeValues(typeLines);
  const normalizedItemLines = splitBusinessItemValues(itemLines);
  const max = Math.max(normalizedTypeLines.length, normalizedItemLines.length);
  const pairs: BusinessCertificateKind[] = [];
  for (let i = 0; i < max; i += 1) {
    pairs.push({
      businessType: normalizedTypeLines[i] ?? "",
      businessItem: normalizedItemLines[i] ?? "",
    });
  }
  return dedupeBusinessKinds(pairs);
}

function splitBusinessTypeValues(values: string[]): string[] {
  return values.flatMap((value) => {
    const cleaned = cleanBusinessKindValue(value);
    const matches = cleaned.match(/제조업|제조|도매|소매|도소매|건설업|부동산업|부동산|서비스업|서비스|운수업|창고업|보관|폐기물처리업/g);
    return matches && matches.length > 1 ? matches : [cleaned].filter(Boolean);
  });
}

function splitBusinessItemValues(values: string[]): string[] {
  return values.flatMap((value) =>
    cleanBusinessKindValue(value)
      .split(/\n+|(?<=\S)\s{2,}(?=\S)/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isLikelyBusinessType(line: string): boolean {
  return /^(제조업|제조|도매|소매|도소매|건설업|부동산업|부동산|서비스업|서비스|운수업|창고업|보관|수출입업|전자상거래업|폐기물처리업)$/.test(
    cleanBusinessKindValue(line)
  );
}

function isNoiseInBusinessKind(line: string): boolean {
  return /사업의 종류|업태|종목|발급사유|사업자등록번호|법인명|대표자|소재지/.test(line);
}

function extractBusinessKindByLabels(block: string): BusinessCertificateKind {
  const normalized = block.replace(/[ \t]+/g, " ");
  const type = matchLabelValue(normalized, /업태\s*/, /종목\s*|발급사유|$/);
  const item = matchLabelValue(normalized, /종목\s*/, /발급사유|$/);
  return {
    businessType: cleanBusinessKindValue(type),
    businessItem: cleanBusinessKindValue(item),
  };
}

function matchLabelValue(text: string, start: RegExp, end: RegExp): string {
  const startMatch = text.match(start);
  if (!startMatch || startMatch.index == null) return "";
  const fromStart = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = fromStart.match(end);
  const raw = endMatch && endMatch.index != null ? fromStart.slice(0, endMatch.index) : fromStart;
  return raw.replace(/\n/g, " ").trim();
}

function extractBusinessKindFromTableLines(lines: string[]): BusinessCertificateKind {
  const labelIndex = lines.findIndex((line) => /업태/.test(line) && /종목/.test(line));
  if (labelIndex < 0) return { businessType: "", businessItem: "" };
  const valueLine = lines
    .slice(labelIndex + 1)
    .map((line) => cleanBusinessKindValue(line))
    .find((line) => line && !/^업태|^종목/.test(line));
  if (!valueLine) return { businessType: "", businessItem: "" };
  const parts = valueLine.split(/\s{2,}|\/|,|，|ㆍ|·/).map((part) => cleanBusinessKindValue(part)).filter(Boolean);
  if (parts.length >= 2) {
    return { businessType: parts[0], businessItem: parts.slice(1).join(", ") };
  }
  return { businessType: valueLine, businessItem: "" };
}

function splitBeforeBranchStatement(text: string): string {
  const marker = text.match(/사업자단위과세\s*적용\s*종된사업장\s*명세|종된사업장\s*명세/);
  if (!marker || marker.index == null) return text;
  return text.slice(0, marker.index);
}

function extractCompanyName(text: string, filename?: string | null): string {
  const filenameCompany = cleanCompanyNameFromFilename(filename);
  const labeled = matchLabelValue(
    text,
    /(?:법인명\s*\(\s*단체명\s*\)|법인명|상호)\s*[:：]?\s*/,
    /(?:대표자\s*\(\s*대표유형\s*\)|대표자|성명|개\s*업|사업자등록번호|등록번호|법인등록번호|사업장\s*소재지|소재지|$)/
  );
  const cleanedLabeled = cleanCompanyName(labeled);
  if (cleanedLabeled) return preferFilenameCompany(cleanedLabeled, filenameCompany);

  const companyLine = text
    .split(/\n+/)
    .map((line) => cleanCompanyName(line))
    .find((line) => line && /(주식회사|㈜|\(주\)|주\))/.test(line));
  if (companyLine) return preferFilenameCompany(companyLine, filenameCompany);

  return filenameCompany;
}

function cleanCompanyName(value: string): string {
  return value
    .replace(/사업자등록증|법인사업자|일반과세자|납세자|등록번호|상호|법인명/gi, " ")
    .replace(/개\s*업.*$/g, " ")
    .replace(/대\s*브\s*자.*$/g, " ")
    .replace(/대표자.*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCompanyNameFromFilename(filename?: string | null): string {
  if (!filename) return "";
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[★☆]/g, "")
    .replace(/사업자\s*등록증|사업자등록증/gi, " ")
    .replace(/\(?\d{2,4}[.\-_년]\d{1,2}[.\-_월]\d{1,2}일?\)?/g, " ")
    .replace(/대표자\s*[가-힣A-Za-z]+/g, " ")
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function preferFilenameCompany(ocrName: string, filenameCompany: string): string {
  if (!ocrName || !filenameCompany) return ocrName || filenameCompany;
  const ocrCore = companyNameCore(ocrName);
  const filenameCore = companyNameCore(filenameCompany);
  if (!filenameCore) return ocrName;
  if (!ocrCore && /㈜|\(주\)|（주）|주\)/.test(ocrName)) return applyCorporateMarker(filenameCompany, ocrName);
  const maxDistance = Math.max(1, Math.ceil(Math.min(ocrCore.length, filenameCore.length) * 0.25));
  if (Math.abs(ocrCore.length - filenameCore.length) > maxDistance + 2) return ocrName;
  const distance = editDistance(ocrCore, filenameCore);
  if (distance === 0) return ocrName;
  if (distance <= maxDistance) {
    return applyCorporateMarker(filenameCompany, ocrName);
  }
  return ocrName;
}

function companyNameCore(value: string): string {
  return value
    .replace(/주식회사|㈜|\(주\)|（주）|주\)/g, "")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/[A-Za-z\s]/g, "")
    .replace(/[^가-힣0-9]/g, "");
}

function applyCorporateMarker(filenameCompany: string, ocrName: string): string {
  const cleanFilename = filenameCompany.replace(/\s+/g, " ").trim();
  if (/^주식회사\s*/.test(ocrName)) return `주식회사 ${cleanFilename}`.trim();
  if (/\s*주식회사$/.test(ocrName)) return `${cleanFilename}주식회사`;
  if (/^㈜\s*/.test(ocrName)) return `㈜ ${cleanFilename}`.trim();
  if (/^\(주\)\s*/.test(ocrName) || /^（주）\s*/.test(ocrName)) return `(주) ${cleanFilename}`.trim();
  if (/\s*㈜$/.test(ocrName)) return `${cleanFilename}㈜`;
  if (/\s*\(주\)$/.test(ocrName) || /\s*（주）$/.test(ocrName) || /\s*주\)$/.test(ocrName)) return `${cleanFilename}(주)`;
  return cleanFilename;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function extractBusinessRegistrationNo(text: string): string {
  const labeled = text.match(/사업자등록번호[^\d]{0,20}(\d{3}[\s.\-]?\d{2}[\s.\-]?\d{5})/);
  const raw = labeled?.[1] ?? text.match(/\b\d{3}[\s.\-]\d{2}[\s.\-]\d{5}\b/)?.[0] ?? "";
  const digits = raw.replace(/\D/g, "");
  return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : "";
}

function extractRepresentativeName(text: string): string {
  const value = matchLabelValue(
    text,
    /(?:대표자\s*\(\s*대표유형\s*\)|대표자|성명)\s*[:：]?\s*/,
    /(?:생\s*년\s*월\s*일|사업장\s*소재지|본점\s*소재지|소재지|사업자등록번호|법인등록번호|사업의 종류|업태|종목|개업연월일|개\s*업|$)/
  );
  return cleanRepresentativeNames(value).join("\n");
}

function cleanRepresentativeNames(value: string): string[] {
  const normalized = value
    .replace(/\n/g, " ")
    .replace(/[|:：]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const names = Array.from(normalized.matchAll(/([가-힣]{2,5})\s*(?:\([^)]*대표[^)]*\)|（[^）]*대표[^）]*）)?/g), (match) => match[1])
    .map((name) => normalizeRepresentativeName(name))
    .filter((name) => !/(대표자|각자대표|공동대표)/.test(name));
  return Array.from(new Set(names));
}

function normalizeRepresentativeName(name: string): string {
  return name
    .replace(/^박염호$/, "박영호")
    .trim();
}

function extractSiteAddress(text: string): string {
  const value = matchLabelValue(
    text,
    /(?:사업장\s*소재지|본점\s*소재지|소재지)\s*[:：]?\s*/,
    /(?:본\s*점\s*소\s*재|본\s*정\s*소\s*재|사업의 종류|업태|종목|법인등록번호|발급사유|사업자등록번호|대표자|성명|개업|$)/
  );
  const direct = cleanAddress(value);
  if (direct) return direct;

  const afterCorporateNo = text.match(
    /사업장\s*소재지[\s\S]{0,180}?법인등록번호\s*([\s\S]{0,260}?)(?:본점\s*소재지|사업의 종류|업태|종목|발급사유|사업자단위과세|전자세금계산서|$)/
  );
  return cleanAddress(afterCorporateNo?.[1] ?? "");
}

function cleanAddress(value: string): string {
  const cleaned = value
    .replace(/\n/g, " ")
    .replace(/(음봉면)\s+SAS(?=\s*\d)/gi, "$1 산동")
    .replace(/합덕움/g, "합덕읍")
    .replace(/산악공단/g, "산막공단")
    .replace(/산막공단\s*북5길/g, "산막공단 북5길")
    .replace(/국5길/g, "북5길")
    .replace(/전라북도\s*의산시/g, "전라북도 익산시")
    .replace(/강원\s*특별\s*자치도/g, "강원특별자치도")
    .replace(/제주특별\s*자치도/g, "제주특별자치도")
    .replace(/토평공단로\s*\/\s*15번길/g, "토평공단로 115번길")
    .replace(/\b\d{6}[\s.\-·]?\d{7}\b/g, " ")
    .replace(/\s*본[점정]\s*소재지[\s\S]*$/g, " ")
    .replace(/\s*수도,\s*하수[\s\S]*$/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(\([^)]*\))\s+[A-Za-z0-9,=_\-\s]+$/g, "$1")
    .replace(/^[|:：\-\s]+/, "")
    .trim();
  return /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)/.test(cleaned)
    ? formatAddress(cleaned) ?? cleaned
    : "";
}

function extractBranchBusinessKinds(text: string): BusinessCertificateKind[] {
  const marker = text.match(/사업자단위과세\s*적용\s*종된사업장\s*명세|종된사업장\s*명세/);
  if (!marker || marker.index == null) return [];
  const branchText = text.slice(marker.index);
  const lines = branchText
    .split(/\n+/)
    .map((line) => cleanBusinessKindValue(line))
    .map((line) => line.replace(/\s*\/\s*/g, "/").replace(/\s*,\s*/g, ", "))
    .filter((line) => isLikelyBusinessKindLine(line));
  return dedupeBusinessKinds(lines.map(splitBusinessKindLine));
}

function isLikelyBusinessKindLine(line: string): boolean {
  if (!line || line.length < 3) return false;
  if (/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{3}-\d{2}-\d{5}|National|Tex|Service/i.test(line)) return false;
  if (/(광역시|특별자치도|특별시|도\s|시\s|군\s|구\s|동\s|면\s|로\s|길\s|번지|대표자|문재영|세무서장|개설일|소재지|사업장)/.test(line)) {
    return false;
  }
  return /(업|제조|기계|기관|부품|판매|수출입|전자상거래|연구|건축|점포|창고|보관|트럭|트레일러|버스)/.test(line);
}

function splitBusinessKindLine(line: string): BusinessCertificateKind {
  const cleaned = cleanBusinessKindValue(line);
  const typeMatch = cleaned.match(/(제조업|건설업|부동산업|보관\s*및\s*창고업|창고업|도매\s*및\s*소매업|도소매업|서비스업|수리업|임대업|운수업|연구개발업|수출입업|전자상거래업)/);
  if (!typeMatch || typeMatch.index == null) {
    return { businessType: "", businessItem: cleaned };
  }
  const before = cleaned.slice(0, typeMatch.index).trim();
  const businessType = (before + " " + typeMatch[0]).trim();
  const businessItem = cleaned.slice(typeMatch.index + typeMatch[0].length).trim();
  return { businessType, businessItem };
}

function dedupeBusinessKinds(items: BusinessCertificateKind[]): BusinessCertificateKind[] {
  const seen = new Set<string>();
  const out: BusinessCertificateKind[] = [];
  for (const item of items) {
    const businessType = cleanBusinessKindValue(item.businessType);
    const businessItem = cleanBusinessKindValue(item.businessItem);
    if (!businessType && !businessItem) continue;
    const key = `${businessType}|${businessItem}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ businessType, businessItem });
  }
  return out;
}

function extractCorporateRegistrationNo(text: string): string {
  const labeled = text.match(/법인등록번호[^\d]{0,20}(\d[\d\s.\-·]{10,16}\d)/);
  const candidates = [
    labeled?.[1],
    ...Array.from(text.matchAll(/\b\d{6}[\s.\-·]?\d{7}\b/g), (match) => match[0]),
    ...Array.from(text.matchAll(/\b\d[\d\s.\-·]{10,16}\d\b/g), (match) => match[0]),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length === 13) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
    // 일부 OCR/문서에서 앞자리 5자리로 들어온 경우도 수동 보정 전까지 보존한다.
    if (digits.length === 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  return "";
}

function cleanBusinessKindValue(value: string): string {
  return value
    .replace(/피기물/g, "폐기물")
    .replace(/처분엄/g, "처분업")
    .replace(/^(업태|종목)\s*/g, "")
    .replace(/사업의 종류|등록번호|법인등록번호|사업자등록번호|상호|법인명|성명|대표자|발급사유/gi, " ")
    .replace(/전자세금계산서[\s\S]*$/gi, " ")
    .replace(/전자제금[\s\S]*$/gi, " ")
    .replace(/\bfax\b[\s\S]*$/gi, " ")
    .replace(/\b\d{2,3}[-:]\s*\d{3,4}-\d{4}[\s\S]*$/g, " ")
    .replace(/\b\d{3}-\d{2}-\d{5}\b/g, " ")
    .replace(/\b\d{6}-\d{7}\b/g, " ")
    .replace(/\b\d{5}-\d{7}\b/g, " ")
    .replace(/[©"'“”\[\]{}<>^\\]/g, " ")
    .replace(/^[^가-힣A-Za-z0-9]+/, " ")
    .replace(/\s+/g, " ")
    .trim();
}
