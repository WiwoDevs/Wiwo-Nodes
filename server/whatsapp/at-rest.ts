/**
 * Cifrado en reposo de lo que el worker de WhatsApp guarda en disco: la sesión de cada número
 * (credenciales con acceso a todos sus chats) y la cola local de mensajes recibidos que aún no
 * llegan a la API. AES-256-GCM con una clave derivada de SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY,
 * que la API y los workers ya comparten: copiar la carpeta sin esa clave no sirve.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const MAGIC = Buffer.from("WSAC1");

export function atRestKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("wiwo.sac:whatsapp-at-rest:v1").digest();
}

export function encryptAtRest(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptAtRest(key: Buffer, payload: Buffer): Buffer {
  if (payload.length < MAGIC.length + 28 || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Archivo cifrado con formato incompatible.");
  }
  const iv = payload.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payload.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(MAGIC.length + 28)), decipher.final()]);
}
