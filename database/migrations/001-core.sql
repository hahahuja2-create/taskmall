CREATE TABLE IF NOT EXISTS state (
  id TINYINT PRIMARY KEY CHECK (id = 1), payload JSON NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(128) PRIMARY KEY, value TEXT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS vip_plans (
  id VARCHAR(32) PRIMARY KEY, level INT UNSIGNED NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL, price_units DECIMAL(30,0) NOT NULL CHECK (price_units >= 0),
  reward_units DECIMAL(30,0) NOT NULL CHECK (reward_units >= 0),
  daily_tasks INT UNSIGNED NOT NULL, duration_days INT UNSIGNED NOT NULL,
  payload JSON NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS tasks (
  id VARCHAR(64) PRIMARY KEY, vip_id VARCHAR(32) NOT NULL, reward_units DECIMAL(30,0) NOT NULL CHECK (reward_units >= 0),
  image VARCHAR(512) NOT NULL, payload JSON NOT NULL,
  FOREIGN KEY (vip_id) REFERENCES vip_plans(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY, email VARCHAR(254) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL, password_salt CHAR(32) NOT NULL, password_hash CHAR(128) NOT NULL,
  invite_code VARCHAR(32) NOT NULL UNIQUE, referred_by VARCHAR(32),
  created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
  INDEX users_referrer (referred_by)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS wallets (
  user_id VARCHAR(64) PRIMARY KEY,
  locked_units DECIMAL(30,0) NOT NULL CHECK (locked_units >= 0),
  withdraw_units DECIMAL(30,0) NOT NULL CHECK (withdraw_units >= 0),
  reserved_units DECIMAL(30,0) NOT NULL CHECK (reserved_units >= 0),
  earned_units DECIMAL(30,0) NOT NULL CHECK (earned_units >= 0),
  withdrawn_units DECIMAL(30,0) NOT NULL CHECK (withdrawn_units >= 0),
  fee_units DECIMAL(30,0) NOT NULL CHECK (fee_units >= 0),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS memberships (
  user_id VARCHAR(64) PRIMARY KEY, vip_id VARCHAR(32) NOT NULL,
  started_at BIGINT UNSIGNED NOT NULL, expires_at BIGINT UNSIGNED NOT NULL,
  CHECK (expires_at > started_at), INDEX membership_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (vip_id) REFERENCES vip_plans(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, type VARCHAR(32) NOT NULL,
  amount_units DECIMAL(30,0), at BIGINT UNSIGNED NOT NULL, payload JSON NOT NULL,
  INDEX activities_user (user_id, at), FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS task_completions (
  activity_id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NOT NULL,
  completion_day DATE NOT NULL, reward_units DECIMAL(30,0) NOT NULL CHECK (reward_units >= 0),
  UNIQUE KEY completion_once (user_id, task_id, completion_day),
  FOREIGN KEY (activity_id) REFERENCES activities(id), FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS deposit_addresses (
  user_id VARCHAR(64) PRIMARY KEY, address CHAR(34) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  address_index INT UNSIGNED NOT NULL UNIQUE, created_at BIGINT UNSIGNED NOT NULL,
  scanned_at BIGINT UNSIGNED NOT NULL DEFAULT 0, full_scan_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS deposits (
  txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, log_index INT UNSIGNED NOT NULL,
  user_id VARCHAR(64) NOT NULL, address CHAR(34) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_units DECIMAL(30,0) NOT NULL CHECK (amount_units > 0),
  block_number BIGINT UNSIGNED NOT NULL, timestamp BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (txid, log_index), INDEX deposits_user (user_id, timestamp), INDEX deposits_address (address),
  FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (address) REFERENCES deposit_addresses(address)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS journal (
  batch CHAR(36) NOT NULL, account VARCHAR(128) NOT NULL, delta_units DECIMAL(30,0) NOT NULL,
  reason VARCHAR(128) NOT NULL, created_at CHAR(24) NOT NULL,
  PRIMARY KEY (batch, account), INDEX journal_account (account, created_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS withdrawals (
  id CHAR(36) PRIMARY KEY, user_id VARCHAR(64) NOT NULL,
  request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  destination CHAR(34) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  gross_units DECIMAL(30,0) NOT NULL CHECK (gross_units >= 10000000),
  fee_units DECIMAL(30,0) NOT NULL CHECK (fee_units >= 0),
  net_units DECIMAL(30,0) NOT NULL CHECK (net_units > 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('requested','approved','rejected','submitted','confirmed')),
  created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
  txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE, issue VARCHAR(64),
  CHECK (gross_units = fee_units + net_units), UNIQUE KEY withdrawal_request (user_id, request_key),
  INDEX withdrawals_user (user_id, created_at), INDEX withdrawals_status (status, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS collections (
  id CHAR(36) PRIMARY KEY, address CHAR(34) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  address_index INT UNSIGNED NOT NULL, treasury CHAR(34) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount_units DECIMAL(30,0) NOT NULL CHECK (amount_units > 0),
  status VARCHAR(16) NOT NULL CHECK (status IN ('planned','signed','confirmed','cancelled')),
  created_at BIGINT UNSIGNED NOT NULL, txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE, issue VARCHAR(64),
  active_address CHAR(34) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (CASE WHEN status NOT IN ('confirmed','cancelled') THEN address ELSE NULL END) STORED,
  UNIQUE KEY collection_inflight (active_address), INDEX collections_status (status, created_at),
  FOREIGN KEY (address) REFERENCES deposit_addresses(address)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS outgoing_transactions (
  txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('withdrawal','collection')), job_id CHAR(36) NOT NULL UNIQUE,
  payload LONGTEXT, created_at BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payout_intents (
  job_id CHAR(36) PRIMARY KEY, txid CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  payload LONGTEXT NOT NULL, fee_limit BIGINT UNSIGNED NOT NULL, created_at BIGINT UNSIGNED NOT NULL,
  FOREIGN KEY (job_id) REFERENCES withdrawals(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payment_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, actor VARCHAR(64) NOT NULL, action VARCHAR(64) NOT NULL,
  job_id CHAR(36) NOT NULL, at BIGINT UNSIGNED NOT NULL, INDEX payment_audit_job (job_id, at)
) ENGINE=InnoDB;
