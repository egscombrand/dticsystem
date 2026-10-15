// Database PostgreSQL lokal untuk pengembangan/pengujian TANPA Supabase/Docker,
// memakai PGlite (Postgres WASM) yang diekspos lewat protokol Postgres.
// Pemakaian: npm run db:local   → postgres://postgres@127.0.0.1:54329/postgres
//   PGLITE_DIR=memory:// untuk database sementara (in-memory).
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const dataDir = process.env.PGLITE_DIR ?? ".data/pglite";
const port = Number(process.env.PGLITE_PORT ?? 54329);

const db = await PGlite.create(dataDir);
// PGlite single-connection: server memultipleks koneksi; set DB_POOL_MAX=1 di aplikasi.
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4 });
await server.start();
console.log(`PGlite siap di postgres://postgres@127.0.0.1:${port}/postgres (data: ${dataDir})`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
