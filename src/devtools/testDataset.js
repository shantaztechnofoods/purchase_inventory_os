// ─────────────────────────────────────────────────────────────────────────────
// Test Dataset Generator
// Deterministic — same input seed → same output dataset.
// 200 items · 50 vendors · 25 BOMs · 100 POs · realistic industrial data.
// ─────────────────────────────────────────────────────────────────────────────

// Seeded PRNG so test data is reproducible across runs
function makeRng(seed = 42) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

const recomputeStatus = (stock, min) =>
  stock <= 0                            ? "critical"
  : stock <= min && stock / min < 0.15 ? "critical"
  : stock <= min                        ? "warning"
  : "safe";

const fmtDate = (d) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// ─── Item templates ──────────────────────────────────────────────────────────
const ITEM_TEMPLATES = {
  Electrical: [
    { prefix: "ELE-CAP", name: "Motor Capacitor", variants: ["10μF 440V","15μF 440V","20μF 440V","25μF 440V","30μF 440V","40μF 440V","50μF 440V","75μF 440V"], unit: "Pcs", rateRange: [60, 280], minRange: [10, 50] },
    { prefix: "ELE-FUS", name: "HRC Fuse",        variants: ["6A","10A","16A","25A","32A","63A","100A"],                                                       unit: "Pcs", rateRange: [15, 180], minRange: [20, 100] },
    { prefix: "ELE-CON", name: "Contactor",        variants: ["9A 3-Pole","12A 3-Pole","18A 3-Pole","25A 3-Pole","32A 4-Pole","40A 4-Pole","65A 4-Pole","95A 4-Pole"], unit: "Pcs", rateRange: [380, 4200], minRange: [3, 15] },
    { prefix: "ELE-RLY", name: "Control Relay",    variants: ["8-pin 10A","11-pin 5A","14-pin 5A","8-pin 16A","Timer 0-60s","Timer 0-10m"],                  unit: "Pcs", rateRange: [180, 950],  minRange: [5, 25] },
    { prefix: "ELE-SEN", name: "Proximity Sensor", variants: ["M12 4mm NPN","M18 8mm NPN","M30 15mm PNP","M12 4mm PNP","Photoelectric 1m","Photoelectric 5m"],unit: "Pcs", rateRange: [420, 2800], minRange: [3, 12] },
    { prefix: "ELE-MTR", name: "AC Induction Motor",variants: ["0.5HP 1440rpm","1HP 1440rpm","2HP 1440rpm","3HP 1440rpm","5HP 1440rpm","7.5HP 1440rpm","10HP 1440rpm"], unit: "Pcs", rateRange: [4200, 38000], minRange: [1, 4] },
    { prefix: "ELE-WIR", name: "Copper Wire",      variants: ["1.0 sqmm","1.5 sqmm","2.5 sqmm","4 sqmm","6 sqmm","10 sqmm","16 sqmm"],                       unit: "Meters", rateRange: [22, 380], minRange: [50, 300] },
    { prefix: "ELE-SWI", name: "Push Button",      variants: ["Green 22mm","Red 22mm","Black 22mm","Emergency Stop 40mm","Selector 2-pos","Selector 3-pos"], unit: "Pcs", rateRange: [85, 580],  minRange: [10, 40] },
  ],
  Mechanical: [
    { prefix: "MEC-BRG", name: "Ball Bearing",     variants: ["6201 ZZ","6202 ZZ","6203 2RS","6204 ZZ","6205 ZZ","6206 ZZ","6207 2RS","6303 NR","6305 ZZ","6308 2RS"], unit: "Pcs", rateRange: [85, 1800], minRange: [10, 50] },
    { prefix: "MEC-BLT", name: "V-Belt",           variants: ["A-32","A-36","A-42","B-38","B-42","B-50","B-58","C-60","C-72"],                                unit: "Pcs", rateRange: [55, 480],  minRange: [8, 35] },
    { prefix: "MEC-GER", name: "Spur Gear",        variants: ["Module 1 20T","Module 1.5 24T","Module 2 30T","Module 2 36T","Module 2.5 40T","Module 3 48T"], unit: "Pcs", rateRange: [320, 2200], minRange: [2, 10] },
    { prefix: "MEC-SHA", name: "Drive Shaft",      variants: ["20mm × 500mm","25mm × 600mm","30mm × 800mm","40mm × 1000mm","50mm × 1200mm"],                  unit: "Pcs", rateRange: [850, 4800], minRange: [2, 8] },
    { prefix: "MEC-CPL", name: "Coupling",          variants: ["Jaw 12mm","Jaw 19mm","Jaw 24mm","Flexible 25mm","Flexible 32mm","Rigid 40mm"],                unit: "Pcs", rateRange: [380, 1850], minRange: [3, 12] },
    { prefix: "MEC-PUL", name: "Pulley",            variants: ["A-Section 80mm","A-Section 100mm","B-Section 125mm","B-Section 160mm","C-Section 200mm","Stepped 4-Groove"], unit: "Pcs", rateRange: [220, 1450], minRange: [4, 18] },
    { prefix: "MEC-SPR", name: "Sprocket",          variants: ["08B 12T","08B 16T","10B 18T","12B 20T","16B 24T","16B 30T"],                                  unit: "Pcs", rateRange: [180, 1250], minRange: [3, 12] },
    { prefix: "MEC-CHN", name: "Roller Chain",      variants: ["08B 3m","08B 5m","10B 3m","12B 3m","16B 3m","16B 5m"],                                        unit: "Pcs", rateRange: [480, 2800], minRange: [2, 8] },
    { prefix: "MEC-SPG", name: "Compression Spring", variants: ["20×40mm","25×50mm","30×60mm","40×80mm","Heavy 50×100mm"],                                   unit: "Pcs", rateRange: [55, 280],  minRange: [20, 80] },
    { prefix: "MEC-BSH", name: "Brass Bushing",     variants: ["12×18×20","16×22×25","20×26×30","25×32×35","32×40×40","40×50×50"],                            unit: "Pcs", rateRange: [85, 480],  minRange: [10, 40] },
  ],
  Hydraulics: [
    { prefix: "HYD-PMP", name: "Hydraulic Gear Pump", variants: ["2 GPM 1500psi","4 GPM 2000psi","6 GPM 2500psi","8 GPM 3000psi","12 GPM 3000psi"],            unit: "Pcs", rateRange: [4800, 28000], minRange: [1, 4] },
    { prefix: "HYD-CYL", name: "Hydraulic Cylinder",  variants: ["50×100mm","63×150mm","80×200mm","100×300mm","125×400mm","160×500mm"],                       unit: "Pcs", rateRange: [3800, 22000], minRange: [1, 5] },
    { prefix: "HYD-VAL", name: "Directional Valve",    variants: ["4/2-way 1/4\"","4/3-way 1/4\"","4/2-way 3/8\"","Solenoid 4/3-way","Manual Spool 4-way"],   unit: "Pcs", rateRange: [1800, 12000], minRange: [2, 8] },
    { prefix: "HYD-HOS", name: "Hydraulic Hose",       variants: ["1/4\" R2 1m","3/8\" R2 1m","1/2\" R2 1m","3/4\" R2 1m","1\" R2 1m"],                       unit: "Meters", rateRange: [380, 1850], minRange: [10, 30] },
    { prefix: "HYD-FIT", name: "Hydraulic Fitting",    variants: ["JIC 6 Straight","JIC 8 Elbow","NPT 1/4 Adapter","BSP 3/8 Tee","ORFS 12 Coupling"],         unit: "Pcs", rateRange: [85, 580],   minRange: [15, 60] },
  ],
  Pneumatics: [
    { prefix: "PNE-CYL", name: "Pneumatic Cylinder",   variants: ["20×50mm","25×80mm","32×100mm","40×150mm","50×200mm","63×250mm"],                          unit: "Pcs", rateRange: [850, 4800], minRange: [3, 12] },
    { prefix: "PNE-REG", name: "Pressure Regulator",   variants: ["1/4\" 0-10 bar","3/8\" 0-10 bar","1/2\" 0-10 bar","Precision 0-6 bar"],                   unit: "Pcs", rateRange: [580, 2200], minRange: [3, 10] },
    { prefix: "PNE-FIL", name: "Air Filter",            variants: ["5μ 1/4\"","5μ 1/2\"","25μ 1/4\"","Coalescing 1/2\"","FRL Unit 1/2\""],                  unit: "Pcs", rateRange: [380, 1850], minRange: [3, 12] },
    { prefix: "PNE-SOL", name: "Solenoid Valve",        variants: ["3/2 1/8\" NC","5/2 1/4\" Single","5/3 1/4\" Center","Pilot 1/2\""],                      unit: "Pcs", rateRange: [680, 2800], minRange: [3, 12] },
    { prefix: "PNE-HOS", name: "Air Hose",              variants: ["6mm 1m","8mm 1m","10mm 1m","12mm 1m","16mm 1m"],                                         unit: "Meters", rateRange: [25, 220], minRange: [30, 100] },
  ],
  Consumables: [
    { prefix: "CON-OIL", name: "Hydraulic Oil",         variants: ["ISO VG 32","ISO VG 46","ISO VG 68","ISO VG 100","ISO VG 150"],                            unit: "Ltrs", rateRange: [180, 380], minRange: [50, 200] },
    { prefix: "CON-GRS", name: "Bearing Grease",         variants: ["EP-2 500g","EP-2 1kg","Lithium 500g","Lithium 1kg","Moly EP-2 1kg"],                    unit: "Kg",   rateRange: [220, 580], minRange: [10, 40] },
    { prefix: "CON-CLN", name: "Industrial Cleaner",     variants: ["Degreaser 5L","Solvent 5L","Brake Clean 500ml","Carb Clean 500ml"],                     unit: "Ltrs", rateRange: [180, 480], minRange: [10, 30] },
    { prefix: "CON-COL", name: "Coolant",                variants: ["Soluble Oil 20L","Synthetic 20L","Semi-Synth 20L"],                                     unit: "Ltrs", rateRange: [220, 580], minRange: [40, 120] },
    { prefix: "CON-LUB", name: "Chain Lubricant",        variants: ["Spray 400ml","Heavy Duty 1L","Food Grade 1L","Dry Film 400ml"],                         unit: "Ltrs", rateRange: [280, 850], minRange: [8, 25] },
    { prefix: "CON-RAG", name: "Cleaning Rag",           variants: ["Cotton 1kg","Cotton 5kg","Microfiber 50pcs","Lint-Free 100pcs"],                        unit: "Kg",   rateRange: [85, 380],  minRange: [10, 40] },
  ],
  Hardware: [
    { prefix: "HW-BLT",  name: "Hex Bolt",              variants: ["M6×20","M6×30","M8×25","M8×40","M10×30","M10×50","M12×40","M12×60","M16×50"],            unit: "Pcs", rateRange: [4, 38],    minRange: [50, 250] },
    { prefix: "HW-NUT",  name: "Hex Nut",               variants: ["M6","M8","M10","M12","M16","M20"],                                                       unit: "Pcs", rateRange: [2, 18],    minRange: [100, 400] },
    { prefix: "HW-WSH",  name: "Washer",                variants: ["M6 Flat","M8 Flat","M10 Spring","M12 Flat","M16 Spring"],                                unit: "Pcs", rateRange: [1, 12],    minRange: [100, 500] },
  ],
  Tools: [
    { prefix: "TL-WRN",  name: "Combination Wrench",    variants: ["10mm","13mm","17mm","19mm","22mm"],                                                      unit: "Pcs", rateRange: [85, 380],  minRange: [3, 10] },
    { prefix: "TL-DRL",  name: "HSS Drill Bit",         variants: ["3mm","5mm","8mm","10mm","12mm"],                                                         unit: "Pcs", rateRange: [38, 280],  minRange: [10, 40] },
  ],
};

