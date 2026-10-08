import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";
import crypto from "crypto";

let _s3Client: S3Client | null = null;

function getS3Client() {
  if (!_s3Client) {
    if (!ENV.s3EndpointUrl || !ENV.s3AccessKeyId || !ENV.s3SecretAccessKey) {
      throw new Error("S3 config missing: check AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
    }
    _s3Client = new S3Client({
      region: ENV.s3Region,
      endpoint: ENV.s3EndpointUrl,
      credentials: {
        accessKeyId: ENV.s3AccessKeyId,
        secretAccessKey: ENV.s3SecretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return _s3Client;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const key = appendHashSuffix(normalizeKey(relKey));

  const command = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    ContentType: contentType,
    Body: data,
  });

  await client.send(command);

  return { key, url: `/local-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/local-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const client = getS3Client();
  const key = normalizeKey(relKey);

  const command = new GetObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 3600 });
  return url;
}
