/**
 * 범용 스크래퍼 데이터 저장소 (SQLite via sql.js)
 * 
 * 역할:
 * - 스크래핑된 문서 저장/조회
 * - 첨부파일 메타데이터 관리
 * - 수집 이력 로깅
 * - 중복 제거 (dedup)
 */

import initSqlJs, { Database } from "sql.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// ============================================================
// 타입 정의
// ============================================================

export interface ScrapedDocument {
  doc_id: string;
  board_id: string;
  org_id: string;
  title: string;
  content: string;
  published_date: string | null;
  source_url: string;
  scraped_at: string;
  updated_at: string;
  metadata?: Record<string, unknown>;
}

export interface AttachmentRecord {
  file_id: string;
  doc_id: string;
  file_name: string;
  file_type: string;
  file_size: number | null;
  download_url: string;
  local_path: string | null;
  downloaded_at: string | null;
  status: "pending" | "downloaded" | "failed";
}

export interface ScrapeLog {
  log_id: string;
  board_id: string;
  schedule_id: string | null;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed" | "partial";
  docs_scraped: number;
  docs_skipped: number;
  docs_failed: number;
  pages_processed: number;
  error_message: string | null;
}

export type DedupKeyType = "url" | "id" | "hash";

// ============================================================
// 데이터베이스 초기화
// ============================================================

function getDbPath(): string {
  // 환경 변수 우선: IEPS 통합 CLI 등에서 강제 지정 가능
  if (process.env.SCRAPER_DB_PATH) {
    const envPath = process.env.SCRAPER_DB_PATH;
    const envDir = path.dirname(envPath);
    if (!fs.existsSync(envDir)) {
      fs.mkdirSync(envDir, { recursive: true });
    }
    return envPath;
  }

  const cwd = process.cwd();
  const cwdName = path.basename(cwd).toLowerCase();
  const isFrontendCwd = cwdName === "frontend";
  const isScraperCwd = cwdName === "scraper";

  let dataDir: string;
  if (isFrontendCwd) {
    dataDir = path.join(cwd, "data");
  } else if (isScraperCwd) {
    // MCM/scraper 디렉터리: 인접한 MCM/data/ieps 디렉터리를 사용
    const iepsDir = path.join(path.dirname(cwd), "data", "ieps");
    dataDir = iepsDir;
  } else {
    const frontendDir = path.join(cwd, "frontend");
    const mcmIepsDir = path.join(cwd, "data", "ieps");
    if (fs.existsSync(mcmIepsDir) && fs.statSync(mcmIepsDir).isDirectory()) {
      dataDir = mcmIepsDir;
    } else if (fs.existsSync(frontendDir) && fs.statSync(frontendDir).isDirectory()) {
      dataDir = path.join(frontendDir, "data");
    } else {
      dataDir = path.join(cwd, "data");
    }
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // MCM IEPS 데이터 디렉터리에서는 db.sqlite, 그 외 환경은 기존 scraper.db 유지
  const dbName = path.basename(dataDir) === "ieps" ? "db.sqlite" : "scraper.db";
  return path.join(dataDir, dbName);
}

let dbInstance: Database | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function initSQL() {
  if (!SQL) {
    SQL = await initSqlJs();
  }
  return SQL;
}

export async function getDbAsync(): Promise<Database> {
  if (!dbInstance) {
    const SqlJs = await initSQL();
    const dbPath = getDbPath();
    
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      dbInstance = new SqlJs.Database(fileBuffer);
    } else {
      dbInstance = new SqlJs.Database();
    }
    
    initSchema(dbInstance);
  }
  return dbInstance;
}

// 동기 버전 (이미 초기화된 경우에만 사용)
export function getDb(): Database {
  if (!dbInstance) {
    throw new Error("Database not initialized. Call getDbAsync() first.");
  }
  return dbInstance;
}

