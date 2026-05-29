import React, { useMemo, useRef, useState } from "react";
import {
  PO_TEMPLATES, PO_TEMPLATE_OPTIONS, emptyCompanyProfile, normalizePOSettings,
  buildPOHtml, DEFAULT_TERMS, DEFAULT_DECLARATION,
} from "../utils/poTemplate.js";

// Sample data used for the live preview only.
const SAMPLE_PO = {
  id: "PO-PREVIEW", status: "approved", date: "01 Jun 2026", eta: "08 Jun 2026", priority: "normal",
  vendor: "SKF India Ltd", amount: 147500, gst: 22500,
  notes: "Please pack carefully. Deliver to Gate 2.",
  lineItems: [
    { name: "Spindle Bearing 6205 ZZ", code: "BRG-001", unit: "Pcs", qty: 50, rate: 150, amount: 7500 },
    { name: "Hydraulic Oil ISO 46", code: "OIL-HYD46", unit: "Ltrs", qty: 500, rate: 240, amount: 120000 },
  ],
};
const SAMPLE_VENDOR = {
  contactPerson: "Suresh Mehta", phone: "+91 98765 11110", gst: "27AABCS5678L1ZP",
  address: "SKF House, Pune 411001", paymentTerms: "45 days",
};

const FIELD_GROUPS = [
  { title: "Identity", fields: [
    ["name", "Company Name", "Shantaz Technofoods Pvt Ltd"],
    ["gst", "GST Number", "24AABCS1234L1ZN"],
    ["pan", "PAN Number", "AABCS1234L"],
    ["website", "Website", "www.company.com"],
  ]},
  { title: "Contact", fields: [
    ["phone", "Phone", "+91 98765 43210"],
    ["email", "Email", "purchase@company.com"],
    ["address", "Address", "Factory / office address", true],
  ]},
  { title: "Bank & Payment", fields: [
    ["bankName", "Bank Name", "HDFC Bank"],
    ["accountNumber", "Account Number", "50100123456789"],
    ["ifsc", "IFSC Code", "HDFC0001234"],
    ["upi", "UPI ID", "company@hdfcbank"],
  ]},
  { title: "Authorized Signatory", fields: [
    ["signatoryName", "Signatory Name", "Director / Proprietor"],
  ]},
];