// ─── Vendor pool (50) ────────────────────────────────────────────────────────
const VENDOR_POOL = [
  // Electrical specialists (10)
  { name: "Havells India Ltd",         cats: ["Electrical"],                  city: "Noida" },
  { name: "Schneider Electric India",  cats: ["Electrical"],                  city: "Gurgaon" },
  { name: "ABB India Ltd",             cats: ["Electrical"],                  city: "Bengaluru" },
  { name: "Siemens India Ltd",         cats: ["Electrical"],                  city: "Mumbai" },
  { name: "L&T Switchgear",            cats: ["Electrical"],                  city: "Mumbai" },
  { name: "Crompton Greaves",          cats: ["Electrical"],                  city: "Mumbai" },
  { name: "Anchor Electricals",        cats: ["Electrical"],                  city: "Mumbai" },
  { name: "Delta Electricals",         cats: ["Electrical"],                  city: "Pune" },
  { name: "Polycab Wires Pvt Ltd",     cats: ["Electrical"],                  city: "Daman" },
  { name: "Finolex Cables Ltd",        cats: ["Electrical"],                  city: "Pune" },
  // Mechanical / bearings (10)
  { name: "SKF India Ltd",             cats: ["Mechanical"],                  city: "Pune" },
  { name: "Timken India Ltd",          cats: ["Mechanical"],                  city: "Jamshedpur" },
  { name: "NRB Bearings Ltd",          cats: ["Mechanical"],                  city: "Mumbai" },
  { name: "FAG Bearings India",        cats: ["Mechanical"],                  city: "Vadodara" },
  { name: "Atlas Copco India",         cats: ["Mechanical","Pneumatics"],    city: "Pune" },
  { name: "Tata Bearings",             cats: ["Mechanical"],                  city: "Kharagpur" },
  { name: "Shree Industries",          cats: ["Mechanical"],                  city: "Rajkot" },
  { name: "Mahindra Engineering",      cats: ["Mechanical"],                  city: "Chennai" },
  { name: "Power Grip Belts",          cats: ["Mechanical"],                  city: "Coimbatore" },
  { name: "Diamond Chains India",      cats: ["Mechanical"],                  city: "Chennai" },
  // Hydraulics / Pneumatics (8)
  { name: "Bosch Rexroth India",       cats: ["Hydraulics","Pneumatics"],    city: "Bengaluru" },
  { name: "Parker Hannifin India",     cats: ["Hydraulics","Pneumatics"],    city: "Mumbai" },
  { name: "Festo India Pvt Ltd",       cats: ["Pneumatics"],                  city: "Bengaluru" },
  { name: "SMC Pneumatics India",      cats: ["Pneumatics"],                  city: "Noida" },
  { name: "Eaton India",               cats: ["Hydraulics"],                  city: "Pune" },
  { name: "Yuken India Ltd",           cats: ["Hydraulics"],                  city: "Bengaluru" },
  { name: "Janatics Pneumatics",       cats: ["Pneumatics"],                  city: "Coimbatore" },
  { name: "Rotex Manufacturers",       cats: ["Hydraulics"],                  city: "Vadodara" },
  // Consumables / oils (8)
  { name: "Bharat Lubricants Pvt Ltd", cats: ["Consumables"],                 city: "Mumbai" },
  { name: "Indian Oil Servo",          cats: ["Consumables"],                 city: "Delhi" },
  { name: "Castrol India Ltd",         cats: ["Consumables"],                 city: "Mumbai" },
  { name: "Gulf Oil Lubricants",       cats: ["Consumables"],                 city: "Chennai" },
  { name: "Shell Lubricants India",    cats: ["Consumables"],                 city: "Gurgaon" },
  { name: "Total Energies India",      cats: ["Consumables"],                 city: "Mumbai" },
  { name: "Mobil Industrial Oils",     cats: ["Consumables"],                 city: "Bengaluru" },
  { name: "Apar Industries",           cats: ["Consumables"],                 city: "Mumbai" },
  // Hardware / fasteners (8)
  { name: "Sundaram Fasteners",        cats: ["Hardware"],                    city: "Chennai" },
  { name: "Lakshmi Precision Screws",  cats: ["Hardware"],                    city: "Rohtak" },
  { name: "TVS Sundaram Iyengar",      cats: ["Hardware"],                    city: "Chennai" },
  { name: "Caparo Engineering India",  cats: ["Hardware"],                    city: "Pithampur" },
  { name: "Bombay Tools Centre",       cats: ["Hardware","Tools"],            city: "Mumbai" },
  { name: "Vardhman Special Steels",   cats: ["Hardware"],                    city: "Ludhiana" },
  { name: "Bharat Forge Ltd",          cats: ["Hardware"],                    city: "Pune" },
  { name: "Steel Strips Wheels",       cats: ["Hardware"],                    city: "Chandigarh" },
  // Tools / general (6)
  { name: "Bosch Power Tools India",   cats: ["Tools"],                       city: "Bengaluru" },
  { name: "Makita India",              cats: ["Tools"],                       city: "Mumbai" },
  { name: "Stanley Black & Decker",    cats: ["Tools","Hardware"],            city: "Bengaluru" },
  { name: "Taparia Tools Ltd",         cats: ["Tools"],                       city: "Nashik" },
  { name: "Jhalani Tools India",       cats: ["Tools"],                       city: "Faridabad" },
  { name: "General Industrial Supply", cats: ["Consumables","Hardware","Tools"], city: "Hyderabad" },
];

