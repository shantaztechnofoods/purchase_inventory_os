// Machine attachments store — public.machine_attachments + Storage bucket 'machine-attachments'
// Phase B. Requires the Supabase Storage bucket to exist (see migration 024 header).

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_attachments";
const BUCKET    = "machine-attachments";
const MAX_BYTES = 50 * 1024 * 1024;   // 50 MB — matches dashboard config

const fromRow = (r) => ({
  id:                r.id,
  machineId:         r.machine_id,
  department:        r.department,
  stage:             r.stage || r.department,
  kind:              r.kind,
  storagePath:       r.storage_path,
  fileName:          r.file_name || "",
  fileSize:          Number(r.file_size) || 0,
  mimeType:          r.mime_type || "",
  caption:           r.caption || "",
  isCustomerVisible: !!r.is_customer_visible,
  uploadedBy:        r.uploaded_by || null,
  uploadedAt:        r.uploaded_at || null,
});

const getLocal = () => { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; };
const setLocal = (a) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} };

// Pick a kind from the mime type if the caller didn't specify.
export function inferKind(mimeType, fileName = "") {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("image/")) return "photo";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf" && /trial/i.test(fileName)) return "trial_report";
  return "document";
}

export async function fetchAttachmentsForMachine(machineId) {
  if (!machineId) return [];
  if (!isSupabaseEnabled()) return getLocal().filter((a) => a.machineId === machineId);
  const c = getSupabase(); if (!c) return getLocal().filter((a) => a.machineId === machineId);
  const { data, error } = await c.from("machine_attachments").select("*").eq("machine_id", machineId).order("uploaded_at", { ascending: false });
  if (error) { console.warn("[attachments] load failed", error); return getLocal().filter((a) => a.machineId === machineId); }
  const out = (data || []).map(fromRow);
  // Mirror to local for offline reads.
  const otherLocal = getLocal().filter((a) => a.machineId !== machineId);
  setLocal([...out, ...otherLocal]);
  return out;
}

export async function fetchAllAttachments() {
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("machine_attachments").select("*").order("uploaded_at", { ascending: false });
  if (error) { console.warn("[attachments:all] load failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  return out;
}

export async function uploadAttachment({ machineId, department, stage, file, caption, isCustomerVisible = false, uploadedBy }) {
  if (!file) return { success: false, error: "No file" };
  if (file.size > MAX_BYTES) return { success: false, error: `File too large (max 50 MB).` };
  const kind = inferKind(file.type, file.name);
  const ts = Date.now();
  const cleanName = (file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${machineId}/${department}/${ts}-${cleanName}`;

  if (!isSupabaseEnabled()) {
    // Local mode: no actual upload. Store a data: URL for small previews only,
    // and bail with a friendly message for videos / large files.
    if (file.size > 2 * 1024 * 1024) {
      return { success: false, error: "Local mode cannot store files > 2 MB. Enable Supabase + create the 'machine-attachments' bucket." };
    }
    const reader = new FileReader();
    const dataUrl = await new Promise((res, rej) => {
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(reader.error);
      reader.readAsDataURL(file);
    });
    const row = { id: ts, machineId, department, stage: stage || department, kind, storagePath: dataUrl, fileName: file.name, fileSize: file.size, mimeType: file.type, caption: caption || "", isCustomerVisible: !!isCustomerVisible, uploadedBy: uploadedBy || null, uploadedAt: new Date().toISOString() };
    setLocal([row, ...getLocal()]);
    return { success: true, attachment: row };
  }

  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Step 1: Storage upload
  const up = await c.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type || undefined,
  });
  if (up.error) {
    console.error("[attachments:upload] storage failed", up.error);
    const notFound = /bucket .* not found|row-level security|new row violates/i.test(up.error.message || "");
    return {
      success: false,
      error: notFound
        ? "Upload rejected. Create the 'machine-attachments' Storage bucket (private, 50 MB limit) and apply migration 024 before uploading."
        : up.error.message,
    };
  }
  // Step 2: metadata row
  const { data, error } = await c.from("machine_attachments").insert({
    machine_id: machineId, department, stage: stage || department, kind,
    storage_path: path, file_name: file.name, file_size: file.size, mime_type: file.type,
    caption: caption || null, is_customer_visible: !!isCustomerVisible,
    uploaded_by: uploadedBy || null,
  }).select().single();
  if (error) {
    console.error("[attachments:row] failed", error);
    // Best-effort cleanup of the storage object so we don't leak.
    await c.storage.from(BUCKET).remove([path]).catch(() => {});
    return { success: false, error: error.message };
  }
  return { success: true, attachment: fromRow(data) };
}

// Returns a signed URL (private bucket) valid for 1 hour. For local-mode
// data URLs the storagePath IS the URL — return it as-is.
export async function signedUrlFor(attachment) {
  if (!attachment) return null;
  if (!isSupabaseEnabled()) return attachment.storagePath;
  const c = getSupabase(); if (!c) return null;
  const { data, error } = await c.storage.from(BUCKET).createSignedUrl(attachment.storagePath, 3600);
  if (error) { console.warn("[attachments:signUrl] failed", error); return null; }
  return data?.signedUrl || null;
}

export async function deleteAttachment(id) {
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().filter((a) => a.id !== id));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Fetch to learn storage_path
  const { data: existing } = await c.from("machine_attachments").select("storage_path").eq("id", id).maybeSingle();
  // `.select("id")` is load-bearing: without it PostgREST answers a DELETE
  // that matched ZERO rows with no error and no data, and this function
  // reported success for a delete that never happened. Zero rows means either
  // no such id or an RLS policy hiding the row from this user — both are
  // failures the caller must see. Same trap as machinesStore.deleteMachine.
  //
  // The check sits BEFORE the storage cleanup on purpose: if the row survived,
  // removing its file would leave a live attachment row pointing at nothing.
  const { data, error } = await c.from("machine_attachments").delete().eq("id", id).select("id");
  if (error) { console.error("[attachments:delete] row failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `attachment ${id} was not deleted — no such row, or it is not visible to this user`;
    console.error("[attachments:delete] matched no rows", { id });
    return { success: false, error: msg, noRows: true };
  }
  if (existing?.storage_path) {
    await c.storage.from(BUCKET).remove([existing.storage_path]).catch(() => {});
  }
  return { success: true };
}