export default function POSettings({ value, onChange, isSuperAdmin = false, settings = {} }) {
  // Resolve a usable PO settings object (migrates legacy settings on first open).
  const po = useMemo(() => normalizePOSettings({ ...settings, po: value }), [value, settings]);
  const [editId, setEditId] = useState(po.activeCompanyId);
  const logoRef = useRef(null);
  const signRef = useRef(null);

  const active = po.companies.find((c) => c.id === editId) || po.companies[0];

  // Persist a new PO settings object upward.
  const commit = (next) => onChange?.(next);

  const patchCompany = (id, patch) =>
    commit({ ...po, companies: po.companies.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const addCompany = () => {
    const c = emptyCompanyProfile({ name: "New Company" });
    commit({ ...po, companies: [...po.companies, c], activeCompanyId: po.activeCompanyId });
    setEditId(c.id);
  };

  const deleteCompany = (id) => {
    if (po.companies.length <= 1) return;
    const companies = po.companies.filter((c) => c.id !== id);
    const activeCompanyId = po.activeCompanyId === id ? companies[0].id : po.activeCompanyId;
    commit({ ...po, companies, activeCompanyId });
    setEditId(companies[0].id);
  };

  const setActive = (id) => commit({ ...po, activeCompanyId: id });
  const setTemplate = (t) => commit({ ...po, template: t });
  const setShow = (key, val) => commit({ ...po, show: { ...po.show, [key]: val } });
  const setText = (key, val) => commit({ ...po, [key]: val });

  const upload = (ref, id, key) => {
    const file = ref.current?.files?.[0];
    if (!file) return;
    if (file.size > 600 * 1024) { alert("Please use an image under 600 KB."); return; }
    const reader = new FileReader();
    reader.onload = (ev) => patchCompany(id, { [key]: ev.target.result });
    reader.readAsDataURL(file);
  };

  const previewHtml = useMemo(
    () => buildPOHtml(SAMPLE_PO, SAMPLE_VENDOR, active, {
      template: po.template, show: po.show, terms: po.terms, declaration: po.declaration, preview: true,
    }),
    [active, po.template, po.show, po.terms, po.declaration]
  );

  if (!isSuperAdmin) {
    return (
      <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.18)" }}>
        <div className="text-[12px] font-bold text-orange-300">🔒 Restricted</div>
        <div className="text-[11px] text-slate-400 mt-1">Only a Super Admin can edit company profiles and Purchase Order templates.</div>
      </div>
    );
  }

  const inp = "w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-[12px] text-[#f0f6ff] placeholder-slate-600 outline-none focus:border-blue-500/40 transition-colors";
  const lbl = "text-[10px] font-semibold text-slate-400 mb-1";

  return (
    <div className="space-y-5">

      {/* Company selector + active + template */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <div className={lbl}>Editing Company</div>
          <select value={editId} onChange={(e) => setEditId(e.target.value)} className={inp} style={{ background: "#0b0e17" }}>
            {po.companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(unnamed)"}</option>)}
          </select>
        </div>
        <div>
          <div className={lbl}>Active Company (used on POs)</div>
          <select value={po.activeCompanyId} onChange={(e) => setActive(e.target.value)} className={inp} style={{ background: "#0b0e17" }}>
            {po.companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(unnamed)"}</option>)}
          </select>
        </div>
        <div>
          <div className={lbl}>Active Template</div>
          <select value={po.template} onChange={(e) => setTemplate(e.target.value)} className={inp} style={{ background: "#0b0e17" }}>
            {PO_TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={addCompany} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-all">+ Add Company</button>
        {po.companies.length > 1 && (
          <button onClick={() => deleteCompany(editId)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">🗑 Delete “{active.name || "company"}”</button>
        )}
        {po.activeCompanyId === active.id
          ? <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10">✓ Active</span>
          : <button onClick={() => setActive(active.id)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-white/[0.1] text-slate-300 hover:border-white/20 transition-all">Set as Active</button>}
      </div>

      {/* Logo + signature upload */}
      <div className="grid grid-cols-2 gap-4">
        {[["logo", "Company Logo", logoRef], ["signature", "Signature Image", signRef]].map(([key, label, ref]) => (
          <div key={key} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
              {active[key] ? <img src={active[key]} alt={key} className="w-full h-full object-contain" /> : <span className="text-xl">{key === "logo" ? "🏭" : "✍️"}</span>}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-300 mb-1">{label}</div>
              <input ref={ref} type="file" accept="image/*" className="hidden" onChange={() => upload(ref, active.id, key)} />
              <div className="flex gap-1.5">
                <button onClick={() => ref.current?.click()} className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/[0.1] text-slate-300 hover:border-white/20 transition-all">Upload</button>
                {active[key] && <button onClick={() => patchCompany(active.id, { [key]: "" })} className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">Remove</button>}
              </div>
              <div className="text-[9px] text-slate-600 mt-1">PNG/JPG, under 600 KB</div>
            </div>
          </div>
        ))}
      </div>

      {/* Company fields */}
      {FIELD_GROUPS.map((group) => (
        <div key={group.title}>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">{group.title}</div>
          <div className="grid grid-cols-2 gap-3">
            {group.fields.map(([key, label, placeholder, full]) => (
              <div key={key} className={full ? "col-span-2" : ""}>
                <div className={lbl}>{label}</div>
                {full
                  ? <textarea value={active[key] || ""} onChange={(e) => patchCompany(active.id, { [key]: e.target.value })} placeholder={placeholder} rows={2} className={inp + " resize-none"} />
                  : <input value={active[key] || ""} onChange={(e) => patchCompany(active.id, { [key]: e.target.value })} placeholder={placeholder} className={inp} />}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Section visibility toggles */}
      <div>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em] mb-2">Template Sections</div>
        <div className="flex flex-wrap gap-2">
          {[["logo", "Logo"], ["bankDetails", "Bank Details"], ["signature", "Signature"], ["terms", "Terms & Conditions"], ["declaration", "Declaration"]].map(([key, label]) => {
            const on = po.show[key];
            return (
              <button key={key} onClick={() => setShow(key, !on)}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all"
                      style={{ color: on ? "#4ade80" : "#64748b", background: on ? "rgba(34,197,94,0.1)" : "transparent", borderColor: on ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.1)" }}>
                {on ? "✓ " : "○ "}{label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Terms + declaration */}
      <div className="grid grid-cols-1 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className={lbl}>Terms &amp; Conditions</div>
            <button onClick={() => setText("terms", DEFAULT_TERMS)} className="text-[10px] text-blue-400 hover:text-blue-300">Reset</button>
          </div>
          <textarea value={po.terms} onChange={(e) => setText("terms", e.target.value)} rows={5} className={inp + " resize-none"} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className={lbl}>Declaration</div>
            <button onClick={() => setText("declaration", DEFAULT_DECLARATION)} className="text-[10px] text-blue-400 hover:text-blue-300">Reset</button>
          </div>
          <textarea value={po.declaration} onChange={(e) => setText("declaration", e.target.value)} rows={2} className={inp + " resize-none"} />
        </div>
      </div>

      {/* Live preview */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.08em]">Live Preview</div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: PO_TEMPLATES[po.template]?.accent + "22", color: PO_TEMPLATES[po.template]?.accent }}>
            {PO_TEMPLATES[po.template]?.label}
          </span>
          <span className="text-[10px] text-slate-600">· sample data</span>
        </div>
        <div className="rounded-xl overflow-hidden bg-white" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
          <iframe title="PO preview" srcDoc={previewHtml} className="w-full" style={{ height: 560, border: "0", background: "#fff" }} />
        </div>
        <div className="text-[10px] text-slate-600 mt-1.5">Press <span className="text-slate-400 font-semibold">Save Changes</span> (top) to store these settings in Supabase.</div>
      </div>
    </div>
  );
}
