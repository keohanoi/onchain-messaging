import crypto from "crypto";
import { aesGcmEncrypt, toBase64 } from "./crypto";
import { StorageClient } from "./storage";
import { AttachmentManifest, EncryptedPayload } from "./types";

export async function encryptAttachment(
  file: Uint8Array,
  filename: string,
  mimeType: string,
  storage: StorageClient,
  messageKey: Uint8Array,
  thumbnail?: Uint8Array
): Promise<{ manifest: AttachmentManifest; encryptedFileCid: string; encryptedThumbnailCid?: string }> {
  const fileKey = crypto.randomBytes(32);
  const encrypted = aesGcmEncrypt(file, fileKey);
  const encryptedFileCid = await storage.add(encrypted.ciphertext);

  let encryptedThumbnailCid: string | undefined;
  if (thumbnail) {
    const thumbEncrypted = aesGcmEncrypt(thumbnail, fileKey);
    encryptedThumbnailCid = await storage.add(thumbEncrypted.ciphertext);
  }

  const hash = crypto.createHash("sha256").update(file).digest("hex");
  const wrappedKey = aesGcmEncrypt(fileKey, messageKey);
  const wrappedPayload: EncryptedPayload = {
    iv: toBase64(wrappedKey.iv),
    tag: toBase64(wrappedKey.tag),
    ciphertext: toBase64(wrappedKey.ciphertext)
  };

  const manifest: AttachmentManifest = {
    cid: encryptedFileCid,
    thumbnailCid: encryptedThumbnailCid,
    key: JSON.stringify(wrappedPayload),
    filename,
    size: file.length,
    mimeType,
    hash
  };

  return { manifest, encryptedFileCid, encryptedThumbnailCid };
}
