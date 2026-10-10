SET @taskmall_user_balance_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='vip_balance'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN vip_balance DECIMAL(20,6) NOT NULL DEFAULT 0 CHECK (vip_balance >= 0)'
);
PREPARE taskmall_user_balance_statement FROM @taskmall_user_balance_ddl;
EXECUTE taskmall_user_balance_statement;
DEALLOCATE PREPARE taskmall_user_balance_statement;
SET @taskmall_user_balance_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='withdrawal_balance'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN withdrawal_balance DECIMAL(20,6) NOT NULL DEFAULT 0 CHECK (withdrawal_balance >= 0)'
);
PREPARE taskmall_user_balance_statement FROM @taskmall_user_balance_ddl;
EXECUTE taskmall_user_balance_statement;
DEALLOCATE PREPARE taskmall_user_balance_statement;
UPDATE users u JOIN wallets w ON w.user_id=u.id
SET u.vip_balance=w.locked_units * 0.000001, u.withdrawal_balance=w.withdraw_units * 0.000001;
