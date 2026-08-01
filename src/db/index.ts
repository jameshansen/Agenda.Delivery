import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// ponytail: cache the pool on globalThis so dev hot-reload doesn't leak pools.
const g = globalThis as unknown as { _pool?: Pool };
const pool = g._pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") g._pool = pool;

export const db = drizzle(pool, { schema });
