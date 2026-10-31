// Rack slots — pure helpers (2026-10-31, brief §14; fixed BOMs 2026-10-31).
//
// TWELVE independent rack units on the floor — M-10 (1), M-10 (2), R-10 (1),
// R-10 (2), … R-20 (2), laid out with each M unit above its R unit. Every
// unit holds ONE machine with its OWN BOM issue and its OWN serial number
// (2026-10-31: M and R BOM Outward are completely independent — nothing is
// copied or auto-filled between an M unit and the R unit below it). Units
// are stored as the slots of each model rack: "M-10 (2)" = slot "M-10-1#2".
// Every rack takes ONE BOM: the M-10 unit the M-10 BOM, the R-10 unit the
// R-10 BOM, and so on. A BOM that is not listed here (AM900, ARM1800, TM600,
// VK, PILOT-KM10, TRIAL-01, KM-10 and every future R&D BOM) has no rack and
// goes to Direct Production only.
//
// `legacy` keys: KM10 / KM15 / KM20 were replaced by M-10 / M-15 / M-20 on
// 2026-10-31. Machines already issued under the old keys keep their history
// and keep the slot they hold; no new set can be issued under a retired BOM.
//
// Slot ids keep the format used since migration 045, "M-10-1#2" (rack M-10,
// column 1, position 2), so slots saved before this change stay valid.
//
// Unit status:
//   empty       nothing in it                         → Fill Rack
//   set         BOM issued, waiting (stage BOM Issued) → Assemble
//   assembling  taken off for assembly (stage Assembly, slot kept)
//   assembled   assembled, back on the rack, awaiting release → Send to Mechanical

export const PHYSICAL_RACK_LAYOUT = {
  setsPerRack: 2,
  tiers: ["M", "R"],            // top → bottom within each vertical pair
  families: [
    { id: "10", label: "10", columns: 1, color: "#1d4ed8", tiers: { M: { boms: ["M-10"], legacy: ["KM10"] }, R: { boms: ["R-10"], legacy: [] } } },
    { id: "15", label: "15", columns: 1, color: "#15803d", tiers: { M: { boms: ["M-15"], legacy: ["KM15"] }, R: { boms: ["R-15"], legacy: [] } } },
    { id: "20", label: "20", columns: 1, color: "#ea580c", tiers: { M: { boms: ["M-20"], legacy: ["KM20"] }, R: { boms: ["R-20"], legacy: [] } } },
  ],
};

// Exact key match (case and surrounding spaces ignored). Deliberately NOT
// punctuation-insensitive: "KM-10" (an R&D/test BOM) must not land on a rack.
export const rackKeyNorm = (k) => String(k || "").trim().toUpperCase();

// { family, tier, legacy } for a BOM key, or null when it has no fixed rack.
export function rackOfBom(bomKey, layout = PHYSICAL_RACK_LAYOUT) {
  const k = rackKeyNorm(bomKey);
  if (!k) return null;
  for (const f of layout.families) {
    for (const tier of layout.tiers) {
      const t = (f.tiers && f.tiers[tier]) || { boms: [], legacy: [] };
      if ((t.boms || []).some((b) => rackKeyNorm(b) === k)) return { family: f, tier, legacy: false };
      if ((t.legacy || []).some((b) => rackKeyNorm(b) === k)) return { family: f, tier, legacy: true };
    }
  }
  return null;
}

// The BOM keys a rack accepts: { primary, keys } (primary = the one Fill opens).
export function rackBoms(family, tier) {
  const t = (family && family.tiers && family.tiers[tier]) || { boms: [], legacy: [] };
  return { primary: (t.boms || [])[0] || null, keys: [...(t.boms || []), ...(t.legacy || [])] };
}

export function physicalRackFamily(bomKey, layout = PHYSICAL_RACK_LAYOUT) {
  const r = rackOfBom(bomKey, layout);
  return r ? r.family : null;
}

