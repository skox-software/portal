-- Reverses 0023_company.sql. Drops the company's runs and proposals; seats live in code and are unaffected.
DROP TABLE IF EXISTS "company_proposals";
DROP TABLE IF EXISTS "company_runs";
DROP TYPE IF EXISTS "public"."company_proposal_status";
