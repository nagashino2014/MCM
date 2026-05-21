/**
 * API 스크래핑 결과 내보내기 유틸리티
 * 
 * API 호출 결과를 XLSX 및 JSON 파일로 저장합니다.
 */

import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

export interface ApiExportResult {
  success: boolean;
  xlsxPath: string;
  jsonPath: string;
  docxPath?: string;
  xmlPath?: string;
  error?: string;
}

export interface ApiExportOptions {
  docType?: string;         // 문서 유형 (법령, 보도자료 등)
  rawXmlResponses?: string[]; // 원본 XML 응답들 (저장용)
  hierarchicalData?: any[];   // 계층 구조 유지된 원본 데이터 (법령용)
}

/**
 * API 응답 데이터를 XLSX, JSON, DOCX, XML 파일로 저장
 * 
 * @param data API 응답 데이터 배열
 * @param boardName 보드 이름 (파일명에 사용)
 * @param outputDir 출력 디렉토리 경로
 * @param selectedFields 선택된 필드 목록 (없으면 모든 필드)
 * @param options 추가 옵션 (문서 유형, 원본 XML 등)
 * @returns 저장 결과
 */
export async function exportApiData(
  data: any[],
  boardName: string,
  outputDir: string,
  selectedFields?: string[],
  options?: ApiExportOptions
): Promise<ApiExportResult> {
  try {
    // 출력 디렉토리 생성
    fs.mkdirSync(outputDir, { recursive: true });

    // 파일명 생성: {일자}_{보드명}_API결과
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    const timeStr = today.toTimeString().split(" ")[0].replace(/:/g, "");
    const safeboardName = boardName.replace(/[\\/:*?"<>|]/g, "_");
    const baseFileName = `${dateStr}_${timeStr}_${safeboardName}_API결과`;
    
    const xlsxPath = path.join(outputDir, `${baseFileName}.xlsx`);
    const jsonPath = path.join(outputDir, `${baseFileName}.json`);
    const docxPath = path.join(outputDir, `${baseFileName}.docx`);
    const xmlPath = path.join(outputDir, `${baseFileName}.xml`);

    const isLawDocument = options?.docType === "법령";

    // 데이터 필터링 (선택된 필드만)
    let exportData = data;
    if (selectedFields && selectedFields.length > 0) {
      exportData = data.map((item) => {
        const filtered: Record<string, any> = {};
        for (const field of selectedFields) {
          // 중첩 필드 지원 (예: "법령.법령명")
          const value = getNestedValue(item, field);
          filtered[field] = value;
        }
        return filtered;
      });
    }

    // JSON 파일 저장
    const jsonContent = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(jsonPath, jsonContent, "utf8");

    // 원본 XML 저장 (옵션에 있으면)
    let savedXmlPath = "";
    if (options?.rawXmlResponses && options.rawXmlResponses.length > 0) {
      const xmlContent = options.rawXmlResponses.join("\n\n<!-- ========== 다음 응답 ========== -->\n\n");
      fs.writeFileSync(xmlPath, xmlContent, "utf8");
      savedXmlPath = xmlPath;
    }

    // DOCX 파일 저장
    let doc: Document;
    if (isLawDocument && options?.hierarchicalData && options.hierarchicalData.length > 0) {
      // 법령 문서: 계층 구조 유지 DOCX
      doc = buildLawDocxDocument(options.hierarchicalData, boardName);
    } else {
      // 일반 문서: 범용 DOCX
      doc = buildDocxDocument(exportData, boardName);
    }
    const docxBuffer = await Packer.toBuffer(doc);
    fs.writeFileSync(docxPath, docxBuffer);

    // XLSX 파일 저장 (법령 문서가 아닐 때만)
    let savedXlsxPath = "";
    if (!isLawDocument) {
      const workbook = XLSX.utils.book_new();

      // 데이터를 평탄화 (중첩 객체 처리)
      const flattenedData = exportData.map((item) => flattenObject(item));
      
      // 시트 생성
      const sheet = XLSX.utils.json_to_sheet(flattenedData);
      
      // 열 너비 자동 조정
      const colWidths = calculateColumnWidths(flattenedData);
      sheet["!cols"] = colWidths;
      
      XLSX.utils.book_append_sheet(workbook, sheet, "API 결과");

      // 파일 저장
      XLSX.writeFile(workbook, xlsxPath);
      savedXlsxPath = xlsxPath;
    }

    return {
      success: true,
      xlsxPath: savedXlsxPath,
      jsonPath,
      docxPath,
      xmlPath: savedXmlPath,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      xlsxPath: "",
      jsonPath: "",
      docxPath: "",
      xmlPath: "",
      error: errorMsg,
    };
  }
}

function safeStringify(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildDocxDocument(data: any[], boardName: string): Document {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      text: `${boardName} - API 결과`,
      heading: HeadingLevel.TITLE,
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `생성 시각: ${new Date().toISOString()}`, break: 1 }),
        new TextRun({ text: `총 항목 수: ${data.length}`, break: 1 }),
      ],
    })
  );

  children.push(new Paragraph({ text: "" }));

  data.forEach((item, idx) => {
    // 항목 구분: 첫 번째가 아니면 페이지 나누기
    if (idx > 0) {
      children.push(
        new Paragraph({
          text: "",
          pageBreakBefore: true,
        })
      );
    }

    children.push(
      new Paragraph({
        text: `${idx + 1}번 항목`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 480, after: 240 },
      })
    );

    if (!item || typeof item !== "object") {
      children.push(new Paragraph({ text: safeStringify(item) }));
      children.push(new Paragraph({ text: "" }));
      return;
    }

    // 범용 API 데이터 렌더링 (모든 API 사이트 대응)
    renderApiDataItem(children, item);
  });

  return new Document({
    sections: [
      {
        children,
      },
    ],
  });
}

