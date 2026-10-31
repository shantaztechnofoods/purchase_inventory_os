// Rack slots — pure helpers (2026-10-31, brief §14; fixed BOMs and M/R
// machine sets 2026-10-31).
//
// TWELVE rack units on the floor — M-10 (1), M-10 (2), R-10 (1), R-10 (2), …
// R-20 (2) — paired into SIX machine sets: M-10 (1) + R-10 (1) is ONE machine
// set with ONE serial number; M-10 (2) + R-10 (2) is a second set with a
// different serial. The M unit holds the M BOM crate, the R unit the R BOM
// crate of the same machine. M and R are never separate machines.
//
// A set is stored on the machine as its M slot id ("M-10-1#2"); the R unit of
// the same position shows the same machine (pairSlotOf). Every rack takes
// ONE BOM: the M-10 unit the M-10 BOM, the R-10 unit the R-10 BOM. A BOM that
// is not listed here (AM900, ARM1800, TM600, VK, PILOT-KM10, TRIAL-01, KM-10
// and every future R&D BOM) has no rack and goes to Direct Production only.
//
// `legacy` keys: KM10 / KM15 / KM20 were replaced by M-10 / M-15 / M-20 on
// 2026-10-31. Machines already issued under the old keys keep their history
// and keep the set they hold; no new set can be issued under a retired BOM.
//
// Slot ids keep the format used since migration 045, "M-10-1#2" (rack M-10,
// column 1, position 2), so slots saved before this change stay valid. An
// older R slot ("R-10-1#2") is read as its set's M slot.
//
// Set status (shown on both units of the set):
//   empty       nothing in it                         → Fill Rack
//   set         BOM set waiting (stage BOM Issued)    → Assemble
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

// One BOM line list for a machine set: the M crate and the R crate together.
// A code used by both crates is one line with the quantities added, so stock
// is checked and deducted once. `crates` says which crate(s) each line is for.
export function mergeSetBomItems(mItems = [], rItems = []) {
  const out = []; const at = {};
  const add = (list, crate) => (list || []).forEach((l) => {
    const code = String((l && l.code) || "").trim();
    if (!code) return;
    const qty = Number(l.qty) || 0;
    if (at[code] == null) { at[code] = out.length; out.push({ ...l, code, qty, crates: [crate], crateQty: { [crate]: qty } }); }
    else { const o = out[at[code]]; o.qty += qty; if (!o.crates.includes(crate)) o.crates.push(crate); o.crateQty[crate] = (o.crateQty[crate] || 0) + qty; }
  });
  add(mItems, "M"); add(rItems, "R");
  return out;
}

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

