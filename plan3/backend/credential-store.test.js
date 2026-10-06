"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  CredentialStoreError,
  decryptPassword,
  encryptPassword,
  parseMasterKey,
} = require("./credential-store");

test("accepts a 32-byte Base64 or hexadecimal master key", () => {
  const key = Buffer.alloc(32, 7);
  assert.deepEqual(parseMasterKey(key.toString("base64")), key);
  assert.deepEqual(parseMasterKey(key.toString("hex")), key);
});

test("rejects missing and invalid master keys", () => {
  assert.throws(() => parseMasterKey(""), (error) => (
    error instanceof CredentialStoreError && error.code === "CREDENTIAL_MASTER_KEY_MISSING"
  ));
  assert.throws(() => parseMasterKey("too-short"), (error) => (
    error instanceof CredentialStoreError && error.code === "CREDENTIAL_MASTER_KEY_INVALID"
  ));
});

test("encrypts and decrypts a password for the same data source", () => {
  const key = Buffer.alloc(32, 11);
  const encrypted = encryptPassword("42", "s3cret-密码", key);
  assert.notEqual(encrypted.ciphertext.toString("utf8"), "s3cret-密码");
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.equal(decryptPassword("42", encrypted, key), "s3cret-密码");
});

test("rejects swapped, tampered, or wrongly keyed ciphertext", () => {
  const key = Buffer.alloc(32, 17);
  const encrypted = encryptPassword("42", "s3cret", key);
  assert.throws(() => decryptPassword("43", encrypted, key), /解密失败/);

  const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => decryptPassword("42", tampered, key), /解密失败/);
  assert.throws(() => decryptPassword("42", encrypted, Buffer.alloc(32, 18)), /解密失败/);
});
