// Platform values are read at use time. See the Webdev service/authentication skills.
export const ENV = {
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get s3EndpointUrl() { return process.env.AWS_ENDPOINT_URL_S3 ?? ""; },
  get s3AccessKeyId() { return process.env.AWS_ACCESS_KEY_ID ?? ""; },
  get s3SecretAccessKey() { return process.env.AWS_SECRET_ACCESS_KEY ?? ""; },
  get s3Region() { return process.env.AWS_REGION ?? "eu-central-1"; },
  get s3Bucket() { return process.env.AWS_S3_BUCKET ?? "mosaic"; },
  get forgeApiUrl() { return ""; },
  get forgeApiKey() { return ""; },
};