function buildVendors() {
  const rng = makeRng(101);
  return VENDOR_POOL.map((v, i) => {
    const code = String(i + 1).padStart(3, "0");
    return {
      id:            `VEN-${code}`,
      name:          v.name,
      category:      v.cats[0],
      contactPerson: ["Rakesh Kumar","Sandeep Mehta","Priya Nair","Vivek Sharma","Anjali Patel","Mahesh Iyer","Suresh Reddy","Neha Gupta","Arjun Singh","Kiran Joshi"][Math.floor(rng() * 10)],
      phone:         "+91 " + String(Math.floor(rng() * 90000 + 10000)) + String(Math.floor(rng() * 90000 + 10000)).slice(0, 5),
      email:         "sales@" + v.name.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".in",
      gst:           "27" + ["AABCS","AAHCS","AACCH","AABCB","AAACR"][Math.floor(rng() * 5)] + String(Math.floor(rng() * 9000 + 1000)) + ["A1Z5","B1Z3","C2Z8","D1Z2"][Math.floor(rng() * 4)],
      address:       `Plot ${Math.floor(rng() * 200 + 1)}, ${["MIDC","SIDCO","GIDC","HSIIDC","KIADB"][Math.floor(rng() * 5)]}, ${v.city}`,
      city:          v.city,
      cats:          v.cats,
    };
  });
}

