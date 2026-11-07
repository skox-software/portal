-- Reverses drizzle/0023_sales_files.sql. Not run by drizzle-kit; apply by hand with psql if needed:
--   psql "$DATABASE_URL" -f drizzle/down/0023_sales_files.sql
-- then delete the 0023 row from drizzle.__drizzle_migrations and deploy the code from before PR "sales files".
-- Remove the files from the Sales files page first, or their blobs stay in storage.
DROP TABLE IF EXISTS "sales_files";
