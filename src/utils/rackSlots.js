// Rack slots — pure helpers (2026-10-31, brief §14).
//
// The fixed racks on the floor (PHYSICAL_RACK_LAYOUT, unchanged): per model
// family, `columns` vertical pairs of an M rack over an R rack, each rack
// holding `setsPerRack` machine sets. Every set position is a SLOT with a
// stable id, e.g. "M-10-1#2" = M-10 rack, column 1, position 2.
//
// A machine remembers its slot (machine.rackSlot, migration 045) from the
// moment its BOM set is put on the rack until the production head releases
// the assembled machine to Mechanical. Legacy rows with no slot are placed
// into free slots oldest-first, exactly as the rack view always did.
//
// Slot status:
//   empty       nothing in it                         → Fill
//   set         BOM set waiting (stage BOM Issued)    → Start assembly
//   assembling  taken off for assembly (stage Assembly, slot kept)
//   assembled   assembled, back on the rack, awaiting release → Release

export const PHYSICAL_RACK_LAYOUT = {
  setsPerRack: 2,
  tiers: ["M", "R"],            // top → bottom within each vertical pair
  families: [
    { id: "10", label: "10", columns: 2, color: "#1d4ed8", boms: ["KM10"] },
    { id: "15", label: "15", columns: 2, color: "#15803d", boms: ["KM15"] },
    { id: "20", label: "20", columns: 2, color: "#ea580c", boms: ["KM20"] },
  ],
};

export const rackKeyNorm = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function physicalRackFamily(bomKey, layout = PHYSICAL_RACK_LAYOUT) {
  const k = rackKeyNorm(bomKey);
  return layout.families.find((f) => f.boms.some((b) => rackKeyNorm(b) === k)) || null;
}

// Set slots a BOM has on the physical racks, or null when it has none.
export function physicalRackSlots(bomKey, layout = PHYSICAL_RACK_LAYOUT) {
  const f = physicalRackFamily(bomKey, layout);
  return f ? f.columns * layout.tiers.length * layout.setsPerRack : null;
}

export function rackCapacityFor(bomKey, _def, layout = PHYSICAL_RACK_LAYOUT) {
  const slots = physicalRackSlots(bomKey, layout);
  return slots != null ? slots : 0;
}

export const rackIdOf = (tier, familyLabel, column) => `${tier}-${familyLabel}-${column}`;
export const rackNameOf = (tier, familyLabel, column) => `${tier}-${familyLabel} (${column})`;
export const slotIdOf = (rackId, position) => `${rackId}#${position}`;
export function slotLabel(slotId) {
  const m = /^([A-Z])-([^-]+)-(\d+)#(\d+)$/.exec(String(slotId || ""));
  return m ? `${m[1]}-${m[2]} (${m[3]}) · slot ${m[4]}` : String(slotId || "");
}

// Every slot id of a family, rack by rack, in floor order.
export function familySlotIds(family, layout = PHYSICAL_RACK_LAYOUT) {
  const out = [];
  for (let c = 1; c <= family.columns; c++)
    for (const tier of layout.tiers)
      for (let n = 1; n <= layout.setsPerRack; n++) out.push(slotIdOf(rackIdOf(tier, family.label, c), n));
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
    if (physicalRackFamily(m.bomKey, layout)?.id !== family.id) return false;
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
  const valid = new Set(ids);
  const machines = rackMachinesOfFamily(family, machineLog, awaitingReleaseIds, layout);
  const bySlot = {};
  const unplaced = [];
  for (const m of machines) {
    if (m.rackSlot && valid.has(m.rackSlot) && !bySlot[m.rackSlot]) bySlot[m.rackSlot] = { machine: m, pinned: true };
    else unplaced.push(m);
  }
  const overflow = [];
  for (const m of unplaced) {
    // Only material sets flow into free slots automatically; an assembling or
    // assembled machine with no (or a clashing) slot is listed as overflow.
    const free = m.stage === "BOM Issued" ? ids.find((id) => !bySlot[id]) : null;
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
        slots.push({ id, position: n, machine: e ? e.machine : null, pinned: !!(e && e.pinned), status: slotStatusOf(e && e.machine, awaitingReleaseIds) });
      }
      const occupied = slots.filter((s) => s.machine).length;
      const sets = slots.filter((s) => s.status === "set").length;
      return {
        id: rackId, name: rackNameOf(tier, family.label, c), tier, column: c, slots,
        capacity: layout.setsPerRack, occupied, ready: sets, empty: layout.setsPerRack - occupied,
        state: occupied >= layout.setsPerRack ? "full" : occupied > 0 ? "partial" : "empty",
      };
    });
    columns.push(pair);
  }
  return { columns, overflow, placed: bySlot };
}

// First free slot for a BOM, honouring a preferred slot (from a Fill action)
// when it belongs to the same family and is still empty. Null when the model
// has no fixed rack or every slot is taken.
export function firstFreeSlot(bomKey, machineLog = [], awaitingReleaseIds = new Set(), preferred = null, layout = PHYSICAL_RACK_LAYOUT) {
  const f = physicalRackFamily(bomKey, layout);
  if (!f) return null;
  const { placed } = buildFamilyRacks(f, machineLog, awaitingReleaseIds, layout);
  const ids = familySlotIds(f, layout);
  if (preferred && ids.includes(preferred) && !placed[preferred]) return preferred;
  return ids.find((id) => !placed[id]) || null;
}

// Can `machine` be put into `slotId`? Returns { ok, error }.
export function canAssignSlot(machine, slotId, machineLog = [], awaitingReleaseIds = new Set(), layout = PHYSICAL_RACK_LAYOUT) {
  if (!machine) return { ok: false, error: "Machine not found" };
  const f = physicalRackFamily(machine.bomKey, layout);
  if (!f) return { ok: false, error: `${machine.bomKey} has no fixed rack` };
  if (!familySlotIds(f, layout).includes(slotId)) return { ok: false, error: `${slotLabel(slotId)} is not a ${f.label} rack slot — model and rack must match` };
  if (machine.stage !== "BOM Issued" && !awaitingReleaseIds.has(String(machine.id)) && !(machine.stage === "Assembly" && machine.rackSlot))
    return { ok: false, error: "Only a machine on the rack can be assigned a slot" };
  const { placed } = buildFamilyRacks(f, machineLog, awaitingReleaseIds, layout);
  const e = placed[slotId];
  if (e && e.pinned && String(e.machine.id) !== String(machine.id)) return { ok: false, error: `${slotLabel(slotId)} already holds ${e.machine.serialNo || e.machine.bomKey}` };
  const already = (machineLog || []).find((m) => m.rackSlot === slotId && String(m.id) !== String(machine.id) && m.status !== "completed");
  if (already) return { ok: false, error: `${slotLabel(slotId)} already holds ${already.serialNo || already.bomKey}` };
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
