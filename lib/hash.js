import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password, stored) {
  const [salt, derived] = stored.split(":");
  const derivedBuffer = Buffer.from(derived, "hex");
  const candidateBuffer = scryptSync(password, salt, 64);
  if (derivedBuffer.length !== candidateBuffer.length) return false;
  return timingSafeEqual(derivedBuffer, candidateBuffer);
}