// ─── Items (200) ─────────────────────────────────────────────────────────────
const CATEGORY_TARGETS = { Electrical: 40, Mechanical: 50, Hydraulics: 25, Pneumatics: 25, Consumables: 30, Hardware: 20, Tools: 10 };

function buildItems(vendors) {
  const rng = makeRng(2024);
  const out = {};
  const targetStockDist = {
    // 30 critical (0 stock), 20 critical (low ratio), 30 warning (below min),
    // 15 warning (exactly at min), 105 safe — total 200
    zero: 30, lowRatio: 20, belowMin: 30, atMin: 15, safe: 105,
  };
  const stockBuckets = [];
  Object.entries(targetStockDist).forEach(([k, n]) => { for (let i = 0; i < n; i++) stockBuckets.push(k); });
  // Shuffle deterministically
  for (let i = stockBuckets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [stockBuckets[i], stockBuckets[j]] = [stockBuckets[j], stockBuckets[i]];
  }

  let bucketIdx = 0;

  Object.entries(CATEGORY_TARGETS).forEach(([category, target]) => {
    const templates = ITEM_TEMPLATES[category];
    if (!templates) return;
    out[category] = [];
    let seq = 1;
    for (let i = 0; i < target; i++) {
      const tpl = templates[i % templates.length];
      const variantIdx = Math.floor(i / templates.length) % tpl.variants.length;
      const variant = tpl.variants[variantIdx];
      const code = `${tpl.prefix}-${String(seq++).padStart(3, "0")}`;
      const min = Math.floor(rng() * (tpl.minRange[1] - tpl.minRange[0]) + tpl.minRange[0]);
      const rate = Math.floor(rng() * (tpl.rateRange[1] - tpl.rateRange[0]) + tpl.rateRange[0]);

      const bucket = stockBuckets[bucketIdx++];
      let stock;
      if      (bucket === "zero")     stock = 0;
      else if (bucket === "lowRatio") stock = Math.max(1, Math.floor(min * 0.1));
      else if (bucket === "belowMin") stock = Math.floor(min * (0.3 + rng() * 0.5));
      else if (bucket === "atMin")    stock = min;
      else                            stock = Math.floor(min * (1.5 + rng() * 3));

      // Pick 1-3 vendors that supply this category
      const candidateVendors = vendors.filter((v) => v.cats.includes(category));
      const vCount = Math.min(candidateVendors.length, 1 + Math.floor(rng() * 3));
      const vendorLinks = [];
      const roles = ["Preferred", "Approved", "Backup"];
      for (let k = 0; k < vCount; k++) {
        const idx = Math.floor(rng() * candidateVendors.length);
        const v = candidateVendors[idx];
        if (!vendorLinks.some((l) => l.vendorId === v.id)) {
          vendorLinks.push({ vendorId: v.id, role: roles[k] });
        }
      }
      const primaryVendor = vendorLinks[0] ? candidateVendors.find((v) => v.id === vendorLinks[0].vendorId)?.name : "";

      const item = {
        code,
        name: `${tpl.name} ${variant}`,
        unit: tpl.unit,
        stock,
        min,
        max: min * 5,
        status: recomputeStatus(stock, min),
        trend: [stock, stock, stock, stock, stock],
        vendor: primaryVendor || "",
        vendorLinks,
        location: `Rack ${category[0]}-${Math.floor(rng() * 10 + 1)}, Bin ${Math.floor(rng() * 30 + 1)}`,
        lastPurchaseRate: rate,
        history: [{ date: fmtDate(new Date()), event: "Opening", change: 0, qty: stock }],
      };
      out[category].push(item);
    }
  });

  return out;
}

