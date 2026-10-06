CREATE TABLE data_source_credentials (
  source_id BIGINT PRIMARY KEY REFERENCES data_sources(id) ON DELETE CASCADE,
  algorithm VARCHAR(30) NOT NULL DEFAULT 'aes-256-gcm',
  key_version INTEGER NOT NULL DEFAULT 1,
  ciphertext BYTEA NOT NULL,
  iv BYTEA NOT NULL,
  auth_tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT data_source_credentials_algorithm_check CHECK (algorithm = 'aes-256-gcm'),
  CONSTRAINT data_source_credentials_key_version_check CHECK (key_version > 0),
  CONSTRAINT data_source_credentials_ciphertext_check CHECK (OCTET_LENGTH(ciphertext) > 0),
  CONSTRAINT data_source_credentials_iv_check CHECK (OCTET_LENGTH(iv) = 12),
  CONSTRAINT data_source_credentials_auth_tag_check CHECK (OCTET_LENGTH(auth_tag) = 16)
);

CREATE TRIGGER data_source_credentials_set_updated_at
BEFORE UPDATE ON data_source_credentials
FOR EACH ROW EXECUTE PROCEDURE catalog_set_updated_at();

REVOKE ALL ON data_source_credentials FROM PUBLIC;

COMMENT ON TABLE data_source_credentials IS
  '业务数据源密码的 AES-256-GCM 密文；主密钥仅由服务端环境变量提供，不写入数据库';
COMMENT ON COLUMN data_source_credentials.ciphertext IS 'AES-256-GCM 加密后的密码密文';
COMMENT ON COLUMN data_source_credentials.iv IS '每次保存随机生成的 12 字节初始化向量';
COMMENT ON COLUMN data_source_credentials.auth_tag IS '用于验证密文完整性的 16 字节认证标签';
COMMENT ON COLUMN data_source_credentials.key_version IS '服务端主密钥版本，用于后续密钥轮换';
