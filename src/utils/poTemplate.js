// Purchase Order template engine — company profiles, template presets, and PDF/HTML builder.
// All data lives in settings.po (persisted to Supabase via the settings store).

// ── Template presets ──────────────────────────────────────────────────────────
// Each preset is a visual style; the layout/sections are controlled by `show` toggles.
export const PO_TEMPLATES = {
  default: { id: "default", label: "Default",    accent: "#1e3a5f", headerBg: "#1e3a5f", band: "#e8f0fb", font: "'Segoe UI',Arial,sans-serif" },
  A:       { id: "A",       label: "Template A",  accent: "#0f766e", headerBg: "#0f766e", band: "#e6f3f1", font: "'Segoe UI',Arial,sans-serif" },
  B:       { id: "B",       label: "Template B",  accent: "#334155", headerBg: "#0f172a", band: "#eef1f6", font: "'Inter',Arial,sans-serif" },
  C:       { id: "C",       label: "Template C",  accent: "#9a3412", headerBg: "#9a3412", band: "#fdeee4", font: "'Georgia',serif" },
};

export const PO_TEMPLATE_OPTIONS = Object.values(PO_TEMPLATES).map((t) => ({ id: t.id, label: t.label }));

export const DEFAULT_TERMS = [
  "1. Goods must match the specifications, quantity and rate stated in this order.",
  "2. Delivery to be completed on or before the agreed ETA.",
  "3. Invoice must quote this PO number.",
  "4. Payment as per agreed credit terms after goods inspection.",
  "5. Damaged or non-conforming goods will be returned at supplier cost.",
].join("\n");

export const DEFAULT_DECLARATION =
  "We confirm that this purchase order is issued as per our procurement policy and the details above are correct.";

// ── Company profile model ──────────────────────────────────────────────────────
let _idSeq = 0;
export function newCompanyId() {
  return `co_${Date.now().toString(36)}_${(_idSeq++).toString(36)}`;
}

export function emptyCompanyProfile(seed = {}) {
  return {
    id: seed.id || newCompanyId(),
    name: seed.name || "",
    logo: seed.logo || "",
    gst: seed.gst || "",
    pan: seed.pan || "",
    address: seed.address || "",
    phone: seed.phone || "",
    email: seed.email || "",
    website: seed.website || "",
    bankName: seed.bankName || "",
    accountNumber: seed.accountNumber || "",
    ifsc: seed.ifsc || "",
    upi: seed.upi || "",
    signatoryName: seed.signatoryName || "",
    signature: seed.signature || "",
  };
}

// Default PO settings block. Seeds one company from any legacy top-level settings fields.
export function defaultPOSettings(legacy = {}) {
  const first = emptyCompanyProfile({
    name: legacy.companyName || "Shantaz Technofoods",
    logo: legacy.logo || "",
    gst: legacy.gst || "",
    address: legacy.address || "",
    phone: legacy.phone || "",
    email: legacy.email || "",
  });
  return {
    activeCompanyId: first.id,
    template: "default",
    companies: [first],
    show: { logo: true, bankDetails: true, signature: true, terms: true, declaration: true },
    terms: DEFAULT_TERMS,
    declaration: DEFAULT_DECLARATION,
  };
}

// Always return a usable PO settings object (migrates legacy-only settings on read).
export function normalizePOSettings(settings = {}) {
  const po = settings.po;
  if (po && Array.isArray(po.companies) && po.companies.length) {
    return {
      activeCompanyId: po.activeCompanyId || po.companies[0].id,
      template: po.template || "default",
      companies: po.companies.map((c) => emptyCompanyProfile(c)),
      show: { logo: true, bankDetails: true, signature: true, terms: true, declaration: true, ...(po.show || {}) },
      terms: po.terms != null ? po.terms : DEFAULT_TERMS,
      declaration: po.declaration != null ? po.declaration : DEFAULT_DECLARATION,
    };
  }
  return defaultPOSettings(settings);
}

export function getActiveCompany(settings, preferredId) {
  const po = normalizePOSettings(settings);
  const id = preferredId || po.activeCompanyId;
  return po.companies.find((c) => c.id === id) || po.companies[0];
}

export function getTemplate(id) {
  return PO_TEMPLATES[id] || PO_TEMPLATES.default;
}

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");