// ─── BOMs (25) ───────────────────────────────────────────────────────────────
const BOM_MODELS = [
  { key: "ATTA-MX-50",   label: "Atta Mixer 50kg/batch" },
  { key: "ATTA-MX-100",  label: "Atta Mixer 100kg/batch" },
  { key: "SPC-GR-100",   label: "Spice Grinder 100kg/hr" },
  { key: "SPC-GR-250",   label: "Spice Grinder 250kg/hr" },
  { key: "PCK-VFFS-V1",  label: "Vertical Pouch Packer V1" },
  { key: "PCK-VFFS-V2",  label: "Vertical Pouch Packer V2" },
  { key: "PCK-HFFS-X1",  label: "Horizontal Flow Wrap" },
  { key: "CNV-BLT-3M",   label: "Conveyor Belt 3m" },
  { key: "CNV-BLT-6M",   label: "Conveyor Belt 6m" },
  { key: "CNV-ROL-4M",   label: "Roller Conveyor 4m" },
  { key: "SLO-100",      label: "Storage Silo 100kg" },
  { key: "SLO-500",      label: "Storage Silo 500kg" },
  { key: "ELE-50",       label: "Bucket Elevator 50kg/min" },
  { key: "SIE-VIB-1",    label: "Vibratory Sieve Model-1" },
  { key: "SIE-ROT-2",    label: "Rotary Sieve Model-2" },
  { key: "MIX-RIB-200",  label: "Ribbon Mixer 200L" },
  { key: "MIX-PAD-300",  label: "Paddle Mixer 300L" },
  { key: "DRY-TRY-50",   label: "Tray Dryer 50kg" },
  { key: "DRY-FBD-100",  label: "Fluid Bed Dryer 100kg" },
  { key: "SCL-PLT-500",  label: "Platform Scale 500kg" },
  { key: "WAS-CIP-1",    label: "CIP Wash System" },
  { key: "BUF-TNK-1000", label: "Buffer Tank 1000L" },
  { key: "PMP-CEN-3HP",  label: "Centrifugal Pump 3HP" },
  { key: "PMP-DIA-1HP",  label: "Diaphragm Pump 1HP" },
  { key: "EMR-STP-1",    label: "Emergency Stop Panel" },
];

