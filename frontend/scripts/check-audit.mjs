import path from "node:path";
import fs from "node:fs";
import initSqlJs from "sql.js";

const dbPath = process.env.IEPS_DB_PATH
  ? path.resolve(process.env.IEPS_DB_PATH)
  : path.resolve(process.cwd(), "..", "data", "ieps", "db.sqlite");

const SQL = await initSqlJs({
  locateFile: (file) =>
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
});

const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

const r = db.exec(
  "SELECT id, actor_user_id, action, target_table, target_id, created_at FROM audit_log ORDER BY id DESC LIMIT 20"
);
if (r.length === 0) {
  console.log("audit_log empty");
} else {
  for (const row of r[0].values) {
    console.log(JSON.stringify(Object.fromEntries(r[0].columns.map((c, i) => [c, row[i]]))));
  }
}
db.close();
