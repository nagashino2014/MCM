-- Add the missing `memo` column to contract_documents.
--
-- The contract/amendment upload route (app/api/contracts/[contractId]/documents)
-- and the outsourcing upload route (app/api/contracts/[contractId]/outsourcing)
-- both INSERT into contract_documents.memo, but the original table definition
-- (004_contract_management.sql) never declared this column. On PostgreSQL the
-- INSERT therefore fails with `column "memo" of relation "contract_documents"
-- does not exist`, which the API surfaces as a 500 and the UI shows as
-- "등록 실패" whenever a PDF is attached. (The tax-invoice route already omits
-- memo, which is why invoice uploads kept working.)
--
-- Adding the column aligns the schema with the existing route code so that
-- contract / amendment / outsourcing PDF uploads succeed and the optional memo
-- is persisted.

ALTER TABLE contract_documents
  ADD COLUMN IF NOT EXISTS memo text;