function saveDbToFile() {
  if (dbInstance) {
    const dbPath = getDbPath();
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
}

/** sql.js 메모리 DB를 디스크에 명시적으로 flush. (외부 모듈에서 IEPS 전용 INSERT 후 호출) */
export function flushDbToDisk(): void {
  saveDbToFile();
}

function initSchema(db: Database): void {
  // documents 테이블: 스크래핑된 문서
  db.run(`
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      published_date TEXT,
      source_url TEXT NOT NULL,
      scraped_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT DEFAULT '{}'
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_board ON documents(board_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(published_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(source_url)`);

  // attachments 테이블: 첨부파일 메타데이터
  db.run(`
    CREATE TABLE IF NOT EXISTS attachments (
      file_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT DEFAULT '',
      file_size INTEGER,
      download_url TEXT NOT NULL,
      local_path TEXT,
      downloaded_at TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_doc ON attachments(doc_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(status)`);

  // scrape_logs 테이블: 수집 이력
  db.run(`
    CREATE TABLE IF NOT EXISTS scrape_logs (
      log_id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      schedule_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT DEFAULT 'running',
      docs_scraped INTEGER DEFAULT 0,
      docs_skipped INTEGER DEFAULT 0,
      docs_failed INTEGER DEFAULT 0,
      pages_processed INTEGER DEFAULT 0,
      error_message TEXT
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_board ON scrape_logs(board_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_status ON scrape_logs(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_started ON scrape_logs(started_at)`);

  // ──────────────────────────────────────────────────────────
  // IEPS 통합환경허가 전용 테이블 (MCM 라운드 1)
  // ──────────────────────────────────────────────────────────

  // facilities: 사업장 마스터
  db.run(`
    CREATE TABLE IF NOT EXISTS facilities (
      facility_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      business_registration_no TEXT,
      site_address TEXT,
      phone_number TEXT,
      industry_code TEXT,
      industry_name TEXT,
      normalized_company_name TEXT,
      normalized_address TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  // 동일 사업자번호/상호를 여러 소재지 공장이 공유하는 경우가 있어 주소까지 식별키에 포함한다.
  db.run(`DROP INDEX IF EXISTS idx_facilities_brn`);
  db.run(`DROP INDEX IF EXISTS idx_facilities_brn_company`);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_facilities_brn_company_address
    ON facilities(business_registration_no, normalized_company_name, normalized_address)
    WHERE business_registration_no IS NOT NULL
      AND normalized_company_name IS NOT NULL
      AND normalized_address IS NOT NULL
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_company ON facilities(normalized_company_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_address ON facilities(normalized_address)`);

  // permits: 허가 단위 (결정번호별)
  db.run(`
    CREATE TABLE IF NOT EXISTS permits (
      permit_id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL,
      decision_no TEXT,
      permit_type TEXT,
      permit_date TEXT,
      is_first_permit INTEGER DEFAULT 0,
      source_doc_id TEXT,
      source_attachment_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_permits_decision ON permits(decision_no)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_permits_facility ON permits(facility_id)`);

  // permit_scales: 종 규모 (대기/수질)
  db.run(`
    CREATE TABLE IF NOT EXISTS permit_scales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permit_id TEXT NOT NULL,
      air_class INTEGER,
      air_amount_ton_per_year REAL,
      water_class INTEGER,
      wastewater_amount_m3_per_day REAL,
      source_page INTEGER,
      source_text TEXT,
      FOREIGN KEY (permit_id) REFERENCES permits(permit_id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_permit_scales_permit ON permit_scales(permit_id)`);

  // product_outputs: 생산품 정보
  db.run(`
    CREATE TABLE IF NOT EXISTS product_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      permit_id TEXT NOT NULL,
      product_name TEXT,
      production_amount REAL,
      production_unit TEXT,
      source_page INTEGER,
      source_text TEXT,
      FOREIGN KEY (permit_id) REFERENCES permits(permit_id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_product_outputs_permit ON product_outputs(permit_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS legal_entities (
      entity_id TEXT PRIMARY KEY,
      entity_name TEXT NOT NULL,
      business_registration_no TEXT,
      address TEXT,
      phone_number TEXT,
      memo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_legal_entities_name ON legal_entities(entity_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_legal_entities_brn ON legal_entities(business_registration_no)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_operating_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'operating_entity',
      started_at TEXT,
      ended_at TEXT,
      is_primary INTEGER NOT NULL DEFAULT 1,
      memo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES legal_entities(entity_id) ON DELETE RESTRICT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_operating_entities_facility ON facility_operating_entities(facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_operating_entities_entity ON facility_operating_entities(entity_id)`);
  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_operating_entities_primary
      ON facility_operating_entities(facility_id, relation_type)
      WHERE ended_at IS NULL AND is_primary = 1
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS contracts (
      contract_id TEXT PRIMARY KEY,
      facility_id TEXT,
      counterparty_entity_id TEXT NOT NULL,
      operating_relation_id INTEGER,
      contract_title TEXT NOT NULL,
      service_type TEXT,
      contract_status TEXT NOT NULL DEFAULT 'draft',
      contract_amount REAL,
      started_at TEXT,
      ended_at TEXT,
      memo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
      FOREIGN KEY (counterparty_entity_id) REFERENCES legal_entities(entity_id) ON DELETE RESTRICT,
      FOREIGN KEY (operating_relation_id) REFERENCES facility_operating_entities(id) ON DELETE SET NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_contracts_facility ON contracts(facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_contracts_counterparty ON contracts(counterparty_entity_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(contract_status)`);

  // facility_annual_reports: 사업장당 가장 최근 연간(점검)보고서 1건의 스냅샷.
  //   permits 는 "허가" 단위이므로 연간보고서를 별도 permit 행으로 적재하면
  //   같은 사업장에 가짜 허가가 매년 누적되는 구조 문제가 있다.
  //   대신 facility_id 를 PK 로 잡아 1:1 로 보존하고, 더 최근 보고서가 들어오면 덮어쓴다.
  //   product_outputs_json 은 [{name, amount, unit}, ...] 배열을 JSON 으로 직렬화.
  db.run(`
    CREATE TABLE IF NOT EXISTS facility_annual_reports (
      facility_id TEXT PRIMARY KEY,
      report_year INTEGER,
      air_class INTEGER,
      air_amount_ton_per_year REAL,
      water_class INTEGER,
      wastewater_amount_m3_per_day REAL,
      product_outputs_json TEXT,
      source_doc_id TEXT,
      source_attachment_id TEXT,
      source_pdf_path TEXT,
      source_page_scale INTEGER,
      source_page_product INTEGER,
      parsed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_far_year ON facility_annual_reports(report_year)`);

  // parsed_fields: 검토결과서 PDF에서 추출된 모든 필드 (검수 대기열 데이터 소스)
  // - 신규 DB: error / file_name / pdf_path 컬럼 포함하여 생성.
  //   기존 DB: ensureParsedFieldsColumns() 가 ALTER 로 보강.
  // - file_name / pdf_path 는 attachments 테이블의 file_id (=`file_<docId>_<hash>`)와
  //   parsed_fields.attachment_id (=`att_<sha256(postId|fileName)>`) 가 다른 알고리즘으로
  //   생성되어 JOIN 이 깨지는 문제를 우회하기 위해 직접 적재한다.
  db.run(`
    CREATE TABLE IF NOT EXISTS parsed_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attachment_id TEXT NOT NULL,
      doc_id TEXT,
      rule_id TEXT NOT NULL,
      field_label TEXT NOT NULL,
      raw_value TEXT,
      normalized_value TEXT,
      source_page INTEGER,
      source_text TEXT,
      confidence REAL DEFAULT 0,
      needs_review INTEGER DEFAULT 0,
      reviewed_value TEXT,
      error TEXT,
      file_name TEXT,
      pdf_path TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (attachment_id) REFERENCES attachments(file_id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_parsed_fields_attachment ON parsed_fields(attachment_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_parsed_fields_review ON parsed_fields(needs_review)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_parsed_fields_rule ON parsed_fields(rule_id)`);
  ensureParsedFieldsColumns(db);

  // collection_configs: 수집 옵션 카드의 CollectionConfig JSON 저장소
  db.run(`
    CREATE TABLE IF NOT EXISTS collection_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_collection_configs_default ON collection_configs(is_default)`);

  // ──────────────────────────────────────────────────────────
  // 라운드 2A: RBAC 인증 + 마스터 변경 이력 + facilities 확장 컬럼
  // ──────────────────────────────────────────────────────────

  // users: RBAC 사용자
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);

  // audit_log: 마스터 변경 이력
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_table, target_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_merge_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_facility_id TEXT NOT NULL,
      source_facility_id TEXT NOT NULL,
      previous_company_name TEXT,
      previous_business_registration_no TEXT,
      merge_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_merge_aliases_target ON facility_merge_aliases(target_facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_merge_aliases_source ON facility_merge_aliases(source_facility_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_permit_successions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_facility_id TEXT NOT NULL,
      source_facility_id TEXT NOT NULL,
      permit_id TEXT NOT NULL,
      decision_no TEXT,
      permit_type TEXT,
      permit_date TEXT,
      previous_company_name TEXT,
      previous_business_registration_no TEXT,
      merge_reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_target ON facility_permit_successions(target_facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_source ON facility_permit_successions(source_facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_permit_successions_permit ON facility_permit_successions(permit_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_history_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT,
      previous_company_name TEXT,
      new_company_name TEXT,
      previous_business_registration_no TEXT,
      new_business_registration_no TEXT,
      previous_group_name TEXT,
      new_group_name TEXT,
      related_company_name TEXT,
      source_facility_id TEXT,
      memo TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL,
      created_by TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_history_events_facility ON facility_history_events(facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_history_events_type ON facility_history_events(event_type)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_merge_exclusions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_type TEXT NOT NULL,
      match_value TEXT,
      facility_ids_key TEXT NOT NULL,
      facility_ids_json TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT,
      UNIQUE(match_type, facility_ids_key)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_merge_exclusions_match ON facility_merge_exclusions(match_type, facility_ids_key)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_groups (
      group_id TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      logo_path TEXT,
      total_revenue REAL,
      employee_count INTEGER,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_groups_name ON facility_groups(group_name)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_group_divisions (
      division_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      division_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_group_divisions_group ON facility_group_divisions(group_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_group_companies (
      company_id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      division_id TEXT,
      company_name TEXT NOT NULL,
      business_registration_no TEXT,
      address TEXT,
      phone_number TEXT,
      logo_path TEXT,
      group_role TEXT NOT NULL DEFAULT 'affiliate',
      is_headquarters INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_group_companies_group ON facility_group_companies(group_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_group_companies_division ON facility_group_companies(division_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_group_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL UNIQUE,
      group_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'site',
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_group_memberships_group ON facility_group_memberships(group_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_group_memberships_company ON facility_group_memberships(company_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_type TEXT,
      note TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_aliases_facility ON facility_aliases(facility_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_service_categories (
      facility_id TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT,
      PRIMARY KEY (facility_id, category)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_service_categories_category ON facility_service_categories(category)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_manual_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      amount REAL,
      unit TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_manual_products_facility ON facility_manual_products(facility_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_contact_main_numbers (
      facility_id TEXT PRIMARY KEY,
      phone_number TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_contact_departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      department_name TEXT NOT NULL,
      phone_number TEXT,
      fax_number TEXT,
      duties TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_departments_facility ON facility_contact_departments(facility_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_contact_people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      department_id INTEGER,
      person_name TEXT NOT NULL,
      title TEXT,
      office_phone TEXT,
      mobile_phone TEXT,
      email TEXT,
      duties TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      appointed_at TEXT,
      transferred_at TEXT,
      resigned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_people_facility ON facility_contact_people(facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_people_department ON facility_contact_people(department_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS facility_contact_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      facility_id TEXT NOT NULL,
      department_id INTEGER,
      person_id INTEGER,
      event_type TEXT NOT NULL,
      event_date TEXT,
      memo TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_facility ON facility_contact_logs(facility_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_department ON facility_contact_logs(department_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facility_contact_logs_person ON facility_contact_logs(person_id)`);

  // facilities 확장 컬럼 (ALTER TABLE — 컬럼 존재 시 skip)
  ensureFacilityColumns(db);

  // attachments 확장 컬럼 — 라운드 2C 다운로드 가시성
  ensureAttachmentColumns(db);

  // product_outputs 확장 컬럼 — 업종 항목에 부속된 생산품의 출처 추적용 source_industry_code
  ensureProductOutputsColumns(db);

  // 라운드 3 — 운영 관측 (download_events / alerts)
  ensureOpsTables(db);

  saveDbToFile();
}

/**
 * facilities 확장 컬럼이 없으면 ALTER TABLE 로 추가한다.
 * 라운드 2A에서 region_sido / region_sigungu / source / memo 4개 컬럼을 추가.
 * 기존 db 파일과 호환되도록 컬럼 존재 여부를 체크한다.
 */
function ensureFacilityColumns(db: Database): void {
  let existing: Set<string>;
  try {
    const rows = db.exec("PRAGMA table_info(facilities)");
    existing = new Set<string>();
    if (rows.length > 0) {
      for (const r of rows[0].values) {
        // PRAGMA table_info: cid, name, type, notnull, dflt_value, pk
        existing.add(String(r[1]));
      }
    }
  } catch {
    return;
  }

  const additions: { col: string; ddl: string }[] = [
    { col: "region_sido", ddl: "ALTER TABLE facilities ADD COLUMN region_sido TEXT" },
    { col: "region_sigungu", ddl: "ALTER TABLE facilities ADD COLUMN region_sigungu TEXT" },
    {
      col: "source",
      ddl: "ALTER TABLE facilities ADD COLUMN source TEXT NOT NULL DEFAULT 'ieps'",
    },
    { col: "memo", ddl: "ALTER TABLE facilities ADD COLUMN memo TEXT" },
    // source_doc_type — facility 컬럼들이 어느 문서 종류에서 채워졌는지 기록.
    // 카테고리별 파싱 잡의 신뢰도 우선순위 적용용:
    //   'review_report' (검토결과서) > 'annual_report' (연간보고서) > 'manual'
    // 새 잡이 더 낮은 신뢰도면 NULL 결손 컬럼만 보강하고, 같거나 높으면 모두 갱신한다.
    {
      col: "source_doc_type",
      ddl: "ALTER TABLE facilities ADD COLUMN source_doc_type TEXT",
    },
    { col: "logo_path", ddl: "ALTER TABLE facilities ADD COLUMN logo_path TEXT" },
    { col: "company_size", ddl: "ALTER TABLE facilities ADD COLUMN company_size TEXT" },
  ];
  for (const { col, ddl } of additions) {
    if (!existing.has(col)) {
      try {
        db.run(ddl);
      } catch (err) {
        console.warn(`[DB] ALTER facilities ADD ${col} 실패: ${(err as Error).message}`);
      }
    }
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_sido ON facilities(region_sido)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_sigungu ON facilities(region_sigungu)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_source ON facilities(source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_company_size ON facilities(company_size)`);
  db.run(`DROP INDEX IF EXISTS idx_facilities_brn`);
  db.run(`DROP INDEX IF EXISTS idx_facilities_brn_company`);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_facilities_brn_company_address
    ON facilities(business_registration_no, normalized_company_name, normalized_address)
    WHERE business_registration_no IS NOT NULL
      AND normalized_company_name IS NOT NULL
      AND normalized_address IS NOT NULL
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_facilities_address ON facilities(normalized_address)`);
}

/**
 * attachments 확장 컬럼이 없으면 ALTER TABLE 로 추가한다.
 * 라운드 2C 에서 다운로드 방식 / 재시도 / 마지막 에러를 영속화한다.
 */
function ensureAttachmentColumns(db: Database): void {
  let existing: Set<string>;
  try {
    const rows = db.exec("PRAGMA table_info(attachments)");
    existing = new Set<string>();
    if (rows.length > 0) {
      for (const r of rows[0].values) {
        existing.add(String(r[1]));
      }
    }
  } catch {
    return;
  }

  const additions: { col: string; ddl: string }[] = [
    { col: "download_method", ddl: "ALTER TABLE attachments ADD COLUMN download_method TEXT" },
    {
      col: "download_attempts",
      ddl: "ALTER TABLE attachments ADD COLUMN download_attempts INTEGER NOT NULL DEFAULT 0",
    },
    { col: "last_error", ddl: "ALTER TABLE attachments ADD COLUMN last_error TEXT" },
  ];
  for (const { col, ddl } of additions) {
    if (!existing.has(col)) {
      try {
        db.run(ddl);
      } catch (err) {
        console.warn(`[DB] ALTER attachments ADD ${col} 실패: ${(err as Error).message}`);
      }
    }
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_method ON attachments(download_method)`);
}

/**
 * product_outputs 확장 컬럼이 없으면 ALTER TABLE 로 추가한다.
 *
 * `source_industry_code` — 이 생산품이 어떤 KSIC 업종 항목 옆 괄호에서 추출되었는지 추적.
 * "주요 생산품" 섹션에서 정상 추출된 항목은 NULL, 업종 항목 부속에서 추출된 항목만 채워짐.
 * 통계/검색 시 "업종 옆에 명시된 생산품 vs 본문 생산품" 을 구분하고 싶을 때 사용.
 */
function ensureProductOutputsColumns(db: Database): void {
  let existing: Set<string>;
  try {
    const rows = db.exec("PRAGMA table_info(product_outputs)");
    existing = new Set<string>();
    if (rows.length > 0) {
      for (const r of rows[0].values) {
        existing.add(String(r[1]));
      }
    }
  } catch {
    return;
  }
  if (!existing.has("source_industry_code")) {
    try {
      db.run("ALTER TABLE product_outputs ADD COLUMN source_industry_code TEXT");
    } catch (err) {
      console.warn(
        `[DB] ALTER product_outputs ADD source_industry_code 실패: ${(err as Error).message}`
      );
    }
  }
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_product_outputs_source_industry ON product_outputs(source_industry_code)`
  );
}

/**
 * parsed_fields 확장 컬럼이 없으면 ALTER TABLE 로 추가한다.
 * 검수 대기열 진단 익스포트에서 백엔드의 ParsedField.error("값을 찾지 못함",
 * "정규식 매칭 실패" 등) 메시지를 그대로 노출하기 위해 추가된 컬럼이다.
 */
function ensureParsedFieldsColumns(db: Database): void {
  let existing: Set<string>;
  try {
    const rows = db.exec("PRAGMA table_info(parsed_fields)");
    existing = new Set<string>();
    if (rows.length > 0) {
      for (const r of rows[0].values) {
        existing.add(String(r[1]));
      }
    }
  } catch {
    return;
  }

  const additions: { col: string; ddl: string }[] = [
    { col: "error", ddl: "ALTER TABLE parsed_fields ADD COLUMN error TEXT" },
    // 식별자 불일치(parsed_fields.attachment_id ≠ attachments.file_id) 회피용 — 파싱 시점에
    // 파일명/원본 경로를 그대로 저장해 검수 대기열 진단에서 LEFT JOIN 없이 즉시 노출한다.
    { col: "file_name", ddl: "ALTER TABLE parsed_fields ADD COLUMN file_name TEXT" },
    { col: "pdf_path", ddl: "ALTER TABLE parsed_fields ADD COLUMN pdf_path TEXT" },
  ];
  for (const { col, ddl } of additions) {
    if (!existing.has(col)) {
      try {
        db.run(ddl);
      } catch (err) {
        console.warn(`[DB] ALTER parsed_fields ADD ${col} 실패: ${(err as Error).message}`);
      }
    }
  }
}

/**
 * 라운드 3 — 운영 관측: download_events / alerts 테이블 멱등 생성.
 * cli-collect 가 시도 단위 이벤트를 누적하고, 임계값 초과 시 인앱 알람을 INSERT 한다.
 */
function ensureOpsTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS download_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id TEXT,
      download_url TEXT,
      method TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_no INTEGER NOT NULL,
      bytes INTEGER,
      error TEXT,
      job_id TEXT,
      occurred_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_download_events_time ON download_events(occurred_at)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_download_events_method_status ON download_events(method, status)`
  );
  db.run(`CREATE INDEX IF NOT EXISTS idx_download_events_job ON download_events(job_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL,
      source TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      payload_json TEXT,
      job_id TEXT,
      created_at TEXT NOT NULL,
      acknowledged_at TEXT,
      acknowledged_by TEXT
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(acknowledged_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity)`);
}

// ============================================================
// 중복 제거 (Deduplication)
// ============================================================

/**
 * 중복 제거용 문서 ID 생성
 */
export function generateDocId(
  item: { title: string; link: string; date?: string; content?: string },
  boardId: string,
  dedupKey: DedupKeyType = "url"
): string {
  let seed: string;

  switch (dedupKey) {
    case "url":
      seed = normalizeUrl(item.link);
      break;
    case "id":
      const extractedId = extractPostId(item.link);
      seed = extractedId ? `${boardId}:${extractedId}` : normalizeUrl(item.link);
      break;
    case "hash":
      const contentPreview = (item.content || "").slice(0, 200);
      seed = `${item.title}|${item.date || ""}|${contentPreview}`;
      break;
    default:
      seed = normalizeUrl(item.link);
  }

  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return `doc_${boardId}_${hash}`;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.protocol = "https:";
    u.hostname = u.hostname.replace(/^www\./, "");
    
    const params = Array.from(u.searchParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = "";
    for (const [k, v] of params) {
      u.searchParams.append(k, v);
    }
    
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    
    return result;
  } catch {
    return url;
  }
}

function extractPostId(url: string): string | null {
  try {
    const u = new URL(url);
    const idParams = ["seq", "id", "no", "idx", "num", "sn", "bbsId", "nttId", "articleSeq"];
    for (const param of idParams) {
      const value = u.searchParams.get(param);
      if (value && /^\d+$/.test(value)) {
        return value;
      }
    }
    
    const pathMatch = u.pathname.match(/\/(?:view|board|detail|read|notice)\/(\d+)/i);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    const segments = u.pathname.split("/").filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment && /^\d+$/.test(lastSegment)) {
      return lastSegment;
    }
    
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 문서 CRUD
// ============================================================

export async function saveDocument(doc: Omit<ScrapedDocument, "updated_at">): Promise<ScrapedDocument> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  
  // UPSERT using INSERT OR REPLACE
  db.run(`
    INSERT OR REPLACE INTO documents (doc_id, board_id, org_id, title, content, published_date, source_url, scraped_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    doc.doc_id,
    doc.board_id,
    doc.org_id,
    doc.title,
    doc.content,
    doc.published_date,
    doc.source_url,
    doc.scraped_at,
    now,
    JSON.stringify(doc.metadata || {})
  ]);
  
  saveDbToFile();
  return { ...doc, updated_at: now };
}

export async function documentExists(docId: string): Promise<boolean> {
  const db = await getDbAsync();
  const result = db.exec("SELECT 1 FROM documents WHERE doc_id = ?", [docId]);
  return result.length > 0 && result[0].values.length > 0;
}

export async function getDocument(docId: string): Promise<ScrapedDocument | null> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM documents WHERE doc_id = ?", [docId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  const row: any = {};
  columns.forEach((col, i) => row[col] = values[i]);
  
  return {
    ...row,
    metadata: JSON.parse(row.metadata || "{}")
  };
}

export async function getDocumentsByBoard(
  boardId: string,
  options?: {
    limit?: number;
    offset?: number;
    orderBy?: "scraped_at" | "published_date";
    order?: "ASC" | "DESC";
  }
): Promise<ScrapedDocument[]> {
  const db = await getDbAsync();
  const { limit = 100, offset = 0, orderBy = "scraped_at", order = "DESC" } = options || {};
  
  const result = db.exec(
    `SELECT * FROM documents WHERE board_id = ? ORDER BY ${orderBy} ${order} LIMIT ? OFFSET ?`,
    [boardId, limit, offset]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return {
      ...row,
      metadata: JSON.parse(row.metadata || "{}")
    };
  });
}

export async function countDocumentsByBoard(boardId: string): Promise<number> {
  const db = await getDbAsync();
  const result = db.exec("SELECT COUNT(*) as count FROM documents WHERE board_id = ?", [boardId]);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return Number(result[0].values[0][0]);
}

// ============================================================
// 첨부파일 CRUD
// ============================================================

export async function saveAttachment(attachment: AttachmentRecord): Promise<void> {
  const db = await getDbAsync();
  
  db.run(`
    INSERT OR REPLACE INTO attachments (file_id, doc_id, file_name, file_type, file_size, download_url, local_path, downloaded_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    attachment.file_id,
    attachment.doc_id,
    attachment.file_name,
    attachment.file_type,
    attachment.file_size,
    attachment.download_url,
    attachment.local_path,
    attachment.downloaded_at,
    attachment.status
  ]);
  
  saveDbToFile();
}

export function generateFileId(downloadUrl: string, docId: string): string {
  const hash = crypto.createHash("sha256").update(downloadUrl).digest("hex").slice(0, 12);
  return `file_${docId.replace("doc_", "")}_${hash}`;
}

export async function getAttachmentsByDoc(docId: string): Promise<AttachmentRecord[]> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM attachments WHERE doc_id = ?", [docId]);
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as AttachmentRecord;
  });
}

export async function getPendingAttachments(limit: number = 100): Promise<AttachmentRecord[]> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM attachments WHERE status = 'pending' LIMIT ?", [limit]);
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as AttachmentRecord;
  });
}

export async function updateAttachmentStatus(
  fileId: string,
  status: AttachmentRecord["status"],
  localPath?: string
): Promise<void> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  
  if (localPath) {
    db.run("UPDATE attachments SET status = ?, local_path = ?, downloaded_at = ? WHERE file_id = ?",
      [status, localPath, now, fileId]);
  } else {
    db.run("UPDATE attachments SET status = ? WHERE file_id = ?", [status, fileId]);
  }
  
  saveDbToFile();
}

// ============================================================
// 스크래핑 로그
// ============================================================

export async function startScrapeLog(boardId: string, scheduleId?: string): Promise<ScrapeLog> {
  const db = await getDbAsync();
  const now = new Date().toISOString();
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const log: ScrapeLog = {
    log_id: logId,
    board_id: boardId,
    schedule_id: scheduleId || null,
    started_at: now,
    finished_at: null,
    status: "running",
    docs_scraped: 0,
    docs_skipped: 0,
    docs_failed: 0,
    pages_processed: 0,
    error_message: null,
  };
  
  db.run(`
    INSERT INTO scrape_logs (log_id, board_id, schedule_id, started_at, status)
    VALUES (?, ?, ?, ?, ?)
  `, [logId, boardId, scheduleId || null, now, "running"]);
  
  saveDbToFile();
  return log;
}

export async function updateScrapeLog(
  logId: string,
  updates: Partial<Omit<ScrapeLog, "log_id" | "board_id" | "schedule_id" | "started_at">>
): Promise<void> {
  const db = await getDbAsync();
  
  const fields: string[] = [];
  const values: unknown[] = [];
  
  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.finished_at !== undefined) {
    fields.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.docs_scraped !== undefined) {
    fields.push("docs_scraped = ?");
    values.push(updates.docs_scraped);
  }
  if (updates.docs_skipped !== undefined) {
    fields.push("docs_skipped = ?");
    values.push(updates.docs_skipped);
  }
  if (updates.docs_failed !== undefined) {
    fields.push("docs_failed = ?");
    values.push(updates.docs_failed);
  }
  if (updates.pages_processed !== undefined) {
    fields.push("pages_processed = ?");
    values.push(updates.pages_processed);
  }
  if (updates.error_message !== undefined) {
    fields.push("error_message = ?");
    values.push(updates.error_message);
  }
  
  if (fields.length === 0) return;
  
  values.push(logId);
  db.run(`UPDATE scrape_logs SET ${fields.join(", ")} WHERE log_id = ?`, values);
  saveDbToFile();
}

export async function finishScrapeLog(
  logId: string,
  status: "success" | "failed" | "partial",
  stats: { docs_scraped: number; docs_skipped: number; docs_failed: number; pages_processed: number },
  errorMessage?: string
): Promise<void> {
  await updateScrapeLog(logId, {
    finished_at: new Date().toISOString(),
    status,
    ...stats,
    error_message: errorMessage || null,
  });
}

export async function getRecentScrapeLogs(boardId: string, limit: number = 10): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs WHERE board_id = ? ORDER BY started_at DESC LIMIT ?",
    [boardId, limit]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row: any = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as ScrapeLog;
  });
}

// ============================================================
// 통계 및 유틸리티
// ============================================================

export async function getStats(): Promise<{
  total_documents: number;
  total_attachments: number;
  pending_attachments: number;
  boards_with_data: number;
}> {
  const db = await getDbAsync();
  
  const docResult = db.exec("SELECT COUNT(*) FROM documents");
  const docCount = docResult.length > 0 ? Number(docResult[0].values[0][0]) : 0;
  
  const attachResult = db.exec("SELECT COUNT(*) FROM attachments");
  const attachCount = attachResult.length > 0 ? Number(attachResult[0].values[0][0]) : 0;
  
  const pendingResult = db.exec("SELECT COUNT(*) FROM attachments WHERE status = 'pending'");
  const pendingCount = pendingResult.length > 0 ? Number(pendingResult[0].values[0][0]) : 0;
  
  const boardResult = db.exec("SELECT COUNT(DISTINCT board_id) FROM documents");
  const boardCount = boardResult.length > 0 ? Number(boardResult[0].values[0][0]) : 0;
  
  return {
    total_documents: docCount,
    total_attachments: attachCount,
    pending_attachments: pendingCount,
    boards_with_data: boardCount,
  };
}

// ============================================================
// 수집 현황 통계 (Status Dashboard용)
// ============================================================

/**
 * 요약 통계: 대시보드 상단 카드용
 */
export async function getStatusSummary(): Promise<{
  total_documents: number;
  total_attachments: number;
  today_documents: number;
  today_attachments: number;
  running_jobs: number;
  error_rate_24h: number;
  total_size_bytes: number;
}> {
  const db = await getDbAsync();
  
  // 총 문서 수
  const docResult = db.exec("SELECT COUNT(*) FROM documents");
  const totalDocs = docResult.length > 0 ? Number(docResult[0].values[0][0]) : 0;
  
  // 총 첨부파일 수
  const attachResult = db.exec("SELECT COUNT(*) FROM attachments");
  const totalAttach = attachResult.length > 0 ? Number(attachResult[0].values[0][0]) : 0;
  
  // 금일 수집 문서 (UTC 기준 오늘)
  const today = new Date().toISOString().split("T")[0];
  const todayDocResult = db.exec(
    "SELECT COUNT(*) FROM documents WHERE scraped_at >= ?",
    [`${today}T00:00:00.000Z`]
  );
  const todayDocs = todayDocResult.length > 0 ? Number(todayDocResult[0].values[0][0]) : 0;
  
  // 금일 수집 첨부파일
  const todayAttachResult = db.exec(
    "SELECT COUNT(*) FROM attachments WHERE downloaded_at >= ?",
    [`${today}T00:00:00.000Z`]
  );
  const todayAttach = todayAttachResult.length > 0 ? Number(todayAttachResult[0].values[0][0]) : 0;
  
  // 실행 중인 작업 수
  const runningResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status = 'running'"
  );
  const runningJobs = runningResult.length > 0 ? Number(runningResult[0].values[0][0]) : 0;
  
  // 24시간 에러율
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const totalLogsResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE started_at >= ?",
    [yesterday]
  );
  const totalLogs = totalLogsResult.length > 0 ? Number(totalLogsResult[0].values[0][0]) : 0;
  
  const failedLogsResult = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE started_at >= ? AND status = 'failed'",
    [yesterday]
  );
  const failedLogs = failedLogsResult.length > 0 ? Number(failedLogsResult[0].values[0][0]) : 0;
  
  const errorRate = totalLogs > 0 ? (failedLogs / totalLogs) * 100 : 0;
  
  // 총 파일 용량
  const sizeResult = db.exec(
    "SELECT COALESCE(SUM(file_size), 0) FROM attachments WHERE file_size IS NOT NULL"
  );
  const totalSize = sizeResult.length > 0 ? Number(sizeResult[0].values[0][0]) : 0;
  
  return {
    total_documents: totalDocs,
    total_attachments: totalAttach,
    today_documents: todayDocs,
    today_attachments: todayAttach,
    running_jobs: runningJobs,
    error_rate_24h: Math.round(errorRate * 10) / 10,
    total_size_bytes: totalSize,
  };
}

/**
 * 기간별 수집 추이 통계
 */
export async function getCollectionTimeline(
  startDate: string,
  endDate: string,
  groupBy: "day" | "week" | "month" = "day"
): Promise<{ date: string; documents: number; attachments: number }[]> {
  const db = await getDbAsync();
  
  // SQLite date grouping
  let dateFormat: string;
  switch (groupBy) {
    case "week":
      dateFormat = "%Y-W%W";
      break;
    case "month":
      dateFormat = "%Y-%m";
      break;
    default:
      dateFormat = "%Y-%m-%d";
  }
  
  // 문서 수집 통계
  const docResult = db.exec(`
    SELECT strftime('${dateFormat}', scraped_at) as period, COUNT(*) as count
    FROM documents
    WHERE scraped_at >= ? AND scraped_at <= ?
    GROUP BY period
    ORDER BY period ASC
  `, [startDate, endDate]);
  
  const docMap = new Map<string, number>();
  if (docResult.length > 0) {
    docResult[0].values.forEach((row) => {
      docMap.set(row[0] as string, Number(row[1]));
    });
  }
  
  // 첨부파일 수집 통계
  const attachResult = db.exec(`
    SELECT strftime('${dateFormat}', downloaded_at) as period, COUNT(*) as count
    FROM attachments
    WHERE downloaded_at IS NOT NULL AND downloaded_at >= ? AND downloaded_at <= ?
    GROUP BY period
    ORDER BY period ASC
  `, [startDate, endDate]);
  
  const attachMap = new Map<string, number>();
  if (attachResult.length > 0) {
    attachResult[0].values.forEach((row) => {
      attachMap.set(row[0] as string, Number(row[1]));
    });
  }
  
  // 기간 내 모든 날짜 생성
  const result: { date: string; documents: number; attachments: number }[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (groupBy === "day") {
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      result.push({
        date: dateStr,
        documents: docMap.get(dateStr) || 0,
        attachments: attachMap.get(dateStr) || 0,
      });
    }
  } else if (groupBy === "month") {
    for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      result.push({
        date: dateStr,
        documents: docMap.get(dateStr) || 0,
        attachments: attachMap.get(dateStr) || 0,
      });
    }
  } else {
    // week 그룹은 Map에 있는 데이터만 반환
    const allPeriods = new Set([...docMap.keys(), ...attachMap.keys()]);
    Array.from(allPeriods).sort().forEach((period) => {
      result.push({
        date: period,
        documents: docMap.get(period) || 0,
        attachments: attachMap.get(period) || 0,
      });
    });
  }
  
  return result;
}

/**
 * 파일 형식별 통계
 */
export async function getFileTypeStats(): Promise<{
  type: string;
  count: number;
  size_bytes: number;
  percentage: number;
}[]> {
  const db = await getDbAsync();
  
  const result = db.exec(`
    SELECT 
      LOWER(file_type) as type,
      COUNT(*) as count,
      COALESCE(SUM(file_size), 0) as total_size
    FROM attachments
    GROUP BY LOWER(file_type)
    ORDER BY count DESC
  `);
  
  if (result.length === 0) return [];
  
  const data = result[0].values.map((row) => ({
    type: (row[0] as string) || "unknown",
    count: Number(row[1]),
    size_bytes: Number(row[2]),
    percentage: 0,
  }));
  
  const totalCount = data.reduce((sum, item) => sum + item.count, 0);
  data.forEach((item) => {
    item.percentage = totalCount > 0 ? Math.round((item.count / totalCount) * 1000) / 10 : 0;
  });
  
  return data;
}

/**
 * 보드별 상세 통계
 */
export async function getBoardStats(): Promise<{
  board_id: string;
  org_id: string;
  document_count: number;
  attachment_count: number;
  total_size_bytes: number;
  last_scraped_at: string | null;
  last_7d_documents: number;
}[]> {
  const db = await getDbAsync();
  
  // 보드별 문서 통계
  const docResult = db.exec(`
    SELECT 
      board_id,
      org_id,
      COUNT(*) as doc_count,
      MAX(scraped_at) as last_scraped
    FROM documents
    GROUP BY board_id, org_id
  `);
  
  const boardMap = new Map<string, {
    board_id: string;
    org_id: string;
    document_count: number;
    attachment_count: number;
    total_size_bytes: number;
    last_scraped_at: string | null;
    last_7d_documents: number;
  }>();
  
  if (docResult.length > 0) {
    docResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      boardMap.set(boardId, {
        board_id: boardId,
        org_id: row[1] as string,
        document_count: Number(row[2]),
        attachment_count: 0,
        total_size_bytes: 0,
        last_scraped_at: row[3] as string | null,
        last_7d_documents: 0,
      });
    });
  }
  
  // 보드별 첨부파일 통계 (documents 조인)
  const attachResult = db.exec(`
    SELECT 
      d.board_id,
      COUNT(a.file_id) as attach_count,
      COALESCE(SUM(a.file_size), 0) as total_size
    FROM documents d
    LEFT JOIN attachments a ON d.doc_id = a.doc_id
    GROUP BY d.board_id
  `);
  
  if (attachResult.length > 0) {
    attachResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      const existing = boardMap.get(boardId);
      if (existing) {
        existing.attachment_count = Number(row[1]);
        existing.total_size_bytes = Number(row[2]);
      }
    });
  }
  
  // 최근 7일 문서 수
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentResult = db.exec(`
    SELECT board_id, COUNT(*) as count
    FROM documents
    WHERE scraped_at >= ?
    GROUP BY board_id
  `, [sevenDaysAgo]);
  
  if (recentResult.length > 0) {
    recentResult[0].values.forEach((row) => {
      const boardId = row[0] as string;
      const existing = boardMap.get(boardId);
      if (existing) {
        existing.last_7d_documents = Number(row[1]);
      }
    });
  }
  
  return Array.from(boardMap.values());
}

/**
 * 보드별 최근 실행 상태
 */
export async function getBoardLatestStatus(): Promise<{
  board_id: string;
  last_run_at: string | null;
  status: "success" | "failed" | "running" | "partial" | "never";
  docs_scraped: number;
  docs_failed: number;
  error_message: string | null;
}[]> {
  const db = await getDbAsync();
  
  // 각 보드의 가장 최근 로그
  const result = db.exec(`
    SELECT 
      l1.board_id,
      l1.started_at,
      l1.status,
      l1.docs_scraped,
      l1.docs_failed,
      l1.error_message
    FROM scrape_logs l1
    INNER JOIN (
      SELECT board_id, MAX(started_at) as max_started
      FROM scrape_logs
      GROUP BY board_id
    ) l2 ON l1.board_id = l2.board_id AND l1.started_at = l2.max_started
  `);
  
  if (result.length === 0) return [];
  
  return result[0].values.map((row) => ({
    board_id: row[0] as string,
    last_run_at: row[1] as string | null,
    status: row[2] as "success" | "failed" | "running" | "partial",
    docs_scraped: Number(row[3]),
    docs_failed: Number(row[4]),
    error_message: row[5] as string | null,
  }));
}

/**
 * 실행 중인 작업 목록
 */
export async function getRunningJobs(): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs WHERE status = 'running' ORDER BY started_at DESC"
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as unknown as ScrapeLog;
  });
}

/**
 * 최근 스크래핑 로그 (전체 보드)
 */
export async function getAllRecentLogs(limit: number = 50): Promise<ScrapeLog[]> {
  const db = await getDbAsync();
  const result = db.exec(
    "SELECT * FROM scrape_logs ORDER BY started_at DESC LIMIT ?",
    [limit]
  );
  
  if (result.length === 0) return [];
  
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => row[col] = values[i]);
    return row as unknown as ScrapeLog;
  });
}

// ============================================================
// 에러 통계 및 분석
// ============================================================

export type ErrorType = "timeout" | "http_error" | "parsing" | "network" | "dom_change" | "unknown";

/**
 * 에러 메시지에서 에러 유형 분류
 */
export function classifyErrorType(errorMessage: string | null): ErrorType {
  if (!errorMessage) return "unknown";
  const msg = errorMessage.toLowerCase();
  
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("시간 초과")) {
    return "timeout";
  }
  // HTTP 오류: 명시적 status code / 키워드 기반
  if (
    msg.includes("http") ||
    msg.includes("status") ||
    /\b(4\d{2}|5\d{2})\b/.test(msg) ||
    msg.includes("forbidden") ||
    msg.includes("not found")
  ) {
    return "http_error";
  }
  if (msg.includes("parse") || msg.includes("json") || msg.includes("selector") || msg.includes("invalid") || msg.includes("파싱")) {
    return "parsing";
  }
  if (msg.includes("network") || msg.includes("connection") || msg.includes("dns") || msg.includes("socket") || msg.includes("econnrefused") || msg.includes("네트워크")) {
    return "network";
  }
  if (msg.includes("dom") || msg.includes("element") || msg.includes("변경") || msg.includes("구조")) {
    return "dom_change";
  }
  return "unknown";
}

export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  timeout: "타임아웃",
  http_error: "HTTP 오류",
  parsing: "파싱 실패",
  network: "네트워크 오류",
  dom_change: "DOM 구조 변경",
  unknown: "기타",
};

/**
 * 에러 통계 조회
 */
export async function getErrorStats(): Promise<{
  last_24h: number;
  last_7d: number;
  pending: number;
  by_type: Record<ErrorType, number>;
}> {
  const db = await getDbAsync();
  
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  // 24시간 내 에러
  const result24h = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ?",
    [yesterday]
  );
  const last24h = result24h.length > 0 ? Number(result24h[0].values[0][0]) : 0;
  
  // 7일 내 에러
  const result7d = db.exec(
    "SELECT COUNT(*) FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ?",
    [sevenDaysAgo]
  );
  const last7d = result7d.length > 0 ? Number(result7d[0].values[0][0]) : 0;
  
  // 대기 중 (에러 발생 후 재시도 대기 = 가장 최근이 에러인 보드)
  const pendingResult = db.exec(`
    SELECT COUNT(DISTINCT l1.board_id) FROM scrape_logs l1
    INNER JOIN (
      SELECT board_id, MAX(started_at) as max_started
      FROM scrape_logs
      GROUP BY board_id
    ) l2 ON l1.board_id = l2.board_id AND l1.started_at = l2.max_started
    WHERE l1.status = 'failed'
  `);
  const pending = pendingResult.length > 0 ? Number(pendingResult[0].values[0][0]) : 0;
  
  // 유형별 분류 (7일)
  const errorsResult = db.exec(
    "SELECT error_message FROM scrape_logs WHERE status IN ('failed', 'partial') AND started_at >= ? AND error_message IS NOT NULL",
    [sevenDaysAgo]
  );
  
  const byType: Record<ErrorType, number> = {
    timeout: 0,
    http_error: 0,
    parsing: 0,
    network: 0,
    dom_change: 0,
    unknown: 0,
  };
  
  if (errorsResult.length > 0) {
    errorsResult[0].values.forEach((row) => {
      const errorMsg = row[0] as string;
      const type = classifyErrorType(errorMsg);
      byType[type]++;
    });
  }
  
  return {
    last_24h: last24h,
    last_7d: last7d,
    pending,
    by_type: byType,
  };
}

/**
 * 에러 목록 조회 (페이징)
 */
export async function getErrorList(options?: {
  limit?: number;
  offset?: number;
  errorType?: ErrorType;
  boardId?: string;
}): Promise<{
  items: Array<ScrapeLog & { error_type: ErrorType }>;
  total: number;
}> {
  const db = await getDbAsync();
  const { limit = 50, offset = 0, errorType, boardId } = options || {};
  
  let whereClause = "WHERE status IN ('failed', 'partial')";
  const params: unknown[] = [];
  
  if (boardId) {
    whereClause += " AND board_id = ?";
    params.push(boardId);
  }

  // errorType 필터가 들어오면: 전체를 분류한 뒤 필터링/페이징 (total 정합성 확보)
  if (errorType) {
    const allResult = db.exec(
      `SELECT * FROM scrape_logs ${whereClause} ORDER BY started_at DESC`,
      params
    );
    if (allResult.length === 0) return { items: [], total: 0 };

    const columns = allResult[0].columns;
    const allItems = allResult[0].values.map((values) => {
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => (row[col] = values[i]));
      const t = classifyErrorType(row.error_message as string | null);
      return { ...row, error_type: t } as unknown as ScrapeLog & { error_type: ErrorType };
    });

    const filtered = allItems.filter((i) => i.error_type === errorType);
    return {
      total: filtered.length,
      items: filtered.slice(offset, offset + limit),
    };
  }

  // 총 개수 (필터 없음)
  const countResult = db.exec(`SELECT COUNT(*) FROM scrape_logs ${whereClause}`, params);
  const total = countResult.length > 0 ? Number(countResult[0].values[0][0]) : 0;

  // 목록 조회
  const result = db.exec(
    `SELECT * FROM scrape_logs ${whereClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  if (result.length === 0) return { items: [], total };

  const columns = result[0].columns;
  const items = result[0].values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => (row[col] = values[i]));
    const t = classifyErrorType(row.error_message as string | null);
    return { ...row, error_type: t } as unknown as ScrapeLog & { error_type: ErrorType };
  });

  return { items, total };
}

/**
 * 특정 로그 상세 조회
 */
export async function getScrapeLogDetail(logId: string): Promise<ScrapeLog | null> {
  const db = await getDbAsync();
  const result = db.exec("SELECT * FROM scrape_logs WHERE log_id = ?", [logId]);
  
  if (result.length === 0 || result[0].values.length === 0) return null;
  
  const columns = result[0].columns;
  const values = result[0].values[0];
  const row: Record<string, unknown> = {};
  columns.forEach((col, i) => row[col] = values[i]);
  
  return row as unknown as ScrapeLog;
}

/**
 * 즉시 실행(instant) 스크래핑 결과를 DB에 동기화
 * - 즉시 실행/스트리밍 라우트에서 JSON 저장 후 호출
 * - 수집 현황 대시보드의 통계 데이터를 갱신
 */
export async function syncInstantScrapeToDB(params: {
  boardId: string;
  orgId: string;
  articles: Array<{
    title: string;
    link: string;
    date?: string;
    content: string;
    attachments?: Array<{ fileName: string; downloadUrl: string }>;
  }>;
  downloadedFiles?: string[];
  dedupKey?: DedupKeyType;
}): Promise<{ logId: string; docsAdded: number; attachmentsAdded: number }> {
  const { boardId, orgId, articles, downloadedFiles = [], dedupKey = "url" } = params;
  
  let docsAdded = 0;
  let attachmentsAdded = 0;
  let docsSkipped = 0;
  
  // 로그 생성
  const log = await startScrapeLog(boardId);
  
  try {
    const now = new Date().toISOString();
    
    for (const article of articles) {
      // 문서 ID 생성
      const docId = generateDocId(
        { title: article.title, link: article.link, date: article.date, content: article.content },
        boardId,
        dedupKey
      );
      
      // 중복 체크
      if (await documentExists(docId)) {
        docsSkipped++;
        continue;
      }
      
      // 날짜 파싱
      let publishedDate: string | null = null;
      if (article.date) {
        const dateMatch = article.date.match(/(\d{4})[-./\s]*(\d{1,2})[-./\s]*(\d{1,2})/);
        if (dateMatch) {
          publishedDate = `${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`;
        }
      }
      
      // 문서 저장
      await saveDocument({
        doc_id: docId,
        board_id: boardId,
        org_id: orgId,
        title: article.title,
        content: article.content || "",
        published_date: publishedDate,
        source_url: article.link,
        scraped_at: now,
        metadata: {},
      });
      docsAdded++;
      
      // 첨부파일 메타데이터 저장
      if (article.attachments && article.attachments.length > 0) {
        for (const att of article.attachments) {
          const fileId = generateFileId(att.downloadUrl, docId);
          const fileType = att.fileName.split(".").pop()?.toLowerCase() || "";
          
          // 다운로드 파일 목록에서 해당 파일 찾기 (매칭)
          const downloadedPath = downloadedFiles.find((fp) => {
            const fn = fp.split(/[/\\]/).pop() || "";
            return fn.includes(att.fileName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 30));
          });
          
          // 파일 크기 조회
          let fileSize: number | null = null;
          if (downloadedPath) {
            try {
              const fs = require("node:fs");
              const stat = fs.statSync(downloadedPath);
              fileSize = stat.size;
            } catch {
              // 파일 크기 조회 실패 무시
            }
          }
          
          await saveAttachment({
            file_id: fileId,
            doc_id: docId,
            file_name: att.fileName,
            file_type: fileType,
            file_size: fileSize,
            download_url: att.downloadUrl,
            local_path: downloadedPath || null,
            downloaded_at: downloadedPath ? now : null,
            status: downloadedPath ? "downloaded" : "pending",
          });
          attachmentsAdded++;
        }
      }
    }
    
    // 로그 완료
    const finalStatus = docsAdded > 0 ? "success" : (articles.length > 0 ? "success" : "partial");
    await finishScrapeLog(log.log_id, finalStatus as "success" | "partial" | "failed", {
      docs_scraped: docsAdded,
      docs_skipped: docsSkipped,
      docs_failed: 0,
      pages_processed: 1,
    });
    
    return { logId: log.log_id, docsAdded, attachmentsAdded };
  } catch (err) {
    // 에러 시에도 로그 기록
    const errorMessage = err instanceof Error ? err.message : String(err);
    await finishScrapeLog(log.log_id, "failed", {
      docs_scraped: docsAdded,
      docs_skipped: docsSkipped,
      docs_failed: articles.length - docsAdded - docsSkipped,
      pages_processed: 1,
    }, errorMessage);
    
    throw err;
  }
}

export function closeDb(): void {
  if (dbInstance) {
    saveDbToFile();
    dbInstance.close();
    dbInstance = null;
  }
}
