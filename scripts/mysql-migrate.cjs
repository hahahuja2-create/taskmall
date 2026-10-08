'use strict';

const { MysqlPaymentStore } = require('../payments/mysql-store');
const { vipPlans, tasks } = require('../platform-catalog');

async function main() {
  const store = await MysqlPaymentStore.open();
  try {
    await store.catalog(vipPlans, tasks);
    const [[counts]] = await store.connection.query(`SELECT
      (SELECT COUNT(*) FROM vip_plans) AS vipPlans, (SELECT COUNT(*) FROM tasks) AS tasks,
      (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM deposits) AS deposits,
      (SELECT COUNT(*) FROM withdrawals) AS withdrawals`);
    const [tables] = await store.connection.query('SHOW TABLES');
    const [tls] = await store.connection.query('SHOW STATUS WHERE Variable_name=?', ['Ssl_cipher']);
    console.log(JSON.stringify({ status: 'MYSQL_SCHEMA_READY', tables: tables.map(value => Object.values(value)[0]),
      counts, encryptedConnection: Boolean(tls[0]?.Value), customerDataImported: false }, null, 2));
  } finally { await store.close(); }
}

main().catch(error => {
  console.error('MySQL migration failed. Existing data was preserved. Code:', error.code || 'CONFIGURATION_OR_VALIDATION');
  process.exitCode = 1;
});