// ── HTML builder ────────────────────────────────────────────────────────────────
// po: the PO; vendor: vendor master row; company: resolved company profile;
// opts: { template, show, terms, declaration }
export function buildPOHtml(po, vendor = {}, company = {}, opts = {}) {
  const tpl  = getTemplate(opts.template);
  const show = { logo: true, bankDetails: true, signature: true, terms: true, declaration: true, ...(opts.show || {}) };
  const terms = opts.terms != null ? opts.terms : DEFAULT_TERMS;
  const declaration = opts.declaration != null ? opts.declaration : DEFAULT_DECLARATION;

  const subtotal = (po.lineItems || []).reduce((s, li) => s + (li.amount || 0), 0);
  const gst      = po.gst != null ? po.gst : Math.round(subtotal * 0.18);
  const total    = po.amount || (subtotal + gst);

  const rows = (po.lineItems || []).map((li, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(li.name)}</strong><br><span style="font-family:monospace;font-size:9px;color:#888">${esc(li.code)}</span></td>
      <td style="text-align:center">${esc(li.unit) || "—"}</td>
      <td style="text-align:right">${esc(li.qty)}</td>
      <td style="text-align:right">₹${(li.rate || 0).toLocaleString("en-IN")}</td>
      <td style="text-align:right"><strong>₹${(li.amount || 0).toLocaleString("en-IN")}</strong></td>
    </tr>`).join("");

  const logoHtml = (show.logo && company.logo)
    ? `<img src="${company.logo}" alt="logo" style="max-height:54px;max-width:160px;object-fit:contain;margin-bottom:8px;display:block">`
    : "";

  const coInfo = [
    company.address ? esc(company.address) : "",
    company.gst ? `GSTIN: <strong>${esc(company.gst)}</strong>` : "",
    company.pan ? `PAN: ${esc(company.pan)}` : "",
    [company.phone ? `Ph: ${esc(company.phone)}` : "", company.email ? esc(company.email) : ""].filter(Boolean).join(" · "),
    company.website ? esc(company.website) : "",
  ].filter(Boolean).join("<br>");

  const bankHtml = (show.bankDetails && (company.bankName || company.accountNumber || company.ifsc || company.upi))
    ? `<div class="box" style="margin-top:14px">
         <div class="box-title">Bank / Payment Details</div>
         ${company.bankName ? `<div class="info-row"><span class="ik">Bank</span><span class="iv">${esc(company.bankName)}</span></div>` : ""}
         ${company.accountNumber ? `<div class="info-row"><span class="ik">A/C No.</span><span class="iv" style="font-family:monospace">${esc(company.accountNumber)}</span></div>` : ""}
         ${company.ifsc ? `<div class="info-row"><span class="ik">IFSC</span><span class="iv" style="font-family:monospace">${esc(company.ifsc)}</span></div>` : ""}
         ${company.upi ? `<div class="info-row"><span class="ik">UPI</span><span class="iv">${esc(company.upi)}</span></div>` : ""}
       </div>`
    : "";

  const termsHtml = (show.terms && terms)
    ? `<div class="notes"><strong>Terms &amp; Conditions:</strong><br>${nl2br(terms)}</div>` : "";

  const declHtml = (show.declaration && declaration)
    ? `<div style="margin-top:12px;font-size:10px;color:#555;font-style:italic">${nl2br(declaration)}</div>` : "";

  const sigImg = (show.signature && company.signature)
    ? `<img src="${company.signature}" alt="sign" style="max-height:46px;max-width:150px;object-fit:contain;margin-bottom:4px;display:block">` : "";
  const sigHtml = show.signature
    ? `<div class="footer">
         <div><div class="sig-lbl">Prepared By</div><div class="sig-line">Name &amp; Signature</div></div>
         <div>${sigImg}<div class="sig-lbl" style="margin-bottom:${sigImg ? "2px" : "22px"}">Authorized Signatory</div><div class="sig-line">${esc(company.signatoryName) || "For " + esc(company.name)}</div></div>
       </div>` : "";

  // ── Phase 3 — per-line attached designs ──────────────────────────────────────
  // For every line item with attachDesign === true AND a designFile URL, append an
  // extra A4 page after the PO. Images are inlined; PDFs (which can't be reliably
  // embedded in a print window) render a "Open attached PDF" link as fallback so
  // the recipient still gets to the file. A PO with no boxes ticked produces zero
  // extra HTML — bit-for-bit identical to the previous PDF output.
  const isImageUrl = (u = "") =>
    /^data:image\//i.test(u) ||
    /\.(png|jpe?g|gif|webp|svg|bmp)(\?|#|$)/i.test(u);
  const isPdfUrl = (u = "") =>
    /^data:application\/pdf/i.test(u) ||
    /\.pdf(\?|#|$)/i.test(u);
  const designAttachments = (po.lineItems || []).filter((li) => li && li.attachDesign && li.designFile);
  const designPagesHtml = designAttachments.map((li, i) => {
    const url   = li.designFile;
    const label = esc(li.name) + (li.code ? ` <span style="color:#888;font-family:monospace;font-size:10px">(${esc(li.code)})</span>` : "");
    const body  = isImageUrl(url)
      ? `<img src="${url}" alt="${esc(li.designName || li.name)}" style="max-width:100%;max-height:78vh;object-fit:contain;display:block;margin:0 auto" />`
      : isPdfUrl(url)
        ? `<div style="margin-top:30px;padding:20px;border:1px dashed #aaa;border-radius:8px;background:#fafbfd;font-size:12px;color:#444">
             <div style="font-weight:700;margin-bottom:6px;color:${tpl.accent}">📄 Attached PDF design</div>
             <div style="margin-bottom:10px">${esc(li.designName || "design.pdf")}</div>
             <a href="${url}" target="_blank" style="color:${tpl.accent};font-weight:700">Open PDF design →</a>
             <div style="margin-top:10px;font-size:10px;color:#888">Browsers can't always inline PDFs inside a print window. Open the link above to view/print the design.</div>
           </div>`
        : `<div style="margin-top:30px;padding:20px;border:1px dashed #aaa;border-radius:8px;background:#fafbfd;font-size:12px;color:#444">
             <div style="font-weight:700;margin-bottom:6px;color:${tpl.accent}">📎 Attached design</div>
             <div style="margin-bottom:10px">${esc(li.designName || "design")}</div>
             <a href="${url}" target="_blank" style="color:${tpl.accent};font-weight:700">Open attached design →</a>
           </div>`;
    return `<div style="page-break-before:always;padding-top:12px">
              <div style="border-bottom:2px solid ${tpl.accent};padding-bottom:8px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:baseline">
                <div>
                  <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#888">Attached Design ${i + 1} of ${designAttachments.length}</div>
                  <div style="font-size:14px;font-weight:700;color:${tpl.accent};margin-top:2px">${label}</div>
                </div>
                <div style="font-size:10px;color:#888">PO ${esc(po.id)}</div>
              </div>
              ${body}
            </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>PO-${esc(po.id)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:${tpl.font};font-size:12px;color:#1a1a1a;background:#fff;padding:28px 32px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid ${tpl.accent};padding-bottom:14px;margin-bottom:20px}
  .co-name{font-size:19px;font-weight:700;color:${tpl.accent};margin-bottom:3px}
  .co-info{font-size:10px;color:#555;line-height:1.65}
  .po-right{text-align:right}
  .po-label{font-size:22px;font-weight:800;color:${tpl.accent};letter-spacing:1px}
  .po-num{font-size:13px;font-weight:600;color:#333;margin-top:2px;font-family:monospace}
  .po-badge{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 8px;border-radius:4px;background:${tpl.band};color:${tpl.accent};margin-top:5px;letter-spacing:.05em}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px}
  .box{border:1px solid #d8e0ec;border-radius:6px;padding:12px}
  .box-title{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#888;margin-bottom:8px}
  .box-name{font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:6px}
  .info-row{display:flex;gap:6px;margin-bottom:3px;font-size:10.5px}
  .ik{color:#777;min-width:85px;flex-shrink:0}
  .iv{font-weight:600;color:#1a1a1a}
  .sec-lbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:#888;margin-bottom:6px}
  .table-wrap{border:1px solid #d8e0ec;border-radius:6px;overflow:hidden;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead tr{background:${tpl.headerBg};color:#fff}
  thead th{padding:7px 10px;text-align:left;font-size:9.5px;font-weight:600;letter-spacing:.04em}
  thead th.r{text-align:right}
  thead th.c{text-align:center}
  tbody tr:nth-child(even){background:#f6f8fc}
  tbody td{padding:7px 10px;border-bottom:1px solid #eef0f5;vertical-align:middle}
  .totals{width:44%;margin-left:auto;border-collapse:collapse;font-size:11px}
  .totals td{padding:4px 10px}
  .grand td{background:${tpl.headerBg};color:#fff;font-weight:700;font-size:12.5px}
  .notes{margin:14px 0;padding:10px 14px;border-left:3px solid ${tpl.accent};background:#f6f8fc;font-size:10.5px;color:#444;border-radius:0 4px 4px 0;white-space:normal}
  .footer{margin-top:24px;border-top:1px solid #d8e0ec;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:50px;font-size:11px}
  .sig-lbl{font-size:9px;color:#888;margin-bottom:22px}
  .sig-line{border-top:1px solid #aaa;padding-top:5px;font-size:10px;color:#555}
  @media print{body{padding:0}@page{margin:12mm;size:A4}}
</style></head>
<body>
<div class="header">
  <div>
    ${logoHtml}
    <div class="co-name">${esc(company.name) || "Company"}</div>
    <div class="co-info">${coInfo}</div>
  </div>
  <div class="po-right">
    <div class="po-label">PURCHASE ORDER</div>
    <div class="po-num">${esc(po.id)}</div>
    <div class="po-badge">${esc((po.status || "").toUpperCase())}</div>
  </div>
</div>

<div class="two-col">
  <div class="box">
    <div class="box-title">Vendor / Supplier</div>
    <div class="box-name">${esc(po.vendor)}</div>
    ${vendor?.contactPerson ? `<div class="info-row"><span class="ik">Contact</span><span class="iv">${esc(vendor.contactPerson)}</span></div>` : ""}
    ${vendor?.phone ? `<div class="info-row"><span class="ik">Phone</span><span class="iv">${esc(vendor.phone)}</span></div>` : ""}
    ${vendor?.gst ? `<div class="info-row"><span class="ik">GSTIN</span><span class="iv" style="font-family:monospace">${esc(vendor.gst)}</span></div>` : ""}
    ${vendor?.address ? `<div class="info-row"><span class="ik">Address</span><span class="iv">${esc(vendor.address)}</span></div>` : ""}
    ${vendor?.paymentTerms ? `<div class="info-row"><span class="ik">Payment</span><span class="iv">${esc(vendor.paymentTerms)}</span></div>` : ""}
  </div>
  <div class="box">
    <div class="box-title">PO Details</div>
    <div class="info-row"><span class="ik">PO Number</span><span class="iv" style="font-family:monospace">${esc(po.id)}</span></div>
    <div class="info-row"><span class="ik">PO Date</span><span class="iv">${esc(po.date) || "—"}</span></div>
    <div class="info-row"><span class="ik">Expected By</span><span class="iv">${esc(po.eta || po.delivery) || "—"}</span></div>
    <div class="info-row"><span class="ik">Priority</span><span class="iv" style="text-transform:capitalize">${esc(po.priority) || "normal"}</span></div>
    <div class="info-row"><span class="ik">Status</span><span class="iv" style="text-transform:capitalize">${esc(po.status) || "—"}</span></div>
  </div>
</div>

<div class="sec-lbl">Items Ordered</div>
<div class="table-wrap">
  <table>
    <thead><tr>
      <th style="width:28px">#</th>
      <th>Item Name / Code</th>
      <th class="c" style="width:55px">Unit</th>
      <th class="r" style="width:50px">Qty</th>
      <th class="r" style="width:85px">Rate (₹)</th>
      <th class="r" style="width:90px">Amount (₹)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table class="totals">
    <tbody>
      <tr><td style="color:#666">Subtotal</td><td style="text-align:right;font-weight:600">₹${subtotal.toLocaleString("en-IN")}</td></tr>
      <tr><td style="color:#666">GST (18%)</td><td style="text-align:right;font-weight:600">₹${gst.toLocaleString("en-IN")}</td></tr>
      <tr class="grand"><td>Grand Total</td><td style="text-align:right">₹${total.toLocaleString("en-IN")}</td></tr>
    </tbody>
  </table>
</div>

${po.notes ? `<div class="notes"><strong>Notes:</strong><br>${nl2br(po.notes)}</div>` : ""}
${bankHtml}
${termsHtml}
${declHtml}
${sigHtml}
${designPagesHtml}
${opts.preview ? "" : `<script>window.onload=function(){window.print()};<\/script>`}
</body></html>`;
}

// Open the PO in a print window using the resolved company + template.
export function openPOPdf(po, vendor, company, opts = {}) {
  console.info("[PO] openPOPdf", { po: po?.id, company: company?.name, template: opts.template });
  const html = buildPOHtml(po, vendor, company, opts);
  const w = window.open("", `PO-${po.id}`, "width=960,height=720");
  if (!w) { alert("Pop-up blocked. Please allow pop-ups to download the PDF."); return false; }
  w.document.write(html);
  w.document.close();
  return true;
}
