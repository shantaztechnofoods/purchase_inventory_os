// Supabase Storage helpers for item media (photos + designs).
// We store only the public URL in items.photo / items.design_file. The actual file
// lives in the "item-media" bucket so the DB row stays small and PostgREST/realtime
// payloads don't carry megabytes of base64. Falls back to base64 data URLs in
// localStorage mode (dev/offline) so the form still works without Supabase.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

export const MEDIA_BUCKET = "item-media";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;    // 25 MB cap on Storage uploads
export const MAX_LOCAL_BYTES  = 5  * 1024 * 1024;    // 5 MB cap when degrading to data URL

function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function sanitize(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}
function fmtSize(b) { return (b / 1024 / 1024).toFixed(1) + " MB"; }

// Read a File/Blob as a base64 data URL (dev-mode fallback only).
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

/**
 * Upload an item media file (photo or design). In Supabase mode the file goes to
 * the item-media bucket and its public URL is returned. In local mode it's read as
 * a small data URL (kept under 5 MB so localStorage doesn't blow up).
 *
 * @param {"photos"|"designs"} folder
 * @param {File} file
 * @returns {Promise<{ ok: true, url: string, path?: string, stored: "supabase"|"local" }
 *                 | { ok: false, error: string }>}
 */
export async function uploadItemMedia(folder, file) {
  if (!file) return { ok: false, error: "No file selected" };

  // ── Supabase Storage path ─────────────────────────────────────────────────
  if (isSupabaseEnabled()) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: `File too large (${fmtSize(file.size)}). Maximum is ${fmtSize(MAX_UPLOAD_BYTES)}.` };
    }
    const c = getSupabase();
    if (!c) return { ok: false, error: "Supabase client unavailable" };

    const path = `${folder}/${randomId()}-${sanitize(file.name)}`;
    console.info("[storage] upload", { bucket: MEDIA_BUCKET, path, size: file.size, type: file.type });
    const { error: upErr } = await c.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });

    if (upErr) {
      console.error("[storage] upload failed", upErr);
      let hint = "";
      const msg = upErr.message || "";
      if (/bucket .* not found|404/i.test(msg)) {
        hint = ` — bucket "${MEDIA_BUCKET}" doesn't exist. Run migration 017 in Supabase SQL Editor.`;
      } else if (/exceeded the maximum allowed size|payload too large|413/i.test(msg)) {
        hint = " — Storage bucket file-size limit reached. Raise it in the Supabase dashboard.";
      } else if (/new row violates row-level security|403/i.test(msg)) {
        hint = " — RLS denied the upload. Confirm migration 017 created the auth-upload policy.";
      }
      return { ok: false, error: msg + hint };
    }

    const { data: pub } = c.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl;
    if (!url) return { ok: false, error: "Upload succeeded but could not resolve public URL." };
    console.info("[storage] upload ok", { url });
    return { ok: true, url, path, stored: "supabase" };
  }

  // ── Local/offline fallback (data URL, small cap) ──────────────────────────
  if (file.size > MAX_LOCAL_BYTES) {
    return { ok: false, error: `File too large for offline mode (${fmtSize(file.size)}, max ${fmtSize(MAX_LOCAL_BYTES)}). Enable Supabase to upload large files.` };
  }
  try {
    const url = await readAsDataURL(file);
    return { ok: true, url, stored: "local" };
  } catch (e) {
    return { ok: false, error: e.message || "Could not read file" };
  }
}

/**
 * Best-effort cleanup of an item-media object by public URL. Failures are non-fatal
 * (the file just stays in the bucket). Skipped for data URLs and non-Supabase mode.
 */
export async function deleteItemMediaByUrl(url) {
  if (!url || typeof url !== "string") return;
  if (!isSupabaseEnabled()) return;
  if (url.startsWith("data:")) return;
  const c = getSupabase();
  if (!c) return;
  // Extract the bucket-relative path from a public URL like
  //   https://xxx.supabase.co/storage/v1/object/public/item-media/photos/uuid-name.png
  const marker = `/${MEDIA_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = url.slice(idx + marker.length);
  try {
    const { error } = await c.storage.from(MEDIA_BUCKET).remove([path]);
    if (error) console.warn("[storage] delete failed (non-fatal)", { path, error: error.message });
    else console.info("[storage] delete ok", { path });
  } catch (e) {
    console.warn("[storage] delete threw (non-fatal)", e);
  }
}