/**
 * 법령 문서용 DOCX 생성 (조-항-호 계층 구조 유지)
 * 원본 XML의 계층 구조를 살려서 가독성 있게 출력
 */
function buildLawDocxDocument(hierarchicalData: any[], boardName: string): Document {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      text: `${boardName} - 법령 조문`,
      heading: HeadingLevel.TITLE,
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `생성 시각: ${new Date().toISOString()}`, break: 1 }),
        new TextRun({ text: `총 법령 수: ${hierarchicalData.length}`, break: 1 }),
      ],
    })
  );

  children.push(new Paragraph({ text: "" }));

  hierarchicalData.forEach((lawData, idx) => {
    // 법령 구분: 첫 번째가 아니면 페이지 나누기
    if (idx > 0) {
      children.push(
        new Paragraph({
          text: "",
          pageBreakBefore: true,
        })
      );
    }

    // 법령 기본 정보
    const basicInfo = lawData["기본정보"] || lawData;
    const lawName = basicInfo["법령명한글"] || basicInfo["법령명_한글"] || `${idx + 1}번 법령`;
    const dept = basicInfo["소관부처명"] || basicInfo["소관부처"];
    const promDate = basicInfo["공포일자"];
    const enfDate = basicInfo["시행일자"];

    children.push(
      new Paragraph({
        text: String(lawName),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
      })
    );

    const infoLines: string[] = [];
    if (dept) infoLines.push(`소관부처: ${typeof dept === "object" ? dept["_"] || JSON.stringify(dept) : dept}`);
    if (promDate) infoLines.push(`공포일자: ${promDate}`);
    if (enfDate) infoLines.push(`시행일자: ${enfDate}`);

    if (infoLines.length > 0) {
      children.push(
        new Paragraph({
          text: infoLines.join("  |  "),
          spacing: { after: 200 },
        })
      );
    }

    children.push(
      new Paragraph({
        text: "━".repeat(60),
        spacing: { after: 300 },
      })
    );

    // 조문 렌더링
    const articles = lawData["조문"];
    if (articles && typeof articles === "object") {
      const articleUnits = articles["조문단위"];
      const unitArray = Array.isArray(articleUnits) ? articleUnits : (articleUnits ? [articleUnits] : []);

      for (const unit of unitArray) {
        renderLawArticleUnit(children, unit);
      }
    }

    // 부칙
    const addendum = lawData["부칙"];
    if (addendum) {
      children.push(new Paragraph({ text: "", spacing: { after: 300 } }));
      children.push(
        new Paragraph({
          text: "부  칙",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );
      renderLawComplexContent(children, addendum, 0);
    }

    // 별표
    const annex = lawData["별표"];
    if (annex) {
      children.push(new Paragraph({ text: "", spacing: { after: 300 } }));
      children.push(
        new Paragraph({
          text: "별  표",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 200 },
        })
      );
      renderLawComplexContent(children, annex, 0);
    }
  });

  return new Document({
    sections: [
      {
        children,
      },
    ],
  });
}

