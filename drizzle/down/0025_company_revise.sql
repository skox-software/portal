-- Reverses 0025_company_revise.sql. Postgres can't drop an enum value; move any revise cards back to pending instead.
UPDATE "company_proposals" SET "status" = 'pending' WHERE "status" = 'revise';
