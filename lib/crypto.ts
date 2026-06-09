/**
 * Field-level encryption for sensitive database values (Stripe keys, etc.)
 *
 * Algorithm : AES-256-GCM
 * Key source : FIELD_ENCRYPTION_KEY env var — 64 hex chars (32 bytes)
 * Wire format: "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 *
 * The "enc:v1:" prefix lets decrypt() distinguish encrypted values from
 * legacy plain-text values, so existing records keep working without a
 * data migration.
 *
 * When FIELD_ENCRYPTION_KEY is not set the module falls back to a no-op
 * (plain-text pass-through) and emits a single startup warning. This keeps
 * CI / local dev working without the key while still protecting production.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit IV — recommended for GCM
const TAG_BYTES = 16; // 128-bit auth tag — GCM default
const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[crypto] WARNING: FIELD_ENCRYPTION_KEY is not set. " +
          "Stripe credentials will be stored as plain text. " +
          "Set a 64-char hex key in production.",
      );
    }
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

// Load once at module initialisation
const KEY = loadKey();

/**
 * Encrypts a plain-text string.
 * Returns the plain text unchanged when FIELD_ENCRYPTION_KEY is not set.
 */
export function encrypt(plain: string): string {
  if (!KEY) return plain;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return (
    PREFIX +
    iv.toString("hex") +
    ":" +
    tag.toString("hex") +
    ":" +
    ciphertext.toString("hex")
  );
}

/**
 * Decrypts a value produced by encrypt().
 * If the value does not start with "enc:v1:" it is returned as-is so that
 * plain-text values written before encryption was enabled keep working.
 */
export function decrypt(value: string): string {
  if (!value.startsWith(PREFIX)) {
    // Plain-text — either legacy record or encryption not enabled
    return value;
  }

  if (!KEY) {
    throw new Error(
      "Cannot decrypt a field-encrypted value: FIELD_ENCRYPTION_KEY is not set.",
    );
  }

  const payload = value.slice(PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted field value.");
  }

  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}

/**
 * Safely decrypts a nullable DB field.
 * Returns null/undefined as-is.
 */
export function decryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decrypt(value);
}

/**
 * Returns a SHA-256 fingerprint of the plaintext key for logging.
 * Safe to write to logs — does not expose the key.
 */
export function keyFingerprint(plain: string): string {
  return createHash("sha256").update(plain).digest("hex").slice(0, 8);
}