function buildBOMs(items) {
  const rng = makeRng(303);
  const allItems = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const out = {};

  BOM_MODELS.forEach((model, midx) => {
    // Each BOM: 8–18 items, weighted toward Mechanical + Electrical + Hardware + Consumables
    const count = 8 + Math.floor(rng() * 10);
    const picked = [];
    const seen = new Set();
    let safety = 0;
    while (picked.length < count && safety++ < 100) {
      const it = allItems[Math.floor(rng() * allItems.length)];
      if (seen.has(it.code)) continue;
      seen.add(it.code);
      picked.push({
        code:     it.code,
        name:     it.name,
        unit:     it.unit,
        category: it.category,
        qty:      1 + Math.floor(rng() * 6),
      });
    }
    out[model.key] = { label: model.label, items: picked };
  });

  return out;
}

// ─── Purchase Orders (100) ───────────────────────────────────────────────────
function buildPOs(items, vendors) {
  const rng = makeRng(404);
  const allItems = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));

  // Status distribution: 15 pending, 7 review, 3 draft, 20 approved, 25 ordered,
  //                     10 overdue, 15 received, 5 rejected → 100
  const statusBuckets = [];
  [["pending", 15], ["review", 7], ["draft", 3], ["approved", 20], ["ordered", 25],
   ["overdue", 10], ["received", 15], ["rejected", 5]].forEach(([s, n]) => {
    for (let i = 0; i < n; i++) statusBuckets.push(s);
  });

  const today = new Date();
  const out = [];
  for (let i = 0; i < 100; i++) {
    const id      = `PO-${String(i + 1).padStart(3, "0")}`;
    const status  = statusBuckets[i];
    const vendor  = vendors[Math.floor(rng() * vendors.length)];
    const vendorItems = allItems.filter((it) => it.vendorLinks?.some((l) => l.vendorId === vendor.id));
    const pool   = vendorItems.length > 0 ? vendorItems : allItems;
    const liCount = 2 + Math.floor(rng() * 6);

    const lineItems = [];
    const seenCodes = new Set();
    let safety = 0;
    while (lineItems.length < liCount && safety++ < 60) {
      const it = pool[Math.floor(rng() * pool.length)];
      if (seenCodes.has(it.code)) continue;
      seenCodes.add(it.code);
      const qty  = 5 + Math.floor(rng() * 50);
      const rate = it.lastPurchaseRate || 100;
      lineItems.push({
        code: it.code, name: it.name, unit: it.unit, category: it.category,
        qty, rate, amount: qty * rate,
      });
    }
    const subtotal = lineItems.reduce((s, l) => s + l.amount, 0);
    const gst      = Math.round(subtotal * 0.18);
    const amount   = subtotal + gst;

    const daysAgo = Math.floor(rng() * 30);
    const date    = fmtDate(addDays(today, -daysAgo));
    const po = {
      id, vendor: vendor.name, vendorId: vendor.id,
      date, status,
      lineItems, amount, gst,
      priority: rng() < 0.2 ? "urgent" : rng() < 0.5 ? "high" : "normal",
      notes: i % 7 === 0 ? "Quality check on arrival required" : "",
      activityLog: [{ action: "Created PO", date }],
    };

    // Backfill activity log + dates based on status
    if (["approved","ordered","overdue","received"].includes(status)) {
      po.activityLog.push({ action: "Approved", date: fmtDate(addDays(today, -daysAgo + 1)) });
    }
    if (["ordered","overdue","received"].includes(status)) {
      const odd = fmtDate(addDays(today, -daysAgo + 2));
      const eta = fmtDate(addDays(today, status === "overdue" ? -3 : 7));
      po.orderedDate = odd;
      po.eta = eta;
      po.activityLog.push({ action: "Order Placed", date: odd, note: `ETA: ${eta}` });
    }
    if (status === "received") {
      const rcvd = fmtDate(addDays(today, -Math.max(0, daysAgo - 5)));
      po.receivedDate = rcvd;
      po.activityLog.push({ action: "Received", date: rcvd, note: "Stock updated automatically" });
    }
    if (status === "rejected") {
      const rejd = fmtDate(addDays(today, -daysAgo + 1));
      po.rejectReason = ["Price too high","Vendor capacity issue","Duplicate request","Incorrect specifications","Pending approval delay"][i % 5];
      po.activityLog.push({ action: "Rejected", date: rejd, note: po.rejectReason });
    }

    out.push(po);
  }
  return out;
}