/**
 * 법령 조문 단위 렌더링 (조-항-호 연결)
 */
function renderLawArticleUnit(children: Paragraph[], unit: any): void {
  if (!unit || typeof unit !== "object") return;

  const articleNum = unit["조문번호"];
  const articleTitle = unit["조문제목"];
  const articleContent = unit["조문내용"];
  const articleType = unit["조문여부"]; // "조문" vs "전문" 등

  // 조문 제목 (예: "제1조 (목적)" 또는 "제1장 총칙")
  let heading = "";
  if (articleType === "전문" || articleType === "편문") {
    // 장/편 제목
    heading = articleContent || articleTitle || "";
  } else if (articleNum) {
    heading = `제${articleNum}조`;
    if (articleTitle) {
      heading += ` (${articleTitle})`;
    }
  }

  if (heading) {
    const isChapter = articleType === "전문" || articleType === "편문";
    children.push(
      new Paragraph({
        text: heading.trim(),
        heading: isChapter ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: isChapter ? 400 : 300, after: isChapter ? 200 : 150 },
      })
    );
  }

  // 조문 내용 (장/편이 아닌 경우만)
  if (articleContent && articleType !== "전문" && articleType !== "편문") {
    const content = String(articleContent).trim();
    if (content) {
      children.push(
        new Paragraph({
          text: content,
          indent: { left: 480 },
          spacing: { after: 150 },
        })
      );
    }
  }

  // 항 렌더링
  const paragraphs = unit["항"];
  if (paragraphs) {
    const paraArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
    for (const para of paraArray) {
      if (para && typeof para === "object") {
        const paraNum = para["항번호"] || "";
        const paraContent = para["항내용"] || "";
        if (paraContent) {
          children.push(
            new Paragraph({
              text: `${paraNum} ${paraContent}`.trim(),
              indent: { left: 720 },
              spacing: { before: 80, after: 80 },
            })
          );
        }
      }
    }
  }

  // 호 렌더링
  const clauses = unit["호"];
  if (clauses) {
    const clauseArray = Array.isArray(clauses) ? clauses : [clauses];
    for (const clause of clauseArray) {
      if (clause && typeof clause === "object") {
        const clauseNum = clause["호번호"] || "";
        const clauseContent = clause["호내용"] || "";
        if (clauseContent) {
          children.push(
            new Paragraph({
              text: `${clauseNum}. ${clauseContent}`.trim(),
              indent: { left: 960 },
              spacing: { before: 60, after: 60 },
            })
          );
        }

        // 목 렌더링
        const subClauses = clause["목"];
        if (subClauses) {
          const subArray = Array.isArray(subClauses) ? subClauses : [subClauses];
          for (const sub of subArray) {
            if (sub && typeof sub === "object") {
              const subNum = sub["목번호"] || "";
              const subContent = sub["목내용"] || "";
              if (subContent) {
                children.push(
                  new Paragraph({
                    text: `${subNum}) ${subContent}`.trim(),
                    indent: { left: 1200 },
                    spacing: { before: 40, after: 40 },
                  })
                );
              }
            }
          }
        }
      }
    }
  }

  // 조문 사이 여백
  children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
}

