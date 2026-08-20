import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export class CredentialVault {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 24) throw new Error("La clave de cifrado de credenciales debe tener al menos 24 caracteres.");
    this.key = keyFromSecret(secret);
  }

  encrypt(data: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
  }

  decrypt(payload: string): Record<string, unknown> {
    const [version, iv, tag, ciphertext] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("La credencial cifrada tiene un formato incompatible.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
    const decoded: unknown = JSON.parse(plaintext);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("La credencial descifrada no contiene un objeto.");
    return decoded as Record<string, unknown>;
  }
}
