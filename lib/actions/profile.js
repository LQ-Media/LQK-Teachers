"use server";

import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { AVATAR_DIR, MAX_AVATAR_BYTES, AVATAR_EXT_BY_TYPE, isLocalAvatar } from "@/lib/avatar";

export async function updateProfilePhoto(prevState, formData) {
  const session = await requireSession();
  const file = formData.get("photo");
  if (!file || typeof file === "string" || file.size === 0) {
    return { error: "Please choose an image to upload." };
  }
  const ext = AVATAR_EXT_BY_TYPE[file.type];
  if (!ext) return { error: "Use a JPEG, PNG, or WebP image." };
  if (file.size > MAX_AVATAR_BYTES) return { error: "That image is larger than 3 MB." };

  const db = getDb();
  const current = db.prepare("SELECT photo FROM profiles WHERE id = ?").get(session.userId);

  if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });
  const filename = `${session.userId}-${randomUUID().slice(0, 8)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  writeFileSync(path.join(AVATAR_DIR, filename), bytes);

  // Remove the previous local file so uploads don't accumulate.
  if (current && isLocalAvatar(current.photo)) {
    try {
      rmSync(path.join(AVATAR_DIR, current.photo));
    } catch {
      /* best-effort */
    }
  }

  db.prepare("UPDATE profiles SET photo = ? WHERE id = ?").run(filename, session.userId);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function removeProfilePhoto() {
  const session = await requireSession();
  const db = getDb();
  const current = db.prepare("SELECT photo FROM profiles WHERE id = ?").get(session.userId);
  if (current && isLocalAvatar(current.photo)) {
    try {
      rmSync(path.join(AVATAR_DIR, current.photo));
    } catch {
      /* best-effort */
    }
  }
  db.prepare("UPDATE profiles SET photo = NULL WHERE id = ?").run(session.userId);
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}