/**
 * 복잡한 법령 내용 렌더링 (부칙/별표 등)
 */
function renderLawComplexContent(children: Paragraph[], value: any, depth: number): void {
  if (!value) return;

  if (typeof value === "string") {
    children.push(
      new Paragraph({
        text: value.trim(),
        indent: { left: 360 * (depth + 1) },
        spacing: { after: 80 },
      })
    );
  } else if (Array.isArray(value)) {
    for (const v of value) {
      renderLawComplexContent(children, v, depth);
    }
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // 내부 배열/객체면 재귀
      if (Array.isArray(v) || (typeof v === "object" && v !== null)) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `【 ${k} 】`, bold: true })],
            indent: { left: 360 * depth },
            spacing: { before: 120, after: 80 },
          })
        );
        renderLawComplexContent(children, v, depth + 1);
      } else if (v !== null && v !== undefined) {
        children.push(
          new Paragraph({
            text: `${k}: ${v}`,
            indent: { left: 360 * (depth + 1) },
            spacing: { after: 60 },
          })
        );
      }
    }
  } else {
    children.push(
      new Paragraph({
        text: String(value),
        indent: { left: 360 * (depth + 1) },
        spacing: { after: 60 },
      })
    );
  }
}

/**
 * 범용 API 데이터 항목 렌더링
 * - 모든 API 사이트에 대응 가능한 범용 출력
 * - 배열 필드는 각 항목을 별도 문단으로 출력 (줄바꿈 + 간격)
 * - 단순 값은 키: 값 형태로 출력
 */
function renderApiDataItem(children: Paragraph[], item: any): void {
  if (!item || typeof item !== "object") {
    children.push(new Paragraph({ text: safeStringify(item) }));
    return;
  }

  // 필드 분류: 단순값 vs 배열
  const simpleFields: [string, any][] = [];
  const arrayFields: [string, any[]][] = [];

  for (const [key, value] of Object.entries(item)) {
    // 내부 메타 필드 제외
    if (key.startsWith("_")) continue;
    
    if (Array.isArray(value) && value.length > 0) {
      // 배열이 문자열/숫자만 담고 있고 길이가 적당하면 단순 필드로 취급
      const isSimpleArray = value.every(v => typeof v === "string" || typeof v === "number");
      const totalLen = value.reduce((sum, v) => sum + String(v).length, 0);
      
      if (isSimpleArray && value.length <= 5 && totalLen < 200) {
        simpleFields.push([key, value.join(", ")]);
      } else {
        arrayFields.push([key, value]);
      }
    } else if (value !== null && value !== undefined) {
      if (typeof value === "object") {
        // 객체는 JSON 문자열로 (단, 짧으면)
        const str = JSON.stringify(value);
        if (str.length < 200) {
          simpleFields.push([key, str]);
        } else {
          arrayFields.push([key, [value]]);
        }
      } else {
        simpleFields.push([key, value]);
      }
    }
  }

  // 1. 단순 필드 출력 (상단에 기본 정보로)
  if (simpleFields.length > 0) {
    for (const [key, value] of simpleFields) {
      const text = String(value);
      // 매우 긴 단순값은 줄바꿈 처리
      if (text.length > 500) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${key}:`, bold: true })],
            spacing: { before: 120, after: 60 },
          })
        );
        children.push(
          new Paragraph({
            text: text,
            indent: { left: 360 },
            spacing: { after: 120 },
          })
        );
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${key}: `, bold: true }),
              new TextRun({ text }),
            ],
            spacing: { after: 60 },
          })
        );
      }
    }
    
    // 구분선
    if (arrayFields.length > 0) {
      children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
      children.push(
        new Paragraph({
          text: "─".repeat(50),
          spacing: { after: 120 },
        })
      );
    }
  }

  // 2. 배열 필드 출력 (각 항목을 별도 문단으로)
  for (const [key, arr] of arrayFields) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `【 ${key} 】`, bold: true })],
        heading: HeadingLevel.HEADING_4,
        spacing: { before: 240, after: 120 },
      })
    );

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      let text: string;
      
      if (typeof item === "string") {
        text = item;
      } else if (typeof item === "number") {
        text = String(item);
      } else {
        text = JSON.stringify(item, null, 2);
      }

      if (!text || !text.trim()) continue;

      children.push(
        new Paragraph({
          text: text.trim(),
          indent: { left: 360 },
          spacing: { before: 80, after: 80 },
        })
      );
    }

    children.push(new Paragraph({ text: "", spacing: { after: 120 } }));
  }
}


