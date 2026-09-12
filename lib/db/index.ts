import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

/**
 * The database client, created on first use rather than at import time, so a
 * build without DATABASE_URL (CI) never tries to connect.
 */
export function getDb() {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = drizzle({ client: neon(url), schema });
  }
  return cached;
}
