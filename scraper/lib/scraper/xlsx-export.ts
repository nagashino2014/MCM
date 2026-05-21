/**
 * 스크래핑 데이터 내보내기 유틸리티
 * 
 * 스크래핑된 게시글 제목/본문을 JSON 또는 XLSX 파일로 저장합니다.
 * JSON 형식은 텍스트 추출 단계 없이 바로 ExtractedData에 저장됩니다.
 */

import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { storage } from "@/lib/storage";

export interface ScrapedArticle {
  title: string;
  link: string;
  date?: string;
  content: string;
  attachments?: { fileName: string; downloadUrl: string }[];
}

export interface ExportResult {
  success: boolean;
  filePath: string;
  error?: string;
}

/**
 * 스크래핑된 기사 데이터를 XLSX 파일로 저장
 * 
 * @param articles 스크래핑된 기사 배열
 * @param boardName 보드 이름 (파일명에 사용)
 * @param outputDir 출력 디렉토리 경로
 * @returns 저장 결과
 */
export function exportToXlsx(
  articles: ScrapedArticle[],
  boardName: string,
  outputDir: string
): ExportResult {
  try {
    // 출력 디렉토리 생성
    fs.mkdirSync(outputDir, { recursive: true });

    // 파일명 생성: {일자}_{보드명}_제목&본문.xlsx
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    const safeboardName = boardName.replace(/[\\/:*?"<>|]/g, "_");
    const fileName = `${dateStr}_${safeboardName}_제목&본문.xlsx`;
    const filePath = path.join(outputDir, fileName);

    // 워크북 생성
    const workbook = XLSX.utils.book_new();

    // 시트 1: 게시글 목록 (제목, 날짜, 링크)
    const titleData = articles.map((article, idx) => ({
      "번호": idx + 1,
      "제목": article.title,
      "게시일": article.date || "",
      "URL": article.link,
    }));
    const titleSheet = XLSX.utils.json_to_sheet(titleData);
    
    // 열 너비 설정
    titleSheet["!cols"] = [
      { wch: 6 },   // 번호
      { wch: 60 },  // 제목
      { wch: 12 },  // 게시일
      { wch: 80 },  // URL
    ];
    
    XLSX.utils.book_append_sheet(workbook, titleSheet, "게시글 목록");

    // 시트 2: 본문 목록 (번호, 제목, 본문)
    // Excel 셀 최대 문자 수: 32,767자 → 초과 시 잘라냄
    const EXCEL_MAX_CELL_LENGTH = 32767;
    const contentData = articles.map((article, idx) => {
      let content = article.content || "(본문 없음)";
      if (content.length > EXCEL_MAX_CELL_LENGTH) {
        content = content.slice(0, EXCEL_MAX_CELL_LENGTH - 30) + "\n\n... (본문이 너무 길어 일부 생략됨)";
      }
      return {
        "번호": idx + 1,
        "제목": article.title,
        "본문": content,
      };
    });
    const contentSheet = XLSX.utils.json_to_sheet(contentData);
    
    // 열 너비 설정
    contentSheet["!cols"] = [
      { wch: 6 },   // 번호
      { wch: 60 },  // 제목
      { wch: 150 }, // 본문
    ];
    
    XLSX.utils.book_append_sheet(workbook, contentSheet, "본문 목록");

    // 파일 저장
    XLSX.writeFile(workbook, filePath);

    return {
      success: true,
      filePath,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      filePath: "",
      error: errorMsg,
    };
  }
}

/**
 * 스크래핑된 기사 데이터를 JSON 파일로 저장
 * 
 * ExtractedData 파이프라인과 호환되는 형식으로 저장하여
 * 텍스트 추출 단계 없이 바로 청킹/RAG 파이프라인에서 사용 가능합니다.
 * 
 * @param articles 스크래핑된 기사 배열
 * @param boardName 보드 이름
 * @param orgName 기관 이름
 * @param boardId 보드 ID (메타데이터용)
 * @returns 저장 결과
 */
export async function exportToJson(
  articles: ScrapedArticle[],
  boardName: string,
  orgName: string,
  boardId?: string
): Promise<ExportResult> {
  try {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0].replace(/-/g, "");
    const monthStr = today.toISOString().slice(0, 7); // YYYY-MM

    const safeOrgName = orgName.replace(/[\\/:*?"<>|]/g, "_");
    const safeBoardName = boardName.replace(/[\\/:*?"<>|]/g, "_");

    // storage 추상화 레이어용 키: ExtractedData/{기관명}/{보드명}/{YYYY-MM}/{파일명}
    const fileName = `${dateStr}_${safeBoardName}_제목&본문.json`;
    const storageKey = `ExtractedData/${safeOrgName}/${safeBoardName}/${monthStr}/${fileName}`;

    // 본문 텍스트 생성 (청킹 파이프라인 호환용)
    const textParts: string[] = [];
    for (const article of articles) {
      textParts.push(`## ${article.title}`);
      if (article.date) textParts.push(`게시일: ${article.date}`);
      if (article.link) textParts.push(`URL: ${article.link}`);
      textParts.push("");
      textParts.push(article.content || "(본문 없음)");
      textParts.push("");
      textParts.push("---");
      textParts.push("");
    }
    const fullText = textParts.join("\n");

    // ExtractedData 파이프라인 호환 JSON 형식
    const jsonData = {
      metadata: {
        source: "web_scraping",
        board_id: boardId || "",
        board_name: boardName,
        org_name: orgName,
        source_file: storageKey,
        file_format: "scraping_json",
        status: "completed",
        articles_count: articles.length,
        char_count: fullText.length,
        extraction_method: "web_scraping",
        extracted_at: today.toISOString(),
        storage_backend: storage.backend,
      },
      content: {
        text: fullText,
        text_length: fullText.length,
      },
      articles: articles.map((article, idx) => ({
        index: idx + 1,
        title: article.title,
        date: article.date || "",
        url: article.link,
        content: article.content || "",
        attachments: article.attachments || [],
      })),
    };

    const jsonString = JSON.stringify(jsonData, null, 2);
    await storage.upload(storageKey, jsonString, "application/json");

    // 로컬 경로 (호환성용): local 모드에서는 resolveLocalPath로 해석됨
    const cwd = process.cwd();
    const localPath = path.join(cwd, "save", storageKey);

    return {
      success: true,
      filePath: storage.backend === "r2" ? storageKey : localPath,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      filePath: "",
      error: errorMsg,
    };
  }
}

/**
 * 테스트 결과 파일 삭제
 * 
 * @param dataFilePath 삭제할 데이터 파일 경로 (JSON 또는 XLSX 파일, 또는 디렉토리 경로)
 * @param attachmentDir 삭제할 첨부파일 디렉토리
 */
export function cleanupTestFiles(
  dataFilePath?: string,
  attachmentDir?: string
): { success: boolean; deleted: string[]; errors: string[] } {
  const deleted: string[] = [];
  const errors: string[] = [];

  // 데이터 파일 삭제 - 파일 경로 또는 디렉토리 경로 모두 지원
  if (dataFilePath) {
    try {
      if (fs.existsSync(dataFilePath)) {
        const stat = fs.statSync(dataFilePath);
        
        if (stat.isFile()) {
          // 단일 파일 삭제
          fs.unlinkSync(dataFilePath);
          deleted.push(dataFilePath);
        } else if (stat.isDirectory()) {
          // 디렉토리인 경우 XLSX/JSON 파일 삭제
          const files = fs.readdirSync(dataFilePath);
          for (const file of files) {
            if (file.endsWith('.xlsx') || file.endsWith('.xls') || file.endsWith('.json')) {
              const filePath = path.join(dataFilePath, file);
              try {
                // 임시 파일(~$로 시작하는 파일) 제외
                if (!file.startsWith('~$')) {
                  fs.unlinkSync(filePath);
                  deleted.push(filePath);
                }
              } catch (err) {
                errors.push(`파일 삭제 실패: ${filePath}`);
              }
            }
          }
        }
      }
    } catch (err) {
      errors.push(`파일 삭제 실패: ${dataFilePath}`);
    }
  }

  // 첨부파일 디렉토리 내 파일만 삭제 (폴더는 유지)
  if (attachmentDir && fs.existsSync(attachmentDir)) {
    try {
      const files = fs.readdirSync(attachmentDir);
      for (const file of files) {
        const filePath = path.join(attachmentDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            fs.unlinkSync(filePath);
            deleted.push(filePath);
          } else if (stat.isDirectory()) {
            // 하위 디렉토리는 재귀적으로 내용만 삭제
            const subFiles = fs.readdirSync(filePath);
            for (const subFile of subFiles) {
              const subFilePath = path.join(filePath, subFile);
              try {
                fs.unlinkSync(subFilePath);
                deleted.push(subFilePath);
              } catch (subErr) {
                errors.push(`파일 삭제 실패: ${subFilePath}`);
              }
            }
          }
        } catch (err) {
          errors.push(`파일 삭제 실패: ${filePath}`);
        }
      }
      // 폴더는 삭제하지 않음 (유지)
    } catch (err) {
      errors.push(`디렉토리 접근 실패: ${attachmentDir}`);
    }
  }

  return {
    success: errors.length === 0,
    deleted,
    errors,
  };
}