// Excel 셀 텍스트 최대 길이 제한 (32,767자)
const EXCEL_CELL_TEXT_MAX = 32767;
const EXCEL_TRUNC_SUFFIX = "…(XLSX는 32767자 제한으로 일부 생략됨. 전체는 JSON 파일 참고)";

function toSafeExcelCellValue(value: any): any {
  if (value === null || value === undefined) return value;

  // 배열은 JSON 문자열로 변환 (조문 등 대용량 가능)
  let v = value;
  if (Array.isArray(v)) {
    try {
      v = JSON.stringify(v);
    } catch {
      v = String(v);
    }
  }

  // 객체는 JSON 문자열로 변환
  if (typeof v === "object") {
    try {
      v = JSON.stringify(v);
    } catch {
      v = String(v);
    }
  }

  if (typeof v === "string" && v.length > EXCEL_CELL_TEXT_MAX) {
    const keep = Math.max(0, EXCEL_CELL_TEXT_MAX - EXCEL_TRUNC_SUFFIX.length);
    return v.slice(0, keep) + EXCEL_TRUNC_SUFFIX;
  }

  return v;
}

/**
 * 중첩된 값 가져오기
 */
function getNestedValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * 중첩 객체를 평탄화
 */
function flattenObject(obj: any, prefix: string = ""): Record<string, any> {
  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else {
      // Excel 셀 제한 대응
      result[newKey] = toSafeExcelCellValue(value);
    }
  }
  
  return result;
}

/**
 * 열 너비 계산
 */
function calculateColumnWidths(data: any[]): { wch: number }[] {
  if (data.length === 0) return [];
  
  const keys = Object.keys(data[0]);
  return keys.map((key) => {
    // 헤더 길이
    let maxLen = key.length;
    
    // 데이터 길이 확인
    for (const item of data) {
      const value = item[key];
      if (value !== null && value !== undefined) {
        const strLen = String(value).length;
        maxLen = Math.max(maxLen, Math.min(strLen, 50)); // 최대 50자
      }
    }
    
    return { wch: Math.max(maxLen + 2, 10) };
  });
}

/**
 * 테스트 결과 파일 삭제 (API)
 */
export function cleanupApiTestFiles(
  outputDir: string
): { success: boolean; deleted: string[]; errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(outputDir)) {
    return { success: true, deleted, errors };
  }

  try {
    const files = fs.readdirSync(outputDir);
    for (const file of files) {
      if (file.endsWith(".xlsx") || file.endsWith(".json")) {
        const filePath = path.join(outputDir, file);
        try {
          // 임시 파일(~$로 시작하는 파일) 제외
          if (!file.startsWith("~$")) {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
          }
        } catch (err) {
          errors.push(`파일 삭제 실패: ${filePath}`);
        }
      }
    }
  } catch (err) {
    errors.push(`디렉토리 접근 실패: ${outputDir}`);
  }

  return {
    success: errors.length === 0,
    deleted,
    errors,
  };
}
