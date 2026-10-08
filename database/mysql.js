'use strict';

const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

function options(env = process.env) {
  const raw = env.MYSQL_URL || env.DATABASE_URL;
  if (!raw) throw new Error('MYSQL_URL is required.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid MySQL connection configuration.'); }
  if (url.protocol !== 'mysql:' || !/^\/[a-zA-Z0-9_]+$/.test(url.pathname)) throw new Error('Invalid MySQL database URL.');
  const internal = url.hostname.endsWith('.railway.internal') || ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const ca = env.MYSQL_SSL_CA || (env.MYSQL_SSL_CA_FILE ? readFileSync(env.MYSQL_SSL_CA_FILE, 'utf8') : undefined);
  // Never silently downgrade public database connections to plaintext or unverified TLS.
  const ssl = internal ? undefined : { rejectUnauthorized: true, verifyIdentity: !ca, ...(ca ? { ca } : {}) };
  return { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1), ssl,
    connectTimeout: 15_000, charset: 'utf8mb4', supportBigNumbers: true, bigNumberStrings: true,
    dateStrings: true, jsonStrings: true, multipleStatements: false };
}

async function connect(env) {
  const connection = await mysql.createConnection(options(env));
  try {
    await connection.query("SET SESSION time_zone='+00:00'");
    await connection.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    return connection;
  } catch (error) { await connection.end(); throw error; }
}

async function migrate(connection) {
  const [[database]] = await connection.query('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()');
  if (database.charset !== 'utf8mb4' || database.collation !== 'utf8mb4_0900_ai_ci') {
    throw new Error('TaskMall MySQL requires utf8mb4 / utf8mb4_0900_ai_ci to keep foreign-key columns compatible.');
  }
  const [[{ acquired }]] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':taskmall:migrations'), 15) AS acquired");
  if (Number(acquired) !== 1) throw new Error('Database migrations are locked by another process.');
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(128) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const directory = path.join(__dirname, 'migrations');
    for (const name of (await fs.readdir(directory)).filter(name => /^\d+[-a-z0-9]*\.sql$/.test(name)).sort()) {
      const source = (await fs.readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
      const checksum = crypto.createHash('sha256').update(source).digest('hex');
      const [[existing]] = await connection.execute('SELECT checksum FROM schema_migrations WHERE version=?', [name]);
      if (existing) {
        if (existing.checksum !== checksum) throw new Error('Applied database migration has changed.');
        continue;
      }
      // Migrations contain only simple DDL statements. MySQL DDL commits implicitly;
      // each statement must be restartable after a partially completed migration.
      for (const statement of source.split(';').map(value => value.trim()).filter(Boolean)) {
        await connection.query(statement);
      }
      await connection.execute('INSERT INTO schema_migrations(version,checksum) VALUES (?,?)', [name, checksum]);
    }
  } finally { await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':taskmall:migrations'))"); }
}

module.exports = { options, connect, migrate };
