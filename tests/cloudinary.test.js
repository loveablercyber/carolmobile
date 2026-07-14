import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudinaryProviderForRotation,
  createCloudinaryUploadSignature,
  isConfiguredCloudinaryUrl,
  isConfiguredMinioUrl,
  parseCloudinaryAssetUrl,
} from "../server/lib/integrations.js";

const providers = [
  { name: "one", cloudName: "cloud-one", apiKey: "key-one", apiSecret: "secret-one" },
  { name: "two", cloudName: "cloud-two", apiKey: "key-two", apiSecret: "secret-two" },
  { name: "three", cloudName: "cloud-three", apiKey: "key-three", apiSecret: "secret-three" },
];

test("rotates Cloudinary providers in sequence and wraps around", () => {
  assert.equal(cloudinaryProviderForRotation("1", providers).cloudName, "cloud-one");
  assert.equal(cloudinaryProviderForRotation("2", providers).cloudName, "cloud-two");
  assert.equal(cloudinaryProviderForRotation("3", providers).cloudName, "cloud-three");
  assert.equal(cloudinaryProviderForRotation("4", providers).cloudName, "cloud-one");
  assert.equal(cloudinaryProviderForRotation("100000000000000000000", providers).cloudName, "cloud-one");
});

test("creates an upload signature without returning the API secret", () => {
  const signed = createCloudinaryUploadSignature(providers[0], {
    timestamp: 1_750_000_000,
    folder: "carol-sol/profile-photo",
  });
  assert.equal(signed.cloudName, "cloud-one");
  assert.equal(signed.apiKey, "key-one");
  assert.equal(signed.folder, "carol-sol/profile-photo");
  assert.equal(typeof signed.signature, "string");
  assert.equal("apiSecret" in signed, false);
});

test("parses image and raw Cloudinary URLs for safe deletion", () => {
  assert.deepEqual(
    parseCloudinaryAssetUrl(
      "https://res.cloudinary.com/cloud-one/image/upload/v123/carol-sol/photo/avatar.jpg",
    ),
    {
      cloudName: "cloud-one",
      resourceType: "image",
      deliveryType: "upload",
      publicId: "carol-sol/photo/avatar",
    },
  );
  assert.deepEqual(
    parseCloudinaryAssetUrl(
      "https://res.cloudinary.com/cloud-two/raw/upload/v456/carol-sol/receipt/file.pdf",
    ),
    {
      cloudName: "cloud-two",
      resourceType: "raw",
      deliveryType: "upload",
      publicId: "carol-sol/receipt/file.pdf",
    },
  );
  assert.equal(parseCloudinaryAssetUrl("https://example.com/file.jpg"), null);
});

test("accepts local upload URLs when local storage is enabled", () => {
  const previous = process.env.LOCAL_UPLOAD_ENABLED;
  process.env.LOCAL_UPLOAD_ENABLED = "true";
  try {
    assert.equal(
      isConfiguredCloudinaryUrl("/uploads/carol-sol/profile-photo/2026/07/14/avatar.jpg", ["image"]),
      true,
    );
    assert.equal(
      isConfiguredCloudinaryUrl("https://example.com/uploads/carol-sol/payment/file.pdf", ["raw"]),
      true,
    );
    assert.equal(
      isConfiguredCloudinaryUrl("/uploads/carol-sol/payment/file.pdf", ["image"]),
      false,
    );
  } finally {
    if (previous === undefined) delete process.env.LOCAL_UPLOAD_ENABLED;
    else process.env.LOCAL_UPLOAD_ENABLED = previous;
  }
});

test("accepts MinIO upload URLs when S3 storage is configured", () => {
  const previous = {
    MINIO_ENDPOINT: process.env.MINIO_ENDPOINT,
    MINIO_PUBLIC_URL: process.env.MINIO_PUBLIC_URL,
    MINIO_BUCKET: process.env.MINIO_BUCKET,
    MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY,
    MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY,
  };
  process.env.MINIO_ENDPOINT = "https://minio.example.com";
  process.env.MINIO_PUBLIC_URL = "https://cdn.example.com";
  process.env.MINIO_BUCKET = "carolmobile";
  process.env.MINIO_ACCESS_KEY = "key";
  process.env.MINIO_SECRET_KEY = "secret";
  try {
    const imageUrl = "https://cdn.example.com/carolmobile/carol-sol/client-photo/2026/07/14/photo.jpg";
    const rawUrl = "https://cdn.example.com/carolmobile/carol-sol/payment-receipt/2026/07/14/file.pdf";
    assert.equal(isConfiguredMinioUrl(imageUrl, ["image"]), true);
    assert.equal(isConfiguredCloudinaryUrl(rawUrl, ["raw"]), true);
    assert.equal(isConfiguredCloudinaryUrl(rawUrl, ["image"]), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