// Place a family's machines into its machine sets. A set is position n of
// the family: M unit n + R unit n, one machine. Explicit slots first (an M or
// an older R slot id both mean that set; the oldest machine keeps a contested
// set), then BOM-Issued machines without a slot fill the remaining free sets
// oldest-first. Both units of a set carry the same machine and status.
// Returns { columns: [[Mrack, Rrack], …], overflow, placed } — `placed` is
// keyed by every unit id (M and R) of an occupied set.
export function buildFamilyRacks(family, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  const setIds = familySlotIds(family, layout, "M");
  const machines = rackMachinesOfFamily(family, machineLog, awaitingReleaseIds, layout);
  const bySet = {};
  const unplaced = [];
  for (const m of machines) {
    const sid = setSlotOf(m.rackSlot);
    if (sid && setIds.includes(sid) && !bySet[sid]) bySet[sid] = { machine: m, pinned: true };
    else unplaced.push(m);
  }
  const overflow = [];
  for (const m of unplaced) {
    // Only material sets flow into a free set automatically; anything else
    // (a machine already in assembly without a set) is listed as overflow.
    const free = m.stage === "BOM Issued" ? setIds.find((id) => !bySet[id]) : null;
    if (free) bySet[free] = { machine: m, pinned: false };
    else overflow.push(m);
  }
  const placed = {};
  for (const [sid, e] of Object.entries(bySet)) { placed[sid] = e; placed[pairSlotOf(sid)] = { ...e, paired: true }; }
  const columns = [];
  for (let c = 1; c <= family.columns; c++) {
    const pair = layout.tiers.map((tier) => {
      const rackId = rackIdOf(tier, family.label, c);
      const slots = [];
      for (let n = 1; n <= layout.setsPerRack; n++) {
        const id = slotIdOf(rackId, n);
        const e = placed[id];
        slots.push({ id, setId: setSlotOf(id), pairId: pairSlotOf(id), position: n, machine: e ? e.machine : null, pinned: !!(e && e.pinned), status: slotStatusOf(e && e.machine, awaitingReleaseIds) });
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
  return { columns, overflow, placed };
}

// The free machine set (its M slot id) for a BOM of a fixed-rack family —
// M, R or legacy key alike, since M and R units are filled together.
// Honours a preferred unit (from a Fill action; M or R unit of the set) when
// that set is still empty. Null when the BOM has no fixed rack or both sets
// of the model are taken.
export function firstFreeSlot(bomKey, machineLog = [], awaitingReleaseIds = new Set(), preferred = null, layout = PHYSICAL_RACK_LAYOUT) {
  const r = rackOfBom(bomKey, layout);
  if (!r) return null;
  const { placed } = buildFamilyRacks(r.family, machineLog, awaitingReleaseIds, layout);
  const ids = familySlotIds(r.family, layout, "M");
  const pref = setSlotOf(preferred);
  if (pref && ids.includes(pref) && !placed[pref]) return pref;
  return ids.find((id) => !placed[id]) || null;
}

// Can `machine` be put into the set of `slotId` (M or R unit)? { ok, error }.
export function canAssignSlot(machine, slotId, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  if (!machine) return { ok: false, error: "Machine not found" };
  const r = rackOfBom(machine.bomKey, layout);
  if (!r) return { ok: false, error: `${machine.bomKey} has no fixed rack — Direct Production only` };
  const sid = setSlotOf(slotId);
  if (!familySlotIds(r.family, layout, "M").includes(sid)) return { ok: false, error: `${slotLabel(slotId)} is not an M-${r.family.label} / R-${r.family.label} set — a ${machine.bomKey} machine can only go on its own racks` };
  if (machine.stage !== "BOM Issued" && !awaitingReleaseIds.has(String(machine.id)) && !(machine.stage === "Assembly" && machine.rackSlot))
    return { ok: false, error: "Only a machine on the rack can be assigned a slot" };
  const { placed } = buildFamilyRacks(r.family, machineLog, awaitingReleaseIds, layout);
  const e = placed[sid];
  if (e && e.pinned && String(e.machine.id) !== String(machine.id)) return { ok: false, error: `${setLabel(sid)} already holds ${e.machine.serialNo || e.machine.bomKey}` };
  const already = (machineLog || []).find((m) => m.rackSlot && setSlotOf(m.rackSlot) === sid && String(m.id) !== String(machine.id) && m.status !== "completed");
  if (already) return { ok: false, error: `${setLabel(sid)} already holds ${already.serialNo || already.bomKey}` };
  return { ok: true };
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

// Can a machine set of `family` be filled? Both crates are filled together,
// so BOTH BOMs must exist, be live, have components, and every merged line
// must be fully in stock. stockOf(code) → Item Master record or undefined.
// Returns { ok, why, mKey, rKey, lines, short }.
export function setFillCheck(family, bomDefs = {}, stockOf = () => undefined) {
  const mKey = rackBoms(family, "M").primary;
  const rKey = rackBoms(family, "R").primary;
  const mDef = mKey ? bomDefs[mKey] : null;
  const rDef = rKey ? bomDefs[rKey] : null;
  const res = (why, extra = {}) => ({ ok: !why, why, mKey, rKey, lines: [], short: [], ...extra });
  if (!mDef || mDef.retiredAt) return res(`Create the ${mKey} BOM first`);
  if (!rDef || rDef.retiredAt) return res(`Create the ${rKey} BOM first`);
  const mItems = (mDef.items || []).filter((l) => l && l.code);
  const rItems = (rDef.items || []).filter((l) => l && l.code);
  if (!mItems.length) return res(`${mKey} BOM has no components yet`);
  if (!rItems.length) return res(`${rKey} BOM has no components yet — the set cannot be filled until its verified component list is added`);
  const lines = mergeSetBomItems(mItems, rItems).map((l) => {
    const inv = stockOf(l.code);
    const have = inv ? (Number(inv.stock) || 0) : 0;
    return { ...l, inv: inv || null, have, ok: !!inv && l.qty > 0 && have >= l.qty, unknown: !inv };
  });
  const short = lines.filter((l) => !l.ok);
  if (short.length) return res(`Some components are short: ${short.map((l) => l.code).join(", ")}`, { lines, short });
  return res("", { lines, short });
}
