// AES-256-GCM encryption helpers — used by all edge functions that handle tokens at rest.
//
// Key: ENCRYPTION_KEY env var — 64-char hex string (32 bytes).
//      Generate with: openssl rand -hex 32
//
// Stored format: enc:v1:<iv_hex>:<ciphertext_base64>
// Backward compat: values WITHOUT the "enc:v1:" prefix are returned as-is (plaintext legacy).

const ENC_PREFIX = "enc:v1:";

// O ArrayBuffer é alocado explicitamente para que o tipo seja
// Uint8Array<ArrayBuffer> e não Uint8Array<ArrayBufferLike>: sem isso o
// `deno check` recusa passar o valor para crypto.subtle, que espera BufferSource.
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getKey(): Promise<CryptoKey> {
  const keyHex = Deno.env.get("ENCRYPTION_KEY") ?? "";
  if (keyHex.length !== 64) throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Run: openssl rand -hex 32");
  return crypto.subtle.importKey("raw", hexToBytes(keyHex), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string): Promise<string> {
  const key      = await getKey();
  const iv       = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV — GCM standard
  const encoded  = new TextEncoder().encode(plaintext);
  const cipher   = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const ct       = btoa(String.fromCharCode(...new Uint8Array(cipher)));
  return `${ENC_PREFIX}${bytesToHex(iv)}:${ct}`;
}

// decrypt is intentionally backward-compatible: plaintext values pass through unchanged.
export async function decrypt(value: string): Promise<string> {
  if (!value.startsWith(ENC_PREFIX)) return value;

  const rest     = value.slice(ENC_PREFIX.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid encrypted token format");

  const iv         = hexToBytes(rest.slice(0, colonIdx));
  const ciphertext = Uint8Array.from(atob(rest.slice(colonIdx + 1)), (c) => c.charCodeAt(0));
  const key        = await getKey();
  const decrypted  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