// Slots a BOM has on the physical racks (its own rack only), or null.
export function physicalRackSlots(bomKey, layout = PHYSICAL_RACK_LAYOUT) {
  const r = rackOfBom(bomKey, layout);
  return r ? r.family.columns * layout.setsPerRack : null;
}

export function rackCapacityFor(bomKey, _def, layout = PHYSICAL_RACK_LAYOUT) {
  const slots = physicalRackSlots(bomKey, layout);
  return slots != null ? slots : 0;
}

export const rackIdOf = (tier, familyLabel, column) => `${tier}-${familyLabel}-${column}`;
export const rackNameOf = (tier, familyLabel, column, columns = 1) => (columns > 1 ? `${tier}-${familyLabel} (${column})` : `${tier}-${familyLabel}`);
export const slotIdOf = (rackId, position) => `${rackId}#${position}`;
export function slotLabel(slotId) {
  const m = /^([A-Z])-([^-]+)-(\d+)#(\d+)$/.exec(String(slotId || ""));
  if (!m) return String(slotId || "");
  // Each slot is one independent rack unit on the floor: "M-10 (2)".
  return m[3] === "1" ? `${m[1]}-${m[2]} (${m[4]})` : `${m[1]}-${m[2]} (${m[3]}.${m[4]})`;
}
export const tierOfSlot = (slotId) => (/^([A-Z])-/.exec(String(slotId || "")) || [])[1] || null;

// The other unit of the same machine set: "M-10-1#2" ⇄ "R-10-1#2".
export function pairSlotOf(slotId) {
  const m = /^([MR])-(.+)$/.exec(String(slotId || ""));
  return m ? `${m[1] === "M" ? "R" : "M"}-${m[2]}` : null;
}
// The canonical (M) slot id of the set a unit belongs to.
export const setSlotOf = (slotId) => (tierOfSlot(slotId) === "R" ? pairSlotOf(slotId) : (slotId || null));
// "M-10 (2) + R-10 (2)"
export const setLabel = (slotId) => { const m = setSlotOf(slotId); return m ? `${slotLabel(m)} + ${slotLabel(pairSlotOf(m))}` : ""; };

// Slot ids of a family (optionally one tier only), rack by rack, in floor order.
export function familySlotIds(family, layout = PHYSICAL_RACK_LAYOUT, tier = null) {
  const out = [];
  for (let c = 1; c <= family.columns; c++)
    for (const t of layout.tiers) {
      if (tier && t !== tier) continue;
      for (let n = 1; n <= layout.setsPerRack; n++) out.push(slotIdOf(rackIdOf(t, family.label, c), n));
    }
  return out;
}

const createdOrder = (a, b) =>
  (a.createdDate || "").localeCompare(b.createdDate || "") || (Number(a.id) || 0) - (Number(b.id) || 0);

// Machines that physically sit on (or belong to) a family's racks.
//   awaitingReleaseIds — Set of machine ids whose Assembly → Mechanical
//   handover is parked on the rack (release_required, not released).
export function rackMachinesOfFamily(family, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  return (machineLog || []).filter((m) => {
    if (!m || m.status === "completed") return false;
    if (rackOfBom(m.bomKey, layout)?.family.id !== family.id) return false;
    if (m.stage === "BOM Issued") return true;
    if (awaitingReleaseIds.has(String(m.id))) return true;
    // Taken off for assembly: only while it still holds a slot.
    if (m.stage === "Assembly" && m.rackSlot) return true;
    return false;
  }).sort(createdOrder);
}

export function slotStatusOf(machine, awaitingReleaseIds = new Set()) {
  if (!machine) return "empty";
  if (awaitingReleaseIds.has(String(machine.id))) return "assembled";
  if (machine.stage === "BOM Issued") return "set";
  return "assembling";
}

