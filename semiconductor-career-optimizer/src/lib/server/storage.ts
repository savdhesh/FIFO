import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export interface Storage {
  put(userId: string, data: Buffer, ext: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** Local disk, outside any web-served directory. Keys are random; the original filename is never used as a path. */
class LocalStorage implements Storage {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(userId: string, data: Buffer, ext: string) {
    const key = `${userId}/${crypto.randomUUID()}.${ext}`;
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fs.writeFile(p, data, { mode: 0o600 });
    return key;
  }
  get(key: string) { return fs.readFile(this.resolve(key)); }
  async delete(key: string) { await fs.rm(this.resolve(key), { force: true }); }
}

/** S3-compatible (AWS S3, R2, MinIO, Supabase Storage S3 endpoint). Needs `npm i @aws-sdk/client-s3`. Objects are private. */
class S3Storage implements Storage {
  private async client() {
    const mod = await import(/* webpackIgnore: true */ "@aws-sdk/client-s3" as string);
    return { mod, c: new mod.S3Client({ region: process.env.S3_REGION || "auto", endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: !!process.env.S3_ENDPOINT, credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! } }) };
  }
  async put(userId: string, data: Buffer, ext: string) {
    const key = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { mod, c } = await this.client();
    await c.send(new mod.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: data, ServerSideEncryption: process.env.S3_ENDPOINT ? undefined : "AES256" }));
    return key;
  }
  async get(key: string) {
    const { mod, c } = await this.client();
    const r = await c.send(new mod.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async delete(key: string) {
    const { mod, c } = await this.client();
    await c.send(new mod.DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  }
}

let s: Storage | null = null;
export function storage(): Storage {
  if (!s) s = process.env.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(process.env.STORAGE_DIR || "./storage");
  return s;
}
