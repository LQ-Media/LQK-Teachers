import "server-only";
import path from "node:path";
import { getDataDir } from "@/lib/db";

// Uploaded certificate proof lives beside the avatars on the persistent volume
// (LQK_DATA_DIR on Railway), never in the repo — these are staff documents.
export const CERT_DIR = path.join(getDataDir(), "uploads", "certs");
export const MAX_CERT_BYTES = 8 * 1024 * 1024; // 8 MB — scans are bigger than avatars

export const CERT_EXT_BY_TYPE = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const CERT_CONTENT_TYPE = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

// Only filenames we generated are ever served from disk.
export function isCertFile(name) {
  return !!name && /^[a-f0-9-]+\.(jpg|png|webp|pdf)$/i.test(name);
}

export function isPdf(name) {
  return /\.pdf$/i.test(String(name || ""));
}