// Place a family's machines into its slots. Explicit slots first (a valid,
// not-yet-taken slot id wins; the oldest machine keeps a contested slot), then
// legacy BOM-Issued machines without a slot fill the remaining free slots
// oldest-first. Returns { columns: [[rack, rack], …], overflow, placed }.
export function buildFamilyRacks(family, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  const ids = familySlotIds(family, layout);
  const machines = rackMachinesOfFamily(family, machineLog, awaitingReleaseIds, layout);
  const bySlot = {};
  const unplaced = [];
  for (const m of machines) {
    // A pinned slot counts only on the machine's own rack (M BOM → M rack).
    const tier = rackOfBom(m.bomKey, layout)?.tier;
    if (m.rackSlot && ids.includes(m.rackSlot) && tierOfSlot(m.rackSlot) === tier && !bySlot[m.rackSlot]) bySlot[m.rackSlot] = { machine: m, pinned: true };
    else unplaced.push(m);
  }
  const overflow = [];
  for (const m of unplaced) {
    // Only material sets flow into free slots automatically, and only into a
    // slot of their own rack; anything else is listed as overflow.
    const tier = rackOfBom(m.bomKey, layout)?.tier;
    const free = m.stage === "BOM Issued" ? familySlotIds(family, layout, tier).find((id) => !bySlot[id]) : null;
    if (free) bySlot[free] = { machine: m, pinned: false };
    else overflow.push(m);
  }
  const columns = [];
  for (let c = 1; c <= family.columns; c++) {
    const pair = layout.tiers.map((tier) => {
      const rackId = rackIdOf(tier, family.label, c);
      const slots = [];
      for (let n = 1; n <= layout.setsPerRack; n++) {
        const id = slotIdOf(rackId, n);
        const e = bySlot[id];
        slots.push({ id, setId: id, pairId: pairSlotOf(id), position: n, machine: e ? e.machine : null, pinned: !!(e && e.pinned), status: slotStatusOf(e && e.machine, awaitingReleaseIds) });
      }
      const occupied = slots.filter((s) => s.machine).length;
      const sets = slots.filter((s) => s.status === "set").length;
      return {
        id: rackId, name: rackNameOf(tier, family.label, c, family.columns), tier, column: c, slots,
        bom: rackBoms(family, tier),
        capacity: layout.setsPerRack, occupied, ready: sets, empty: layout.setsPerRack - occupied,
        state: occupied >= layout.setsPerRack ? "full" : occupied > 0 ? "partial" : "empty",
      };
    });
    columns.push(pair);
  }
  return { columns, overflow, placed: bySlot };
}

// First free slot on a BOM's own rack, honouring a preferred slot (from a
// Fill action) when it is on that rack and still empty. Null when the BOM has
// no fixed rack or both slots are taken.
export function firstFreeSlot(bomKey, machineLog = [], awaitingReleaseIds = new Set(), preferred = null, layout = PHYSICAL_RACK_LAYOUT) {
  const r = rackOfBom(bomKey, layout);
  if (!r) return null;
  const { placed } = buildFamilyRacks(r.family, machineLog, awaitingReleaseIds, layout);
  const ids = familySlotIds(r.family, layout, r.tier);
  if (preferred && ids.includes(preferred) && !placed[preferred]) return preferred;
  return ids.find((id) => !placed[id]) || null;
}

// Can `machine` be put into `slotId`? Returns { ok, error }.
export function canAssignSlot(machine, slotId, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  if (!machine) return { ok: false, error: "Machine not found" };
  const r = rackOfBom(machine.bomKey, layout);
  if (!r) return { ok: false, error: `${machine.bomKey} has no fixed rack — Direct Production only` };
  if (!familySlotIds(r.family, layout, r.tier).includes(slotId)) return { ok: false, error: `${slotLabel(slotId)} is not on the ${r.tier}-${r.family.label} rack — a ${machine.bomKey} machine can only go on its own rack` };
  if (machine.stage !== "BOM Issued" && !awaitingReleaseIds.has(String(machine.id)) && !(machine.stage === "Assembly" && machine.rackSlot))
    return { ok: false, error: "Only a machine on the rack can be assigned a slot" };
  const { placed } = buildFamilyRacks(r.family, machineLog, awaitingReleaseIds, layout);
  const e = placed[slotId];
  if (e && e.pinned && String(e.machine.id) !== String(machine.id)) return { ok: false, error: `${slotLabel(slotId)} already holds ${e.machine.serialNo || e.machine.bomKey}` };
  const already = (machineLog || []).find((m) => m.rackSlot === slotId && String(m.id) !== String(machine.id) && m.status !== "completed");
  if (already) return { ok: false, error: `${slotLabel(slotId)} already holds ${already.serialNo || already.bomKey}` };
  return { ok: true };
}