// ─── Follow-ups (for ordered/overdue POs) ───────────────────────────────────
function buildFollowUps(pos) {
  const rng = makeRng(505);
  const today = new Date();
  const out = [];
  pos.filter((p) => ["ordered","overdue"].includes(p.status)).forEach((p, i) => {
    const next = addDays(today, p.status === "overdue" ? -2 : 1 + Math.floor(rng() * 5));
    out.push({
      id:             Date.now() + i,
      poId:           p.id,
      vendor:         p.vendor,
      itemNames:      (p.lineItems || []).map((l) => l.name),
      eta:            p.eta || "",
      confirmedDate:  p.orderedDate || p.date,
      nextFollowUp:   fmtDate(next),
      lastFollowUp:   null,
      frequency:      Math.floor(rng() * 4) + 1,
    });
  });
  return out;
}

// ─── Public entry ────────────────────────────────────────────────────────────
export function generateTestDataset() {
  const vendors  = buildVendors();
  const items    = buildItems(vendors);
  const bomDefs  = buildBOMs(items);
  const pos      = buildPOs(items, vendors);
  const followUps = buildFollowUps(pos);

  return { vendors, items, bomDefs, pos, followUps };
}

// ─── Validation report ───────────────────────────────────────────────────────
export function validateDataset(ds) {
  const { items, vendors, bomDefs, pos, followUps } = ds;
  const allItems = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));

  const critical = allItems.filter((i) => i.status === "critical").length;
  const warning  = allItems.filter((i) => i.status === "warning").length;
  const safe     = allItems.filter((i) => i.status === "safe").length;
  const atMin    = allItems.filter((i) => i.stock === i.min && i.stock > 0).length;
  const zero     = allItems.filter((i) => i.stock === 0).length;

  const activeStatuses = new Set(["pending","review","draft","approved","ordered","overdue"]);
  const coveredByActivePO = new Set(
    pos.filter((p) => activeStatuses.has(p.status)).flatMap((p) => (p.lineItems || []).map((li) => li.code))
  );
  const lowStockCodes = new Set(allItems.filter((i) => i.status === "critical" || i.status === "warning").map((i) => i.code));
  const pipelineCount = [...lowStockCodes].filter((c) => !coveredByActivePO.has(c)).length;
  const coveredCount  = [...lowStockCodes].filter((c) =>  coveredByActivePO.has(c)).length;

  const poStatusDist = pos.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
  const totalPOValue = pos.reduce((s, p) => s + (p.amount || 0), 0);

  const itemCodes = new Set(allItems.map((i) => i.code));
  const bomItemRefs = Object.values(bomDefs).flatMap((b) => b.items || []);
  const orphanBomRefs = bomItemRefs.filter((r) => !itemCodes.has(r.code)).length;

  const poItemRefs = pos.flatMap((p) => (p.lineItems || []).map((l) => l.code));
  const orphanPORefs = poItemRefs.filter((c) => !itemCodes.has(c)).length;

  const vendorIds = new Set(vendors.map((v) => v.id));
  const orphanVendorLinks = allItems.flatMap((i) => (i.vendorLinks || []))
    .filter((l) => !vendorIds.has(l.vendorId)).length;

  return {
    items:    { total: allItems.length, byCategory: Object.fromEntries(Object.entries(items).map(([k, v]) => [k, v.length])) },
    stock:    { critical, warning, safe, exactlyAtMin: atMin, zeroStock: zero },
    vendors:  { total: vendors.length },
    boms:     { total: Object.keys(bomDefs).length, totalItemRefs: bomItemRefs.length, orphanRefs: orphanBomRefs },
    pos:      { total: pos.length, byStatus: poStatusDist, totalValue: totalPOValue, orphanRefs: orphanPORefs },
    pipeline: { lowStockTotal: lowStockCodes.size, coveredByActivePO: coveredCount, visibleInPipeline: pipelineCount },
    followUps:{ total: followUps.length },
    integrity:{ orphanBomItemRefs: orphanBomRefs, orphanPOItemRefs: orphanPORefs, orphanVendorLinks },
  };
}

// ─── Loader ──────────────────────────────────────────────────────────────────
export function loadDatasetToLocalStorage(ds) {
  const writes = {
    erp_items:    ds.items,
    erp_vendors:  ds.vendors,
    erp_bomdefs:  ds.bomDefs,
    erp_pos:      ds.pos,
    erp_followups:ds.followUps,
    erp_outward:  [],
    erp_inward:   [],
    erp_pending:  [],
    erp_machines: [],
  };
  Object.entries(writes).forEach(([k, v]) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  });
}
