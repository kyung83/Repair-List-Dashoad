import { createCipheriv, createDecipheriv, createHash, constants, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const algorithm = 'RSA-OAEP-SHA256+A256GCM';
export function sealInventory(value, publicKey) {
  const plaintext = Buffer.from(JSON.stringify(value));
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
  return { version: 1, algorithm, compression: 'gzip',
    wrappedKey: publicEncrypt({ key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    plaintextSha256: createHash('sha256').update(plaintext).digest('hex') };
}

export function openInventory(envelope, privateKey) {
  if (envelope?.version !== 1 || envelope.algorithm !== algorithm || envelope.compression !== 'gzip') throw new Error('Unsupported protected inventory envelope.');
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(envelope.wrappedKey, 'base64'));
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('Invalid protected inventory envelope.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  const plaintext = gunzipSync(compressed, { maxOutputLength: 50 * 1024 * 1024 });
  if (createHash('sha256').update(plaintext).digest('hex') !== envelope.plaintextSha256) throw new Error('Protected inventory checksum failed.');
  return JSON.parse(plaintext.toString('utf8'));
}