// Every free unit of a BOM's own rack, in floor order (BOM Outward lets the
// operator pick one). [] when the BOM has no fixed rack or both are taken.
export function freeSlotsFor(bomKey, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  const r = rackOfBom(bomKey, layout);
  if (!r) return [];
  const { placed } = buildFamilyRacks(r.family, machineLog, awaitingReleaseIds, layout);
  return familySlotIds(r.family, layout, r.tier).filter((id) => !placed[id]);
}

// The machine log as the rack sees it: a machine whose rack hand-over has
// been released (release_required + released_at) has left its slot, whatever
// machine_log.rack_slot still says. Clearing rack_slot can be refused by RLS
// for a releaser without machines.updateStage, so the released hand-over is
// the source of truth.
export function rackViewLog(machineLog = [], handovers = []) {
  const released = new Set((handovers || [])
    .filter((h) => h && h.releaseRequired && h.releasedAt && h.status !== "cancelled")
    .map((h) => String(h.machineId)));
  if (released.size === 0) return machineLog || [];
  return (machineLog || []).map((m) => (m && m.rackSlot && released.has(String(m.id)) && m.stage === "Assembly" ? { ...m, rackSlot: null } : m));
}

// Can `bomKey` be issued as one complete crate? The BOM must exist, be live,
// have components, and every line must be in the Item Master and fully in
// stock. Each rack keeps its OWN BOM — M and R are never merged.
// stockOf(code) → Item Master record or undefined.
// Returns { ok, why, key, empty, lines, short }.
export function bomFillCheck(bomKey, bomDefs = {}, stockOf = () => undefined) {
  const def = bomKey ? bomDefs[bomKey] : null;
  const res = (why, extra = {}) => ({ ok: !why, why, key: bomKey, empty: false, lines: [], short: [], ...extra });
  if (!bomKey) return res("No BOM is mapped to this rack");
  if (!def || def.retiredAt) return res(`Create the ${bomKey} BOM first`);
  const items = (def.items || []).filter((l) => l && l.code);
  if (!items.length) return res(`${bomKey} BOM has no components yet — add its verified component list first`, { empty: true });
  const lines = items.map((l) => {
    const inv = stockOf(l.code);
    const need = Number(l.qty) || 0;
    const have = inv ? (Number(inv.stock) || 0) : 0;
    return { code: l.code, need, have, inv: inv || null, ok: !!inv && need > 0 && have >= need, unknown: !inv };
  });
  const short = lines.filter((l) => !l.ok);
  if (short.length) return res(`Some ${bomKey} components are short: ${short.map((l) => l.code).join(", ")}`, { lines, short });
  return res("", { lines, short });
}

// The R crate of a machine set is issued as its own BOM outward (ref = the R
// BOM key) under the machine's serial number. Returns those outward entries.
export function rCrateIssues(outwardLog = [], rBomKey, serialNo) {
  const sn = String(serialNo || "").trim().toLowerCase();
  if (!rBomKey || !sn) return [];
  return (outwardLog || []).filter((e) => e && e.type === "bom" && rackKeyNorm(e.ref) === rackKeyNorm(rBomKey) && String(e.serialNo || "").trim().toLowerCase() === sn);
}
