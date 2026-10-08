/**
 * Object storage for trade photos and buyer drafts (S3). Photos are private: the only way to read one is a
 * short-lived presigned GET minted by a route that has already checked who is asking (see access.ts).
 *
 *   trade-drafts/{draftId}/draft.json        the buyer's in-progress fields
 *   trade-drafts/by-user/{userId}.json       pointer to that buyer's latest draft (resume on any device)
 *   trade/{id}/{slot}.jpg                    photos; {id} is the draft id while drafting, the quote request id once sent
 *
 * Everything goes through the TradeStorage interface so tests run against an in-memory fake.
 */
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverSecret } from "../serverSecret";
import type { PhotoSlot } from "./types";

export const SIGNED_GET_SECONDS = 300;
export const SIGNED_PUT_SECONDS = 300;
export const MAX_STORED_PHOTO_BYTES = 10 * 1024 * 1024;

export const photoKey = (id: string, slot: PhotoSlot) => `trade/${id}/${slot}.jpg`;
export const draftKey = (draftId: string) => `trade-drafts/${draftId}/draft.json`;
export const userDraftKey = (userId: string) => `trade-drafts/by-user/${encodeURIComponent(userId)}.json`;

export interface ObjectHead { size: number; contentType: string | null }

export interface TradeStorage {
  signedGetUrl(key: string, seconds?: number): Promise<string>;
  signedPutUrl(key: string, contentType: string, seconds?: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  copy(fromKey: string, toKey: string): Promise<void>;
  remove(key: string): Promise<void>;
  getJson<T>(key: string): Promise<T | null>;
  putJson(key: string, value: unknown): Promise<void>;
}

export class StorageNotConfigured extends Error {
  constructor() { super("Photo storage isn't configured (TRADE_S3_BUCKET)."); }
}

let client: S3Client | null = null;
function s3(): { client: S3Client; bucket: string } {
  const bucket = serverSecret("TRADE_S3_BUCKET");
  if (!bucket) throw new StorageNotConfigured();
  if (!client) {
    const accessKeyId = serverSecret("TRADE_S3_ACCESS_KEY_ID");
    const secretAccessKey = serverSecret("TRADE_S3_SECRET_ACCESS_KEY");
    client = new S3Client({
      region: serverSecret("TRADE_S3_REGION") || "us-east-1",
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }
  return { client, bucket };
}

export const s3Storage: TradeStorage = {
  async signedGetUrl(key, seconds = SIGNED_GET_SECONDS) {
    const { client, bucket } = s3();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: "image/jpeg", ResponseCacheControl: "private, max-age=60" }), { expiresIn: seconds });
  },
  async signedPutUrl(key, contentType, seconds = SIGNED_PUT_SECONDS) {
    const { client, bucket } = s3();
    return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), { expiresIn: seconds });
  },
  async head(key) {
    const { client, bucket } = s3();
    try {
      const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? null };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string })?.name === "NotFound") return null;
      throw err;
    }
  },
  async copy(fromKey, toKey) {
    const { client, bucket } = s3();
    await client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${fromKey.split("/").map(encodeURIComponent).join("/")}`, Key: toKey, ContentType: "image/jpeg", MetadataDirective: "REPLACE" }));
  },
  async remove(key) {
    const { client, bucket } = s3();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
  async getJson<T>(key: string) {
    const { client, bucket } = s3();
    try {
      const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return JSON.parse((await r.Body?.transformToString()) || "null") as T | null;
    } catch (err) {
      if ((err as { name?: string })?.name === "NoSuchKey") return null;
      throw err;
    }
  },
  async putJson(key, value) {
    const { client, bucket } = s3();
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }));
  },
};

/** In-memory fake for tests. Signed URLs are inspectable strings: `fake://get/<key>?exp=<seconds>`. */
export function memoryStorage(): TradeStorage & { objects: Map<string, { size: number; contentType: string | null }>; json: Map<string, unknown> } {
  const objects = new Map<string, { size: number; contentType: string | null }>();
  const json = new Map<string, unknown>();
  return {
    objects, json,
    async signedGetUrl(key, seconds = SIGNED_GET_SECONDS) { return `fake://get/${key}?exp=${seconds}`; },
    async signedPutUrl(key, _ct, seconds = SIGNED_PUT_SECONDS) { return `fake://put/${key}?exp=${seconds}`; },
    async head(key) { return objects.get(key) ?? null; },
    async copy(from, to) { const o = objects.get(from); if (!o) throw new Error("NoSuchKey"); objects.set(to, o); },
    async remove(key) { objects.delete(key); },
    async getJson<T>(key: string) { return (json.get(key) as T | undefined) ?? null; },
    async putJson(key, value) { json.set(key, JSON.parse(JSON.stringify(value))); },
  };
}
