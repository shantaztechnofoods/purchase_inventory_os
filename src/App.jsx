import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { useAuth } from "./auth/AuthContext.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import UserManagementPage from "./pages/UserManagementPage.jsx";
import RoleManagementPage from "./pages/RoleManagementPage.jsx";
import AccessDeniedPage from "./components/AccessDeniedPage.jsx";
import UserProfileMenu from "./components/UserProfileMenu.jsx";
import ItemSearchSelect from "./components/ItemSearchSelect.jsx";
import VendorSearchSelect from "./components/VendorSearchSelect.jsx";
import { appendAuditWithUser, getAuditLog, subscribeAudit } from "./auth/auditStore.js";
import AuditHistoryPage from "./pages/AuditHistoryPage.jsx";
import { isSupabaseEnabled, IS_PROD, ALLOW_DEMO } from "./config/env.js";
import { loadSettings, saveSettings } from "./stores/settingsStore.js";
import { listVendors, createVendor, updateVendor, deleteVendor, bulkCreateVendors } from "./stores/vendorsStore.js";
import { fetchItems, createItem as itemCreate, updateItem as itemUpdate, deleteItem as itemDelete, updateStockAndHistory, addItemHistory } from "./stores/itemsStore.js";
import { fetchBOMs, createBOM as bomCreate, updateBOM as bomUpdate, renameBOM as bomRename, deleteBOM as bomDelete } from "./stores/bomsStore.js";
import { fetchPOs, createPO as poCreate, updatePO as poUpdate, deletePO as poDelete } from "./stores/posStore.js";
import { fetchInward, createInward, bulkCreateInward, deleteInwardByPO } from "./stores/inwardStore.js";
import { fetchOutward, createOutward, updateOutwardRef } from "./stores/outwardStore.js";
import { fetchPending, bulkCreatePending, updatePending as pendingUpdate, deletePending as pendingDelete, clearAllPending, updatePendingBomKey } from "./stores/pendingStore.js";
import { fetchFollowUps, createFollowUp as followupCreate, updateFollowUp as followupUpdate, deleteFollowUpsByPO } from "./stores/followupsStore.js";
import { fetchMachines, createMachine as machineCreate, updateMachine as machineUpdate, updateMachineBomKey } from "./stores/machinesStore.js";
import { useRealtimeTables } from "./realtime/useRealtimeTables.js";
import { fetchRecentMovements, MOVEMENT_META } from "./stores/stockMovementsStore.js";
import { sendPOWhatsApp, openVendorWhatsApp, waErrorToast } from "./utils/whatsapp.js";
import { uploadItemMedia, MAX_UPLOAD_BYTES } from "./utils/storage.js";
import POSettings from "./components/POSettings.jsx";
import { getActiveCompany, normalizePOSettings, openPOPdf, PO_TEMPLATE_OPTIONS } from "./utils/poTemplate.js";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, RadialBarChart, RadialBar
} from "recharts";

// Visible build marker — shown in the Settings header so you can confirm in PRODUCTION
// which bundle is live. If you don't see this tag on the Settings page, the deployed
// build is stale (redeploy on Vercel without build cache + hard-refresh the browser).
const APP_BUILD = "2026-05-30d-phase3";

// ─── DATA ────────────────────────────────────────────────────────────────────

const inventoryData = {
  "Electrical": [
    { code: "CAP-220",  name: "Motor Capacitor 25μF",   unit: "Pcs",  stock: 45, min: 10, max: 50,  status: "safe",     trend: [30, 38, 42, 44, 45], vendor: "Delta Electricals",        location: "Rack E-1, Bin 3", lastPurchaseRate: 50  },
    { code: "FUSE-10A", name: "Fuse 10A Ceramic",        unit: "Pcs",  stock: 3,  min: 25, max: 200, status: "critical", trend: [25, 18, 10,  6,  3], vendor: "Delta Electricals",        location: "Rack E-1, Bin 7", lastPurchaseRate: 18  },
  ],
  "Mechanical": [
    { code: "BRG-001",  name: "Spindle Bearing 6205 ZZ", unit: "Pcs",  stock: 8,   min: 20,  max: 100,  status: "warning",  trend: [22, 18, 14, 10,   8], vendor: "SKF India Ltd",             location: "Rack M-2, Bin 1", lastPurchaseRate: 150 },
    { code: "OIL-046",  name: "Spindle Oil ISO 10",       unit: "Ltrs", stock: 120, min: 50,  max: 500,  status: "safe",     trend: [200,175,155,130, 120], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-1",        lastPurchaseRate: 80  },
    { code: "BELT-V42", name: "V-Belt B-42",              unit: "Pcs",  stock: 12,  min: 15,  max: 80,   status: "warning",  trend: [30, 25, 20, 15,  12], vendor: "Shree Industries",          location: "Rack M-3, Bin 2", lastPurchaseRate: 55  },
    { code: "BRG-6205", name: "Bearing 6205 ZZ",          unit: "Pcs",  stock: 2,   min: 50,  max: 200,  status: "critical", trend: [50, 30, 18,  8,   2], vendor: "SKF India Ltd",             location: "Rack M-2, Bin 4", lastPurchaseRate: 122 },
    { code: "OIL-HYD46",name: "Hydraulic Oil ISO 46",     unit: "Ltrs", stock: 12,  min: 200, max: 1000, status: "critical", trend: [400,280,150, 60,  12], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-2",        lastPurchaseRate: 37  },
    { code: "SEAL-HP7", name: "High Pressure Seal Kit",   unit: "Set",  stock: 6,   min: 10,  max: 40,   status: "warning",  trend: [18, 15, 11,  8,   6], vendor: "Ram Polymers",              location: "Rack M-4, Bin 1", lastPurchaseRate: 250 },
    { code: "HOSE-HYD", name: "Hydraulic Hose 3/4\"",     unit: "Mtrs", stock: 45,  min: 20,  max: 100,  status: "safe",     trend: [30, 35, 38, 42,  45], vendor: "Ram Polymers",              location: "Rack M-4, Bin 6", lastPurchaseRate: 137 },
    { code: "BELT-A34", name: "V-Belt A-34",              unit: "Pcs",  stock: 18,  min: 30,  max: 120,  status: "warning",  trend: [50, 42, 35, 26,  18], vendor: "Shree Industries",          location: "Rack M-3, Bin 5", lastPurchaseRate: 62  },
    { code: "FLT-AIR2", name: "Air Filter Element",       unit: "Pcs",  stock: 14,  min: 10,  max: 50,   status: "safe",     trend: [10, 11, 12, 13,  14], vendor: "Shree Industries",          location: "Rack M-5, Bin 2", lastPurchaseRate: 176 },
    { code: "OIL-COMP", name: "Compressor Oil ISO 100",   unit: "Ltrs", stock: 240, min: 100, max: 600,  status: "safe",     trend: [180,195,210,225, 240], vendor: "Bharat Lubricants Pvt Ltd", location: "Tank B-3",        lastPurchaseRate: 200 },
    { code: "VLV-NRV",  name: "Non-Return Valve 1\"",     unit: "Pcs",  stock: 4,   min: 5,   max: 20,   status: "warning",  trend: [10,  8,  6,  5,   4], vendor: "Ram Polymers",              location: "Rack M-6, Bin 3", lastPurchaseRate: 450 },
  ],
  "R&D": [
    { code: "COOL-001", name: "Coolant Concentrate",        unit: "Ltrs", stock: 85, min: 40, max: 400, status: "safe",    trend: [60, 70, 78, 82, 85], vendor: "—", location: "R&D Store, Bin 1", lastPurchaseRate: 85  },
    { code: "INS-CNC3", name: "Carbide Insert CNMG120408",  unit: "Pcs",  stock: 22, min: 30, max: 150, status: "warning", trend: [50, 42, 35, 28, 22], vendor: "—", location: "R&D Store, Bin 4", lastPurchaseRate: 320 },
    { code: "TOOL-D12", name: "Drill Bit D12 HSS",          unit: "Pcs",  stock: 65, min: 20, max: 100, status: "safe",    trend: [40, 48, 55, 60, 65], vendor: "—", location: "R&D Store, Bin 7", lastPurchaseRate: 145 },
  ],
  "Other": [],
};

// ─── BOM DEFINITIONS ─────────────────────────────────────────────────────────

const bomDefinitions = {
  "KM-10": {
    label: "Kneading Machine 10L",
    color: "#3b82f6",
    items: [
      { code: "OIL-046",  qty: 2 },
      { code: "BRG-001",  qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-V42", qty: 1 },
    ],
  },
  "KM-15": {
    label: "Kneading Machine 15L",
    color: "#6366f1",
    items: [
      { code: "OIL-046",  qty: 3 },
      { code: "BRG-001",  qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-V42", qty: 2 },
    ],
  },
  "KM-20": {
    label: "Kneading Machine 20L",
    color: "#8b5cf6",
    items: [
      { code: "OIL-046",  qty: 4 },
      { code: "BRG-6205", qty: 2 },
      { code: "SEAL-HP7", qty: 1 },
      { code: "BELT-A34", qty: 2 },
      { code: "CAP-220",  qty: 1 },
    ],
  },
  "TM-600": {
    label: "Table Mixer 600",
    color: "#22c55e",
    items: [
      { code: "OIL-046",  qty: 2 },
      { code: "BRG-001",  qty: 2 },
      { code: "FUSE-10A", qty: 2 },
      { code: "BELT-V42", qty: 1 },
    ],
  },
  "ARM-800": {
    label: "Arm Mixer 800",
    color: "#f97316",
    items: [
      { code: "OIL-HYD46", qty: 5 },
      { code: "BRG-6205",  qty: 2 },
      { code: "SEAL-HP7",  qty: 1 },
      { code: "HOSE-HYD",  qty: 1 },
      { code: "BELT-A34",  qty: 1 },
    ],
  },
  "ARM-900": {
    label: "Arm Mixer 900",
    color: "#ef4444",
    items: [
      { code: "OIL-HYD46", qty: 8 },
      { code: "BRG-6205",  qty: 4 },
      { code: "SEAL-HP7",  qty: 2 },
      { code: "HOSE-HYD",  qty: 2 },
      { code: "VLV-NRV",   qty: 1 },
    ],
  },
};

const initialPOs = [
  {
    id: "PO-4521", date: "16 May 2026", vendor: "Bharat Lubricants Pvt Ltd",
    status: "approved", priority: "urgent", delivery: "19 May 2026",
    notes: "Urgent — machine M-07 down", receivedDate: null,
    lineItems: [
      { code: "OIL-HYD46", name: "Hydraulic Oil ISO 46", category: "Mechanical", unit: "Ltrs", qty: 500, rate: 37, amount: 18500 },
    ],
    subtotal: 18500, gst: 3330, amount: 21830,
    activityLog: [
      { action: "Created PO",  date: "16 May 2026", note: "1 item · ₹21,830" },
      { action: "Approved",    date: "16 May 2026" },
    ],
  },
  {
    id: "PO-4519", date: "15 May 2026", vendor: "SKF India Ltd",
    status: "pending", priority: "high", delivery: "21 May 2026",
    notes: "5-day lead time. Order immediately.", receivedDate: null,
    lineItems: [
      { code: "BRG-6205", name: "Bearing 6205 ZZ", category: "Mechanical", unit: "Pcs", qty: 100, rate: 122, amount: 12200 },
    ],
    subtotal: 12200, gst: 2196, amount: 14396,
    activityLog: [
      { action: "Created PO", date: "15 May 2026", note: "1 item · ₹14,396" },
    ],
  },
  {
    id: "PO-4517", date: "14 May 2026", vendor: "Shree Industries",
    status: "review", priority: "normal", delivery: "20 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BELT-V42", name: "V-Belt B-42",     category: "Mechanical", unit: "Pcs",  qty: 30, rate: 55,  amount: 1650 },
      { code: "BELT-A34", name: "V-Belt A-34",     category: "Mechanical", unit: "Pcs",  qty: 30, rate: 62,  amount: 1860 },
      { code: "FLT-AIR2", name: "Air Filter Element", category: "Mechanical", unit: "Pcs", qty: 15, rate: 176, amount: 2640 },
    ],
    subtotal: 6150, gst: 1107, amount: 7257,
    activityLog: [
      { action: "Created PO", date: "14 May 2026", note: "3 items · ₹7,257" },
    ],
  },
  {
    id: "PO-4515", date: "13 May 2026", vendor: "Delta Electricals",
    status: "approved", priority: "normal", delivery: "18 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "CAP-220",  name: "Motor Capacitor 25μF", category: "Electrical", unit: "Pcs", qty: 50,  rate: 50,  amount: 2500 },
      { code: "FUSE-10A", name: "Fuse 10A Ceramic",     category: "Electrical", unit: "Pcs", qty: 100, rate: 18,  amount: 1800 },
    ],
    subtotal: 4300, gst: 774, amount: 5074,
    activityLog: [
      { action: "Created PO", date: "13 May 2026", note: "2 items · ₹5,074" },
      { action: "Approved",   date: "13 May 2026" },
    ],
  },
  {
    id: "PO-4512", date: "12 May 2026", vendor: "Ram Polymers",
    status: "ordered", priority: "high", delivery: "14 May 2026",
    orderedDate: "12 May 2026", eta: "14 May 2026",
    notes: "Follow up required", receivedDate: null,
    lineItems: [
      { code: "SEAL-HP7", name: "High Pressure Seal Kit", category: "Mechanical", unit: "Set",  qty: 20, rate: 250, amount: 5000 },
      { code: "HOSE-HYD", name: "Hydraulic Hose 3/4\"",   category: "Mechanical", unit: "Mtrs", qty: 30, rate: 137, amount: 4110 },
    ],
    subtotal: 9110, gst: 1640, amount: 10750,
    activityLog: [
      { action: "Created PO",  date: "12 May 2026", note: "2 items · ₹10,750" },
      { action: "Approved",    date: "12 May 2026" },
      { action: "Order Placed",date: "12 May 2026", note: "ETA: 14 May 2026" },
    ],
  },
  {
    id: "PO-4510", date: "11 May 2026", vendor: "Bharat Lubricants Pvt Ltd",
    status: "approved", priority: "normal", delivery: "16 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "OIL-046",  name: "Spindle Oil ISO 10",     category: "Mechanical", unit: "Ltrs", qty: 200, rate: 80,  amount: 16000 },
      { code: "OIL-COMP", name: "Compressor Oil ISO 100", category: "Mechanical", unit: "Ltrs", qty: 30,  rate: 200, amount: 6000  },
    ],
    subtotal: 22000, gst: 3960, amount: 25960,
    activityLog: [
      { action: "Created PO", date: "11 May 2026", note: "2 items · ₹25,960" },
      { action: "Approved",   date: "11 May 2026" },
    ],
  },
  {
    id: "PO-4508", date: "10 May 2026", vendor: "SKF India Ltd",
    status: "approved", priority: "urgent", delivery: "15 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BRG-001",  name: "Spindle Bearing 6205 ZZ", category: "Mechanical", unit: "Pcs", qty: 100, rate: 150, amount: 15000 },
      { code: "BRG-6205", name: "Bearing 6205 ZZ",         category: "Mechanical", unit: "Pcs", qty: 80,  rate: 200, amount: 16000 },
    ],
    subtotal: 31000, gst: 5580, amount: 36580,
    activityLog: [
      { action: "Created PO", date: "10 May 2026", note: "2 items · ₹36,580" },
      { action: "Approved",   date: "10 May 2026" },
    ],
  },
  {
    id: "PO-4505", date: "08 May 2026", vendor: "Shree Industries",
    status: "approved", priority: "normal", delivery: "13 May 2026",
    notes: "", receivedDate: null,
    lineItems: [
      { code: "BELT-V42", name: "V-Belt B-42",      category: "Mechanical", unit: "Pcs", qty: 30, rate: 60,  amount: 1800 },
      { code: "FLT-AIR2", name: "Air Filter Element",category: "Mechanical", unit: "Pcs", qty: 15, rate: 226, amount: 3390 },
    ],
    subtotal: 5190, gst: 934, amount: 6124,
    activityLog: [
      { action: "Created PO", date: "8 May 2026", note: "2 items · ₹6,124" },
      { action: "Approved",   date: "8 May 2026" },
    ],
  },
];

const initialFollowUps = [
  {
    id: 1001,
    poId: "PO-4512",
    vendor: "Ram Polymers",
    itemNames: ["High Pressure Seal Kit", "Hydraulic Hose 3/4\""],
    eta: "14 May 2026",
    confirmedDate: "12 May 2026",
    nextFollowUp:  "13 May 2026",
    lastFollowUp:  "12 May 2026",
    frequency: 1,
  },
];

const vendors = [
  { id: "V001", name: "Bharat Lubricants Pvt Ltd", contactPerson: "Ramesh Patel", priority: "Preferred", location: "Surat, Gujarat", years: 8, rating: 4.8, category: "Oils & Lubricants", leadDays: 3, annualValue: "₹42L", performance: 94, status: "preferred", poCount: 32, phone: "+91 98765 43210", email: "orders@bharatlube.com", gst: "24AABCB1234L1ZN", address: "Plot 12, GIDC Industrial Estate, Surat, Gujarat 395010", paymentTerms: "30 days", notes: "Preferred lubricant supplier. Reliable delivery." },
  { id: "V002", name: "SKF India Ltd", contactPerson: "Suresh Mehta", priority: "Approved", location: "Pune, Maharashtra", years: 5, rating: 4.2, category: "Bearings & Seals", leadDays: 5, annualValue: "₹18L", performance: 88, status: "active", poCount: 18, phone: "+91 98765 11110", email: "sales@skfindia.com", gst: "27AABCS5678L1ZP", address: "SKF House, Harrington Road, Pune 411001", paymentTerms: "45 days", notes: "5-day lead time for bearings. Quality is consistent." },
  { id: "V003", name: "Shree Industries", contactPerson: "Hitesh Shah", priority: "Approved", location: "Surat, Gujarat", years: 3, rating: 3.8, category: "Belts & Spares", leadDays: 2, annualValue: "₹8L", performance: 76, status: "active", poCount: 14, phone: "+91 99887 66554", email: "info@shreeindustries.in", gst: "24AABCS9012L1ZQ", address: "B-45, Sachin GIDC, Surat, Gujarat 394230", paymentTerms: "15 days", notes: "Good for urgent orders. Local supplier." },
  { id: "V004", name: "Delta Electricals", contactPerson: "Nilesh Kumar", priority: "Backup", location: "Ahmedabad, Gujarat", years: 2, rating: 3.2, category: "Electrical Items", leadDays: 4, annualValue: "₹5L", performance: 62, status: "review", poCount: 9, phone: "+91 97654 32109", email: "delta@electricals.com", gst: "24AABCD3456L1ZR", address: "Phase 4, Naroda Industrial Area, Ahmedabad 382330", paymentTerms: "30 days", notes: "Under review — delivery issues in last quarter." },
  { id: "V005", name: "Ram Polymers", contactPerson: "Rajan Patel", priority: "Backup", location: "Vapi, Gujarat", years: 1, rating: 2.4, category: "Seals & Gaskets", leadDays: 7, annualValue: "₹3L", performance: 41, status: "poor", poCount: 6, phone: "+91 96543 21098", email: "ram@polymers.co.in", gst: "24AABCR7890L1ZS", address: "Vapi Industrial Estate, Vapi, Gujarat 396195", paymentTerms: "Immediate", notes: "Poor on-time delivery. Consider replacing." },
];

const monthlyPOData = [
  { month: "Nov", value: 280, orders: 12 },
  { month: "Dec", value: 350, orders: 15 },
  { month: "Jan", value: 420, orders: 18 },
  { month: "Feb", value: 310, orders: 13 },
  { month: "Mar", value: 480, orders: 21 },
  { month: "Apr", value: 520, orders: 23 },
];

const stockDistribution = [
  { name: "Safe", value: 1147, color: "#3b82f6" },
  { name: "Warning", value: 67, color: "#f97316" },
  { name: "Critical", value: 34, color: "#ef4444" },
];

const spendByCategory = [
  { name: "Lubricants", value: 38, color: "#3b82f6" },
  { name: "Bearings", value: 24, color: "#a78bfa" },
  { name: "Electrical", value: 18, color: "#f97316" },
  { name: "Belts", value: 12, color: "#22c55e" },
  { name: "Seals", value: 8, color: "#ef4444" },
];

const turnoverData = [
  { month: "Nov", rate: 4.2 }, { month: "Dec", rate: 4.8 },
  { month: "Jan", rate: 5.1 }, { month: "Feb", rate: 4.5 },
  { month: "Mar", rate: 5.8 }, { month: "Apr", rate: 6.2 },
];

const categoryStockData = [
  { category: "Lubricants", safe: 420, warning: 0, critical: 12 },
  { category: "Bearings", safe: 180, warning: 40, critical: 2 },
  { category: "Belts", safe: 90, warning: 18, critical: 0 },
  { category: "Electrical", safe: 210, warning: 0, critical: 3 },
  { category: "Seals", safe: 60, warning: 15, critical: 0 },
  { category: "Cutting", safe: 150, warning: 22, critical: 0 },
];

const aiSuggestions = [
  { type: "critical", color: "red", icon: "🔴", title: "Urgent Reorder: Hydraulic Oil ISO 46", desc: "Only 12L remaining (min: 200L). Based on avg consumption of 60L/month, order 500L from Bharat Lubricants.", qty: "500 Ltrs", amount: "₹18,500", vendor: "Bharat Lubricants" },
  { type: "critical", color: "red", icon: "🔴", title: "Urgent Reorder: Bearing 6205 ZZ", desc: "Only 2pcs remaining (min: 50pcs). 5-day lead time from SKF. Order immediately.", qty: "100 Pcs", amount: "₹12,200", vendor: "SKF India Ltd" },
  { type: "bulk", color: "green", icon: "🟢", title: "Bulk Order Opportunity", desc: "Consolidate bearing orders for M-01, M-03, M-11. SKF India offers 12% bulk discount above 150pcs.", qty: "200 Pcs", amount: "₹20,100 (saves ₹3,200)", vendor: "SKF India Ltd" },
  { type: "predictive", color: "purple", icon: "🟣", title: "Predictive: Fuse 10A Running Low", desc: "At current consumption rate, Fuse 10A will hit zero in ~6 days. Pre-order recommended.", qty: "200 Pcs", amount: "₹400", vendor: "Delta Electricals" },
];

const timeline = [
  { icon: "✅", bg: "bg-green-500/10 border-green-500/30", time: "Today, 10:32 AM", title: "PO #4521 Approved by GM", sub: "Hydraulic Oil × 500L · ₹18,500" },
  { icon: "🚨", bg: "bg-red-500/10 border-red-500/30", time: "Today, 09:14 AM", title: "Critical Alert: Bearing 6205 ZZ", sub: "Stock dropped to 2 pcs (min: 50)" },
  { icon: "📦", bg: "bg-blue-500/10 border-blue-500/30", time: "Yesterday, 4:45 PM", title: "GRN #8873 Received", sub: "V-Belt B-42 × 100 pcs from Shree Industries" },
  { icon: "📱", bg: "bg-orange-500/10 border-orange-500/30", time: "Yesterday, 11:00 AM", title: "WhatsApp sent to Bharat Lubricants", sub: "Auto-generated PO reminder via AI" },
  { icon: "🤖", bg: "bg-purple-500/10 border-purple-500/30", time: "Yesterday, 08:00 AM", title: "AI generated 3 reorder suggestions", sub: "Based on 30-day consumption analysis" },
  { icon: "🏭", bg: "bg-blue-500/10 border-blue-500/30", time: "2 days ago, 3:00 PM", title: "New vendor onboarded", sub: "Vimal Fasteners added to approved list" },
];

const approvals = [
  { id: "PO-4522", title: "Hydraulic Oil 500L", vendor: "Bharat Lubricants", amount: 18500, requester: "Store Manager", priority: "urgent", status: "pending" },
  { id: "PO-4519", title: "Bearing 6205 ZZ × 100pcs", vendor: "SKF India Ltd", amount: 12200, requester: "Maintenance Head", priority: "high", status: "pending" },
  { id: "PO-4517", title: "Maintenance Spares (5 items)", vendor: "Shree Industries", amount: 6750, requester: "Store Manager", priority: "normal", status: "review" },
  { id: "PO-4516", title: "Electrical Panel Components", vendor: "Delta Electricals", amount: 4100, requester: "Electrical Team", priority: "normal", status: "pending" },
  { id: "PO-4514", title: "Compressor Gasket Kit", vendor: "Ram Polymers", amount: 2800, requester: "Maintenance Head", priority: "low", status: "pending" },
];

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Business rule: stock <= min is low-stock (NOT stock < min).
// Items exactly at minimum must surface in Low Stock Alerts, Order Pipeline, and Create PO.
const recomputeStatus = (stock, min) =>
  stock <= 0                            ? "critical"
  : stock <= min && stock / min < 0.15 ? "critical"
  : stock <= min                        ? "warning"
  : "safe";

// Extract "₹" from "INR (₹)" or "$" from "USD ($)" etc.
const getCurrSymbol = (currency) => {
  const m = (currency || "INR (₹)").match(/\(([^)]+)\)/);
  return m ? m[1] : "₹";
};

const fmtDate = (d) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const parseDate = (str) => {
  if (!str) return new Date();
  const mMap = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const [d, m, y] = str.split(" ");
  return new Date(+y, mMap[m] ?? 0, +d);
};

const buildInitialHistory = (trend) => {
  const today = new Date();
  return trend.map((val, i, arr) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (arr.length - 1 - i) * 7);
    const change = i === 0 ? 0 : val - arr[i - 1];
    return {
      date:  fmtDate(d),
      event: i === 0 ? "Opening" : change >= 0 ? "Restock" : "Usage",
      change: i === 0 ? 0 : change,
      qty:   val,
    };
  }).reverse();
};

const statusConfig = {
  critical: { label: "CRITICAL", bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30", dot: "bg-red-500" },
  warning:  { label: "WARNING",  bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-500" },
  safe:     { label: "SAFE",     bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30", dot: "bg-green-500" },
  approved: { label: "APPROVED", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  pending:  { label: "PENDING",  bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
  review:   { label: "IN REVIEW",bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  overdue:  { label: "OVERDUE",  bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  preferred:{ label: "PREFERRED",bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  active:   { label: "ACTIVE",   bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30" },
  poor:     { label: "POOR",     bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" },
  draft:    { label: "DRAFT",    bg: "bg-white/[0.04]", text: "text-slate-400", border: "border-white/[0.1]" },
  ordered:  { label: "ORDERED",  bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30" },
  received: { label: "RECEIVED", bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" },
  rejected: { label: "REJECTED", bg: "bg-red-500/10",   text: "text-red-400",   border: "border-red-500/30" },
  "fu-pending":  { label: "PENDING",   bg: "bg-orange-500/10",  text: "text-orange-400",  border: "border-orange-500/30" },
  "fu-due":      { label: "DUE TODAY", bg: "bg-yellow-500/10",  text: "text-yellow-300",  border: "border-yellow-500/30" },
  "fu-overdue":  { label: "OVERDUE",   bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/30"    },
  "fu-done":     { label: "DONE",      bg: "bg-green-500/10",   text: "text-green-400",   border: "border-green-500/30"  },
};

const StatusBadge = ({ status }) => {
  const cfg = statusConfig[status] || statusConfig.safe;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border ${cfg.bg} ${cfg.text} ${cfg.border}`}
          style={{ letterSpacing: "0.04em" }}>
      {cfg.dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />}
      {cfg.label}
    </span>
  );
};

const MiniSparkline = ({ data, color }) => {
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {data.map((v, i) => (
        <div key={i} style={{ height: `${(v / max) * 100}%`, background: i === data.length - 1 ? color : color + "50" }} className="w-1 rounded-sm" />
      ))}
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-xs"
         style={{ background: "rgba(12,16,24,0.96)", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 12px 36px rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
      <p className="text-slate-400 mb-1.5 font-semibold text-[10px] uppercase tracking-wide">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="font-bold text-[11px] flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
          {p.name}: <span className="ml-auto pl-3 tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

// ─── NAV ITEMS ───────────────────────────────────────────────────────────────

const MACHINE_STAGES = ["BOM Issued", "Assembly", "Mechanical", "Electrical", "Trial", "Ready"];

const navItems = [
  { id: "dashboard",  icon: "⬛", label: "Dashboard",        section: "OVERVIEW" },
  { id: "inventory",  icon: "📦", label: "Item Master",      section: null },
  { id: "inward",     icon: "📥", label: "Inward",           section: "TRANSACTIONS" },
  { id: "outward",    icon: "📤", label: "Outward",          section: null },
  { id: "pending",    icon: "⏳", label: "Pending Stock",    section: null },
  { id: "pipeline",   icon: "🔄", label: "Order Pipeline",   section: "OPERATIONS" },
  { id: "machines",   icon: "🔧", label: "Machine Tracker",  section: null },
  { id: "vendors",    icon: "🏭", label: "Vendors",          section: null },
  { id: "analytics",  icon: "📊", label: "Analytics",        section: "INTELLIGENCE" },
  { id: "ai",         icon: "🤖", label: "AI Assistant",     section: null },
  { id: "history",    icon: "📜", label: "History & Reports",section: "REPORTS" },
  { id: "audit",      icon: "🛡️", label: "Audit Trail",      section: null },
  { id: "settings",   icon: "⚙️", label: "Settings",         section: "SYSTEM" },
  { id: "users",      icon: "👤", label: "User Management",  section: null },
  { id: "roles",      icon: "🔐", label: "Role Management",  section: null },
];

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

function Sidebar({ activePage, setActivePage, collapsed, setCollapsed, badges = {}, canView, onSearchOpen, onNotifsOpen, notifCount = 0, settings = SETTINGS_DEFAULTS }) {
  const visible = navItems.filter((item) => canView ? canView(item.id) : true);

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-60"} flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden relative`}
      style={{ background: "linear-gradient(180deg, #0a0d15 0%, #080b11 100%)", borderRight: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="absolute right-0 top-24 bottom-24 w-px pointer-events-none"
           style={{ background: "linear-gradient(180deg, transparent, rgba(59,130,246,0.18), transparent)" }} />

      {/* ── Logo + Search/Notif ── */}
      <div className="px-3 py-4 border-b border-white/[0.05] flex-shrink-0">
        {!collapsed ? (
          <>
            {(() => {
              const name   = settings.companyName || "Shantaz Technofoods";
              const spaceI = name.indexOf(" ");
              const line1  = spaceI > 0 ? name.slice(0, spaceI).toUpperCase() : name.toUpperCase();
              const line2  = spaceI > 0 ? name.slice(spaceI + 1).toUpperCase() : "";
              const initial = name[0]?.toUpperCase() || "S";
              return (
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-white text-[13px] font-black overflow-hidden"
                       style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 14px rgba(59,130,246,0.4)" }}>
                    {settings.logo ? <img src={settings.logo} alt="logo" className="w-full h-full object-contain" /> : initial}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-white leading-none tracking-wider truncate">{line1}</div>
                    {line2 && (
                      <div className="text-[10px] font-semibold leading-none tracking-wider mt-1.5 truncate"
                           style={{ background: "linear-gradient(90deg,#60a5fa,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                        {line2}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center gap-1.5">
              <button onClick={onSearchOpen}
                className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-slate-500 hover:text-slate-300 transition-all"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span>🔍</span><span className="flex-1">Search</span>
                <kbd className="text-[9px] text-slate-700 px-1 rounded" style={{ background: "rgba(255,255,255,0.05)" }}>⌘K</kbd>
              </button>
              <button onClick={onNotifsOpen}
                className="relative w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-300 transition-all flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                🔔
                {notifCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-[9px] font-black text-white rounded-full flex items-center justify-center"
                        style={{ background: "#ef4444", minWidth: 16, height: 16, padding: "0 3px", boxShadow: "0 2px 6px rgba(239,68,68,0.6)" }}>
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[13px] font-black overflow-hidden"
                 style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 14px rgba(59,130,246,0.4)" }}>
              {settings.logo ? <img src={settings.logo} alt="logo" className="w-full h-full object-contain" /> : (settings.companyName?.[0]?.toUpperCase() || "S")}
            </div>
            <button onClick={onNotifsOpen} className="relative w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              🔔
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-black text-white rounded-full flex items-center justify-center"
                      style={{ background: "#ef4444", minWidth: 15, height: 15, padding: "0 2px", boxShadow: "0 2px 6px rgba(239,68,68,0.5)" }}>
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </button>
            <button onClick={onSearchOpen} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white transition-all"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>🔍</button>
          </div>
        )}
      </div>

      {/* ── Nav (filtered by role) ── */}
      <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-0.5">
        {visible.map((item) => {
          const isActive = activePage === item.id;
          return (
            <div key={item.id}>
              {item.section && !collapsed && (
                <div className="px-2 pt-5 pb-1.5 text-[9px] font-semibold text-slate-700 tracking-[0.08em]">{item.section}</div>
              )}
              <button onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl transition-all duration-200 relative group ${isActive ? "text-white" : "text-slate-500 hover:text-slate-300"}`}
                style={isActive ? { background: "linear-gradient(90deg,rgba(59,130,246,0.15),rgba(59,130,246,0.04))", boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.22)" } : {}}>
                {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full" style={{ background: "linear-gradient(180deg,#60a5fa,#818cf8)" }} />}
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 transition-all duration-200 ${!isActive ? "group-hover:bg-white/[0.06]" : ""}`}
                     style={isActive ? { background: "rgba(59,130,246,0.22)", border: "1px solid rgba(99,102,241,0.35)" } : {}}>
                  {item.icon}
                </div>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left text-[13px] font-medium">{item.label}</span>
                    {(() => { const b = badges[item.id] ?? item.badge; return b > 0 ? (
                      <span className="text-[9px] font-black text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-tight"
                            style={{
                              background: item.id==="pending" ? "linear-gradient(135deg,#f97316,#ea580c)" : item.id==="pipeline" ? "linear-gradient(135deg,#7c3aed,#6d28d9)" : item.id==="machines" ? "linear-gradient(135deg,#2563eb,#1d4ed8)" : "linear-gradient(135deg,#ef4444,#dc2626)",
                              boxShadow:  item.id==="pending" ? "0 2px 6px rgba(249,115,22,0.4)" : item.id==="pipeline" ? "0 2px 6px rgba(124,58,237,0.4)" : item.id==="machines" ? "0 2px 6px rgba(37,99,235,0.4)" : "0 2px 6px rgba(239,68,68,0.4)",
                            }}>{b}</span>
                    ) : null; })()}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {/* ── User Profile Menu ── */}
      <div className="px-3 pb-3 pt-2 relative" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <UserProfileMenu collapsed={collapsed} />
        <button onClick={() => setCollapsed(!collapsed)}
          className="mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-slate-700 hover:text-slate-400 hover:bg-white/[0.05] transition-all text-[9px] font-black tracking-[0.06em] uppercase">
          {collapsed ? "▶" : <><span>◀</span><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  );
}

// ─── TOPBAR ──────────────────────────────────────────────────────────────────

function Topbar({ title, subtitle, children }) {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const timeStr = time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-4 flex-shrink-0"
         style={{ background: "linear-gradient(90deg,rgba(8,10,16,0.98),rgba(9,12,19,0.98))", backdropFilter: "blur(8px)" }}>
      <div className="flex-1 min-w-0">
        <h1 className="text-[15px] font-semibold text-white tracking-tight leading-none">{title}</h1>
        {subtitle && <p className="text-[12px] text-slate-500 mt-1 leading-none font-normal">{subtitle}</p>}
      </div>
      <div className="text-[10px] font-mono text-slate-600 bg-white/[0.03] border border-white/[0.05] rounded-lg px-3 py-1.5 tabular-nums hidden md:flex items-center gap-1.5 flex-shrink-0"
           style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
        <span className="text-slate-700">🕐</span> {timeStr}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
    </div>
  );
}

// ─── BUTTONS ─────────────────────────────────────────────────────────────────

const Btn = ({ variant = "ghost", size = "sm", onClick, children, className = "" }) => {
  const base = "inline-flex items-center gap-1.5 font-medium rounded-lg cursor-pointer border transition-all duration-150 active:scale-[0.96] select-none whitespace-nowrap";
  const sizes = { xs: "text-[11px] px-2.5 py-1 leading-none", sm: "text-[12px] px-3 py-1.5", md: "text-[13px] px-4 py-2" };
  const variants = {
    primary: "bg-blue-600 text-white border-blue-500/70 hover:bg-blue-500 hover:border-blue-400 hover:shadow-[0_0_18px_rgba(59,130,246,0.45)]",
    ghost:   "bg-white/[0.04] text-slate-400 border-white/[0.09] hover:text-white hover:bg-white/[0.08] hover:border-white/[0.18]",
    green:   "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/[0.18] hover:border-green-500/50 hover:shadow-[0_0_12px_rgba(34,197,94,0.2)]",
    red:     "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/[0.18] hover:border-red-500/50",
    wa:      "bg-[#22c55e] text-white border-[#16a34a] hover:bg-[#16a34a] hover:shadow-[0_0_14px_rgba(34,197,94,0.4)]",
    mail:    "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/[0.18] hover:border-blue-500/50",
    orange:  "bg-orange-500/10 text-orange-400 border-orange-500/30 hover:bg-orange-500/[0.18] hover:border-orange-500/50",
    purple:  "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/[0.18] hover:border-purple-500/50",
  };
  return <button onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>{children}</button>;
};

// ─── METRIC CARD ─────────────────────────────────────────────────────────────

function MetricCard({ label, value, delta, deltaUp, icon, barPct, barColor, valueColor, delay = 0 }) {
  const color = barColor || "#3b82f6";
  return (
    <div
      className="bg-[#0c1018] border border-white/[0.07] rounded-2xl p-5 relative overflow-hidden card-hover"
      style={{ animation: `slideUp 0.45s cubic-bezier(0.22,1,0.36,1) ${delay}ms both` }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-4 right-4 h-px pointer-events-none"
           style={{ background: `linear-gradient(90deg, transparent, ${color}90, transparent)` }} />
      {/* Corner glow */}
      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full pointer-events-none"
           style={{ background: color, filter: "blur(28px)", opacity: 0.08 }} />
      {/* Icon */}
      {icon && (
        <div className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center text-base"
             style={{ background: color + "15", border: `1px solid ${color}25` }}>
          {icon}
        </div>
      )}
      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em] mb-2.5">{label}</div>
      <div className={`text-[26px] font-bold leading-none mb-1.5 tabular-nums ${valueColor || "text-white"}`}
           style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {delta && (
        <div className={`text-[10px] font-bold flex items-center gap-1 mt-1 ${
          deltaUp !== undefined ? (deltaUp ? "text-emerald-400" : "text-red-400") : "text-slate-500"
        }`}>
          {deltaUp !== undefined && (deltaUp ? "▲ " : "▼ ")}{delta}
        </div>
      )}
      {barPct !== undefined && (
        <div className="mt-4 h-1 bg-white/[0.05] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
               style={{
                 width: `${Math.min(barPct, 100)}%`,
                 background: `linear-gradient(90deg, ${color}60, ${color})`,
                 boxShadow: `0 0 6px ${color}45`,
               }} />
        </div>
      )}
    </div>
  );
}

// ─── SECTION HEADER ──────────────────────────────────────────────────────────

function SectionHeader({ children, tag }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <h2 className="text-[13px] font-semibold text-white tracking-tight">{children}</h2>
      {tag && <span className="text-[10px] font-medium text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full tracking-wide">{tag}</span>}
    </div>
  );
}

// ─── DASHBOARD PAGE ───────────────────────────────────────────────────────────

function DashboardPage({ items = {}, pos = [], vendorList = [], machineLog = [], pendingLog = [], followUps = [], onNavigate, settings = SETTINGS_DEFAULTS }) {
  const allItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((i) => ({ ...i, category: cat }))
  );
  const criticalItems = allItems.filter((i) => i.status === "critical");
  const warningItems  = allItems.filter((i) => i.status === "warning");
  const safeItems     = allItems.filter((i) => i.status === "safe");
  const totalSKUs     = allItems.length;
  const criticalN     = criticalItems.length;

  // Live recent stock movement feed from the immutable ledger (Supabase mode only).
  // Re-fetches whenever total on-hand changes (i.e. a movement was recorded), so the feed
  // tracks realtime stock changes without a separate subscription here.
  const [recentMoves, setRecentMoves] = useState([]);
  const moveSignal = allItems.reduce((s, i) => s + (i.stock || 0), 0) + ":" + allItems.length;
  useEffect(() => {
    let cancelled = false;
    fetchRecentMovements({ limit: 8 }).then((rows) => { if (!cancelled) setRecentMoves(rows || []); });
    return () => { cancelled = true; };
  }, [moveSignal]);

  const pendingPOs  = pos.filter((p) => ["pending","review","draft"].includes(p.status));
  const openPOValue = pos.filter((p) => p.status !== "received").reduce((s, p) => s + p.amount, 0);

  const curr    = getCurrSymbol(settings.currency);
  const fmtVal  = (v) =>
    v >= 10000000 ? `${curr}${(v / 10000000).toFixed(1)}Cr`
    : v >= 100000  ? `${curr}${(v / 100000).toFixed(1)}L`
    : v >= 1000    ? `${curr}${(v / 1000).toFixed(1)}K`
    : `${curr}${v}`;

  // Pending items where no stock is available (blocking production)
  const blockingMaterials = (() => {
    const findStock = (code) => allItems.find((i) => i.code === code)?.stock ?? 0;
    return pendingLog
      .filter((p) => findStock(p.code) < p.pendingQty)
      .slice(0, 5);
  })();

  // Active machines (in-progress builds that need stage updates)
  const activeMachines = machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").slice(0, 4);

  const kpis = [
    { label: "Total SKUs",        value: totalSKUs,                                              icon: "📦", color: "#3b82f6", nav: "inventory",  sub: `${safeItems.length} safe` },
    { label: "Critical Stock",    value: criticalN,                                              icon: "🔴", color: "#ef4444", nav: "inventory",  sub: `${warningItems.length} warning`,  alert: criticalN > 0 },
    { label: "Pending POs",       value: pendingPOs.length,                                      icon: "⚠️", color: "#f97316", nav: "pipeline",   sub: "awaiting approval",               alert: pendingPOs.length > 0 },
    { label: "Open PO Value",     value: fmtVal(openPOValue),                                    icon: "💰", color: "#22c55e", nav: "pipeline",   sub: `${pos.filter(p=>p.status!=="received").length} open` },
    { label: "In Production",     value: machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length, icon: "⚙️", color: "#6366f1", nav: "machines",   sub: "machines active" },
    { label: "Machines Ready",    value: machineLog.filter((m) => m.status === "completed").length, icon: "🏆", color: "#22c55e", nav: "machines", sub: "completed" },
    { label: "Pending Materials", value: pendingLog.length,                                      icon: "⏳", color: "#f97316", nav: "pending",    sub: "items pending",                   alert: pendingLog.length > 0 },
    { label: "Pending Approvals", value: pos.filter((p) => p.status === "pending").length,       icon: "📋", color: "#3b82f6", nav: "pipeline",   sub: "awaiting review",                 alert: pos.filter((p) => p.status === "pending").length > 0 },
    { label: "In Follow Up",      value: followUps.length,                                       icon: "📞", color: "#8b5cf6", nav: "pipeline",   sub: "orders tracked" },
  ];

  const EmptyState = ({ icon, title, sub }) => (
    <div className="py-10 text-center">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-bold text-green-400">{title}</div>
      <div className="text-[11px] text-slate-500 mt-1">{sub}</div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Dashboard" subtitle={`${settings.companyName || "Live inventory snapshot"} — real-time overview`}>
        {settings.whatsappAlerts && <Btn variant="wa" size="sm">📱 WhatsApp Alert</Btn>}
        {settings.emailAlerts    && <Btn variant="mail" size="sm">✉️ Send Report</Btn>}
        <Btn variant="primary" size="sm" onClick={() => onNavigate?.("pipeline")}>+ New PO</Btn>
      </Topbar>

      <div className="p-6 space-y-6">

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {kpis.map((kpi) => (
            <button key={kpi.label} onClick={() => onNavigate?.(kpi.nav)}
              className="rounded-xl p-3.5 text-left transition-all active:scale-[0.97]"
              style={{ background: kpi.color + "0d", border: `1px solid ${kpi.alert ? kpi.color + "44" : kpi.color + "22"}` }}
              onMouseEnter={(e) => { e.currentTarget.style.background = kpi.color + "18"; e.currentTarget.style.borderColor = kpi.color + "44"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = kpi.color + "0d"; e.currentTarget.style.borderColor = kpi.alert ? kpi.color + "44" : kpi.color + "22"; }}>
              <div className="text-lg mb-1.5">{kpi.icon}</div>
              <div className="text-2xl font-black" style={{ color: kpi.alert ? kpi.color : "#f0f6ff" }}>{kpi.value}</div>
              <div className="text-[10px] font-bold text-white mt-0.5 leading-tight">{kpi.label}</div>
              <div className="text-[9px] text-slate-600 mt-0.5 truncate">{kpi.sub}</div>
            </button>
          ))}
        </div>

        {/* ── Actionable Sections ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* 1. Critical Stock Requiring Immediate Purchase */}
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">🔴 Critical Stock — Order Now</span>
                {criticalN > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#ef444422", color: "#ef4444", border: "1px solid #ef444444" }}>{criticalN}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("inventory")} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">View All →</button>
            </div>
            {criticalItems.length === 0 ? (
              <EmptyState icon="✅" title="All stock levels safe" sub="No critical items right now." />
            ) : (
              <div className="space-y-2.5">
                {criticalItems.slice(0, 4).map((item) => {
                  const pct = item.min > 0 ? Math.min(Math.round((item.stock / item.min) * 100), 100) : 0;
                  return (
                    <div key={item.code} className="rounded-xl p-3.5 border bg-red-500/[0.06] border-red-500/20">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white truncate">{item.name}</span>
                            <span className="text-[9px] font-mono text-slate-600 bg-white/[0.05] px-1.5 py-0.5 rounded flex-shrink-0">{item.code}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Stock: <span className="text-red-400 font-bold">{item.stock} {item.unit}</span>
                            {" · "}Min: <span className="text-white font-bold">{item.min} {item.unit}</span>
                            {item.vendor && item.vendor !== "—" && <span className="text-slate-500"> · {item.vendor}</span>}
                          </div>
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("pipeline")}>🛒 Order</Btn>
                      </div>
                      <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-red-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {criticalItems.length > 4 && (
                  <button onClick={() => onNavigate?.("inventory")} className="w-full text-[10px] text-slate-500 hover:text-blue-400 transition-colors py-1">
                    +{criticalItems.length - 4} more critical items →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 2. Pending PO Approvals */}
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">📋 Pending PO Approvals</span>
                {pendingPOs.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#f9731622", color: "#f97316", border: "1px solid #f9731644" }}>{pendingPOs.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("pipeline")} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">Open Pipeline →</button>
            </div>
            {pendingPOs.length === 0 ? (
              <EmptyState icon="✅" title="No approvals pending" sub="All POs are up to date." />
            ) : (
              <div className="space-y-2.5">
                {pendingPOs.slice(0, 4).map((po) => (
                  <div key={po.id} className="rounded-xl p-3.5 border bg-orange-500/[0.06] border-orange-500/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold text-white">{po.id}</span>
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wide flex-shrink-0 ${
                            po.status === "draft"  ? "bg-slate-500/20 text-slate-400" :
                            po.status === "review" ? "bg-blue-500/20 text-blue-400"  :
                                                     "bg-orange-500/20 text-orange-400"
                          }`}>{po.status}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {po.vendor} · ₹{(po.amount || 0).toLocaleString("en-IN")} · {(po.lineItems || []).length} item{(po.lineItems || []).length !== 1 ? "s" : ""}
                        </div>
                      </div>
                      <Btn variant="primary" size="xs" onClick={() => onNavigate?.("pipeline")}>Review →</Btn>
                    </div>
                  </div>
                ))}
                {pendingPOs.length > 4 && (
                  <button onClick={() => onNavigate?.("pipeline")} className="w-full text-[10px] text-slate-500 hover:text-blue-400 transition-colors py-1">
                    +{pendingPOs.length - 4} more pending →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 3. Pending Materials Blocking Production */}
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">⏳ Materials Blocking Production</span>
                {blockingMaterials.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#f9731622", color: "#f97316", border: "1px solid #f9731644" }}>{blockingMaterials.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("pending")} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">View Pending →</button>
            </div>
            {blockingMaterials.length === 0 ? (
              <EmptyState icon="✅" title="All materials available" sub="No production blockers right now." />
            ) : (
              <div className="space-y-2.5">
                {blockingMaterials.map((p, i) => {
                  const liveStock = allItems.find((it) => it.code === p.code)?.stock ?? 0;
                  const shortage  = p.pendingQty - liveStock;
                  return (
                    <div key={i} className="rounded-xl p-3.5 border bg-orange-500/[0.06] border-orange-500/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-white truncate">{p.name || p.code}</span>
                            <span className="text-[9px] font-mono text-slate-600 bg-white/[0.05] px-1.5 py-0.5 rounded flex-shrink-0">{p.code}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Need: <span className="text-white font-bold">{p.pendingQty} {p.unit}</span>
                            {" · "}Have: <span className={liveStock > 0 ? "text-orange-400 font-bold" : "text-red-400 font-bold"}>{liveStock} {p.unit}</span>
                            {" · "}<span className="text-red-400">Short {shortage}</span>
                          </div>
                          {p.bomKey && <div className="text-[9px] text-slate-600 mt-0.5">{p.bomKey}{p.serialNo ? ` · ${p.serialNo}` : ""}</div>}
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("pipeline")}>+ PO</Btn>
                      </div>
                    </div>
                  );
                })}
                {pendingLog.filter((p) => (allItems.find((it) => it.code === p.code)?.stock ?? 0) < p.pendingQty).length > 5 && (
                  <button onClick={() => onNavigate?.("pending")} className="w-full text-[10px] text-slate-500 hover:text-blue-400 transition-colors py-1">
                    +{pendingLog.filter((p) => (allItems.find((it) => it.code === p.code)?.stock ?? 0) < p.pendingQty).length - 5} more blocking →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 4. Machines Ready for Next Stage */}
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-white">⚙️ Machines — Next Stage</span>
                {activeMachines.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#6366f122", color: "#818cf8", border: "1px solid #6366f144" }}>{activeMachines.length}</span>
                )}
              </div>
              <button onClick={() => onNavigate?.("machines")} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">View Tracker →</button>
            </div>
            {activeMachines.length === 0 ? (
              <EmptyState icon="🔧" title="No active builds" sub="Start a machine from the rack (Machine Tracker) to begin a build." />
            ) : (
              <div className="space-y-2.5">
                {activeMachines.map((m) => {
                  const stages   = m.history || [];
                  const lastStage = stages[stages.length - 1];
                  const stageN    = stages.length;
                  return (
                    <div key={m.id} className="rounded-xl p-3.5 border bg-indigo-500/[0.06] border-indigo-500/20">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-white truncate">{m.bomLabel || m.bomKey}</span>
                            {m.serialNo && <span className="text-[9px] font-mono text-slate-600 bg-white/[0.05] px-1.5 py-0.5 rounded flex-shrink-0">{m.serialNo}</span>}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Stage <span className="text-white font-bold">{stageN}</span>
                            {lastStage && <span className="text-slate-500"> · {lastStage.stage || lastStage.note || "In progress"}</span>}
                          </div>
                          {m.createdDate && <div className="text-[9px] text-slate-600 mt-0.5">Started {m.createdDate}</div>}
                        </div>
                        <Btn variant="primary" size="xs" onClick={() => onNavigate?.("machines")}>Update →</Btn>
                      </div>
                    </div>
                  );
                })}
                {machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length > 4 && (
                  <button onClick={() => onNavigate?.("machines")} className="w-full text-[10px] text-slate-500 hover:text-blue-400 transition-colors py-1">
                    +{machineLog.filter((m) => m.status === "active" && m.stage !== "BOM Issued").length - 4} more active builds →
                  </button>
                )}
              </div>
            )}
          </div>

        </div>

        {/* ── Recent Stock Movements (live ledger feed) ── */}
        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-white">🔄 Recent Stock Movements</span>
              {recentMoves.length > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#3b82f622", color: "#60a5fa", border: "1px solid #3b82f644" }}>{recentMoves.length}</span>
              )}
            </div>
            <button onClick={() => onNavigate?.("history")} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">Full Ledger →</button>
          </div>
          {recentMoves.length === 0 ? (
            <EmptyState icon="📒" title="No movements recorded yet" sub="Stock changes appear here in real time (Supabase mode)." />
          ) : (
            <div className="space-y-1.5">
              {recentMoves.map((m) => {
                const meta = MOVEMENT_META[m.movementType] || { label: m.movementType, sign: "±", color: "#8b5cf6" };
                const isIn = m.qty > 0;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-white truncate">{m.itemName || m.itemCode}</span>
                        <span className="text-[9px] font-mono text-slate-600 bg-white/[0.05] px-1.5 py-0.5 rounded flex-shrink-0">{m.itemCode}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        <span style={{ color: meta.color }}>{meta.label}</span>
                        {m.createdByName ? ` · ${m.createdByName}` : ""}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[11px] font-black font-mono" style={{ color: isIn ? "#4ade80" : "#f87171", fontVariantNumeric: "tabular-nums" }}>
                        {isIn ? "+" : ""}{m.qty}
                      </div>
                      <div className="text-[9px] text-slate-600">→ {m.afterStock}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── QUICK STOCK MODAL ───────────────────────────────────────────────────────

function QuickStockModal({ item, mode, onConfirm, onClose }) {
  const [qty, setQty] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const isAdd = mode === "add";

  const newStock = (() => {
    const n = parseInt(qty, 10);
    if (!n || isNaN(n) || n <= 0) return null;
    return Math.max(0, item.stock + (isAdd ? n : -n));
  })();
  const previewStatus = newStock !== null ? recomputeStatus(newStock, item.min) : null;

  const confirm = () => {
    const n = parseInt(qty, 10);
    if (!n || isNaN(n) || n <= 0) return;
    onConfirm(isAdd ? n : -n);
    onClose();
  };

  const accentBorder = isAdd ? "rgba(34,197,94,0.4)"  : "rgba(249,115,22,0.4)";
  const accentGlow   = isAdd ? "rgba(34,197,94,0.18)" : "rgba(249,115,22,0.18)";
  const accentText   = isAdd ? "#4ade80" : "#fb923c";
  const accentShadow = isAdd ? "rgba(74,222,128,0.5)" : "rgba(251,146,60,0.5)";
  const btnGrad      = isAdd ? "linear-gradient(135deg,#16a34a,#15803d)" : "linear-gradient(135deg,#ea580c,#c2410c)";
  const btnGlow      = isAdd ? "0 0 14px rgba(34,197,94,0.35)" : "0 0 14px rgba(249,115,22,0.35)";

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.88)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xs flex flex-col rounded-2xl overflow-hidden"
           style={{
             background: "linear-gradient(180deg,#0d1018,#090c14)",
             border: `1px solid ${accentBorder}`,
             boxShadow: `0 32px 80px rgba(0,0,0,0.92), 0 0 60px ${accentGlow}, 0 0 0 1px rgba(255,255,255,0.03)`,
             animation: "slideUp 0.2s ease both",
           }}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between"
             style={{ background: isAdd ? "rgba(34,197,94,0.06)" : "rgba(249,115,22,0.06)" }}>
          <div className="min-w-0 pr-2">
            <div className="text-[10px] font-black uppercase tracking-[0.08em] mb-0.5"
                 style={{ color: accentText, textShadow: `0 0 8px ${accentShadow}` }}>
              {isAdd ? "Add Stock" : "Remove Stock"}
            </div>
            <div className="text-xs font-semibold text-white truncate">{item.name}</div>
          </div>
          <button onClick={onClose}
                  className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-xs font-bold flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-3.5">

          {/* Current stock chip */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl"
               style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">Current Stock</span>
            <span className={`text-sm font-black ${statusConfig[item.status].text}`}
                  style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
              {item.stock} <span className="text-xs font-semibold text-slate-500">{item.unit}</span>
            </span>
          </div>

          {/* Quantity input */}
          <div>
            <div className="text-[11px] font-medium tracking-tight mb-1.5"
                 style={{ color: "#93c5fd" }}>
              Quantity
            </div>
            <input ref={inputRef} type="number" min="1" value={qty}
                   onChange={(e) => setQty(e.target.value)}
                   onKeyDown={(e) => e.key === "Enter" && confirm()}
                   placeholder="Enter quantity"
                   className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm font-bold text-[#f0f6ff] placeholder-slate-600 outline-none leading-relaxed modal-input"
                   style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif" }} />
          </div>

          {/* Live preview */}
          {previewStatus && (
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl transition-all"
                 style={{
                   background: previewStatus === "critical" ? "rgba(239,68,68,0.06)" : previewStatus === "warning" ? "rgba(249,115,22,0.06)" : "rgba(59,130,246,0.06)",
                   border: `1px solid ${previewStatus === "critical" ? "rgba(239,68,68,0.3)" : previewStatus === "warning" ? "rgba(249,115,22,0.3)" : "rgba(59,130,246,0.3)"}`,
                 }}>
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-0.5">New Stock</div>
                <div className="text-sm font-black font-mono"
                     style={{ color: previewStatus === "critical" ? "#ef4444" : previewStatus === "warning" ? "#f97316" : "#60a5fa", fontFamily: "'Inter',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {newStock} <span className="text-xs font-semibold text-slate-500">{item.unit}</span>
                </div>
              </div>
              <StatusBadge status={previewStatus} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/[0.07] flex gap-2 flex-shrink-0"
             style={{ background: "rgba(0,0,0,0.3)" }}>
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <button onClick={confirm}
                  className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white border transition-all duration-200"
                  style={{ background: btnGrad, borderColor: accentBorder, boxShadow: btnGlow }}>
            {isAdd ? "＋ Confirm Add" : "－ Confirm Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ITEM DETAIL MODAL ───────────────────────────────────────────────────────

function ItemDetailModal({ item, category, onClose, onDelete, onUpdateStock, onEdit, vendorList = [], outwardLog = [], bomDefs = {}, machineLog = [], inwardLog = [], pos = [] }) {
  const [adjustMode, setAdjustMode] = useState(null);
  const [adjustQty,  setAdjustQty]  = useState("");
  const [mvFilter,   setMvFilter]   = useState("all");
  const [mvDateFrom, setMvDateFrom] = useState("");
  const [mvDateTo,   setMvDateTo]   = useState("");

  const cfg      = statusConfig[item.status];
  const stockPct = item.min > 0 ? Math.min(Math.round((item.stock / item.min) * 100), 150) : 0;

  const history     = item.history || [];
  const lastUpdated = history.length > 0 ? history[0].date : fmtDate(new Date());
  const invValue    = item.lastPurchaseRate ? (item.stock * item.lastPurchaseRate) : 0;

  const handleAdjust = () => {
    const qty = parseInt(adjustQty, 10);
    if (!qty || isNaN(qty) || qty <= 0) return;
    onUpdateStock(adjustMode === "add" ? qty : -qty);
    setAdjustMode(null);
    setAdjustQty("");
  };

  const glowColor = item.status === "critical" ? "rgba(239,68,68,0.25)" : item.status === "warning" ? "rgba(249,115,22,0.25)" : "rgba(34,197,94,0.18)";
  const barGrad   = item.status === "critical" ? "linear-gradient(90deg,#ef4444,#dc2626)" : item.status === "warning" ? "linear-gradient(90deg,#f97316,#ea580c)" : "linear-gradient(90deg,#22c55e,#16a34a)";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.9)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg flex flex-col rounded-2xl overflow-hidden"
           style={{
             maxHeight: "90vh",
             background: "linear-gradient(180deg,#0d1018 0%,#090c14 100%)",
             border: `1px solid ${glowColor}`,
             boxShadow: `0 40px 100px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.04), 0 0 60px ${glowColor}`,
             animation: "slideUp 0.25s ease both",
           }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.08] flex items-start justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(59,130,246,0.1),rgba(99,102,241,0.05))" }}>
          <div className="flex-1 min-w-0 pr-3 flex items-start gap-3">
            {/* Optional item photo (Phase 1 item media) */}
            {item.photo && (
              <a href={item.photo} target="_blank" rel="noreferrer" title="Open photo"
                 className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0"
                 style={{ border: "1px solid rgba(255,255,255,0.12)" }}>
                <img src={item.photo} alt={item.name} className="w-full h-full object-cover" />
              </a>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-white leading-snug truncate">{item.name}</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold text-blue-400">{item.code}</span>
                <span className="text-slate-700">·</span>
                <StatusBadge status={item.status} />
                <span className="text-slate-700">·</span>
                <span className="text-[10px] text-slate-500">{category}</span>
                {item.designFile && (
                  <a href={item.designFile} target="_blank" rel="noreferrer" title={item.designName || "Open design"}
                     className="text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/30 px-2 py-0.5 rounded-full hover:bg-violet-500/20 transition-all">
                    📐 View Design
                  </a>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-sm font-bold flex-shrink-0">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Stock level card */}
          <div className="p-4 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${glowColor}` }}>
            <div className="flex items-end justify-between mb-3">
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1">Current Stock</div>
                <div className={`text-4xl font-black leading-none ${cfg.text}`}
                     style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {item.stock}
                  <span className="text-sm font-bold text-slate-500 ml-1.5">{item.unit}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1">Min Level</div>
                <div className="text-xl font-black text-slate-400"
                     style={{ fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", fontVariantNumeric: "tabular-nums" }}>
                  {item.min} <span className="text-xs text-slate-600">{item.unit}</span>
                </div>
              </div>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                   style={{ width: `${Math.min(stockPct, 100)}%`, background: barGrad }} />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-slate-700">0</span>
              <span className="text-[10px] text-slate-700">Min: {item.min} {item.unit}</span>
            </div>

            {/* Reserved / Available — live from the inventory engine (Supabase mode) */}
            {item.reservedStock != null && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="px-3 py-2 rounded-lg text-center" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.18)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-violet-400 mb-0.5">Reserved</div>
                  <div className="text-sm font-black text-violet-300" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.reservedStock} <span className="text-[10px] text-slate-600">{item.unit}</span>
                  </div>
                </div>
                <div className="px-3 py-2 rounded-lg text-center" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.18)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-emerald-400 mb-0.5">Available</div>
                  <div className="text-sm font-black text-emerald-300" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {item.availableStock} <span className="text-[10px] text-slate-600">{item.unit}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Reorder warning — available has dropped to/below the reorder level */}
            {item.reorderLevel > 0 && (item.availableStock ?? item.stock) <= item.reorderLevel && (
              <div className="mt-3 px-3 py-2 rounded-lg flex items-center gap-2" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <span className="text-sm">⚠️</span>
                <span className="text-[11px] font-bold text-red-300">Below reorder level ({item.reorderLevel} {item.unit}) — reorder recommended</span>
              </div>
            )}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Item Code",        value: item.code,              mono: true  },
              { label: "Category",         value: category                            },
              { label: "Min Stock",        value: `${item.min} ${item.unit}`, mono: true },
              { label: "Last Updated",     value: lastUpdated                         },
              { label: "Storage Location", value: item.location || "—",  full: true  },
              { label: "Last Rate",        value: item.lastPurchaseRate ? `₹ ${Number(item.lastPurchaseRate).toLocaleString("en-IN")} / ${item.unit}` : "—", mono: true },
              { label: "Inventory Value",  value: invValue ? `₹ ${invValue.toLocaleString("en-IN")}` : "—", mono: true, highlight: true },
            ].map(({ label, value, mono, full, highlight }) => (
              <div key={label} className={`px-3.5 py-3 rounded-xl ${full ? "col-span-2" : ""}`}
                   style={{ background: highlight ? "rgba(34,197,94,0.04)" : "rgba(255,255,255,0.02)", border: highlight ? "1px solid rgba(34,197,94,0.18)" : "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-[9px] font-black uppercase tracking-[0.06em] mb-1" style={{ color: highlight ? "#4ade80" : "#475569" }}>{label}</div>
                <div className={`text-xs font-semibold ${highlight ? "text-green-400" : "text-[#f0f6ff]"} ${mono ? "font-mono" : ""}`}
                     style={mono ? { fontFamily: "'Inter','SF Pro Text',system-ui,sans-serif", letterSpacing: "0.04em" } : {}}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Linked Vendors */}
          {(() => {
            const roleColor = (r) => r === "Preferred" ? "#fbbf24" : r === "Approved" ? "#34d399" : "#94a3b8";
            const roleIcon  = (r) => r === "Preferred" ? "⭐" : r === "Approved" ? "✅" : "🔘";
            const links = item.vendorLinks?.length
              ? [...item.vendorLinks].sort((a, b) => {
                  const o = { Preferred: 0, Approved: 1, Backup: 2 };
                  return (o[a.role] ?? 3) - (o[b.role] ?? 3);
                })
              : (item.vendor ? [{ vendorId: item.vendorId || "", vendorName: item.vendor, role: "Preferred" }] : []);
            if (links.length === 0) return null;
            return (
              <div>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                  Linked Vendors ({links.length})
                </div>
                <div className="space-y-1.5">
                  {links.map((link, i) => {
                    const v = vendorList.find((x) => x.id === link.vendorId);
                    const rc = roleColor(link.role);
                    return (
                      <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl border"
                           style={{ background: `${rc}06`, borderColor: `${rc}22` }}>
                        <span className="text-[12px] mt-0.5 flex-shrink-0">{roleIcon(link.role)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white">{link.vendorName}</span>
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full"
                                  style={{ color: rc, background: `${rc}18`, border: `1px solid ${rc}30` }}>
                              {link.role}
                            </span>
                          </div>
                          {v && (
                            <div className="text-[9px] text-slate-500 flex flex-wrap gap-2 mt-0.5">
                              {v.contactPerson && <span>👤 {v.contactPerson}</span>}
                              {v.phone && <span>📞 {v.phone}</span>}
                              {v.leadDays ? <span>🕐 {v.leadDays}d lead</span> : null}
                              {v.paymentTerms && <span>💳 {v.paymentTerms}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Stock adjustment panel */}
          {adjustMode && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.3)" }}>
              <div className="text-[9px] font-black text-blue-400 uppercase tracking-[0.08em] mb-3">
                {adjustMode === "add" ? "Add Stock" : "Remove Stock"}
              </div>
              <div className="flex gap-2">
                <input type="number" min="1" value={adjustQty} autoFocus
                       onChange={e => setAdjustQty(e.target.value)}
                       onKeyDown={e => e.key === "Enter" && handleAdjust()}
                       placeholder="Enter quantity"
                       className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input"
                       style={{ fontVariantNumeric: "tabular-nums" }} />
                <button onClick={handleAdjust}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all duration-200"
                        style={{ background: "linear-gradient(135deg,#2563eb,#4f46e5)", border: "1px solid rgba(99,130,255,0.5)", boxShadow: "0 0 12px rgba(59,130,246,0.35)" }}>
                  Confirm
                </button>
                <button onClick={() => { setAdjustMode(null); setAdjustQty(""); }}
                        className="px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.08] transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}


          {/* Stock History */}
          <div>
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2.5">Stock History</div>
            <div className="rounded-xl overflow-hidden border border-white/[0.06]">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06]"
                      style={{ background: "rgba(255,255,255,0.02)" }}>
                    {["Date","Event","Change","Qty"].map(h => (
                      <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="px-3 py-2 text-[10px] text-slate-500"
                          style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>{h.date}</td>
                      <td className="px-3 py-2 text-[10px] text-slate-400">{h.event}</td>
                      <td className="px-3 py-2 text-[10px] font-mono font-bold">
                        {h.change === 0 ? <span className="text-slate-600">—</span>
                          : h.change > 0 ? <span className="text-green-400">+{h.change}</span>
                          : <span className="text-red-400">{h.change}</span>}
                      </td>
                      <td className="px-3 py-2 text-[10px] font-mono font-bold text-slate-300">{h.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Consumption History */}
          {(() => {
            // Outward entries that involved this item
            const itemOutward = outwardLog
              .filter((e) => (e.items || []).some((i) => i.code === item.code))
              .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

            if (itemOutward.length === 0) return null;

            const getQty = (entry) => {
              const li = (entry.items || []).find((i) => i.code === item.code);
              return li?.issueQty || 0;
            };

            const totalConsumed = itemOutward.reduce((s, e) => s + getQty(e), 0);
            const lastConsDate  = itemOutward[0]?.date || null;

            // By BOM
            const byBOM = {};
            itemOutward.forEach((e) => {
              if (e.type === "bom" && e.ref) {
                byBOM[e.ref] = (byBOM[e.ref] || 0) + getQty(e);
              }
            });

            // By Machine serial number
            const byMachine = {};
            itemOutward.forEach((e) => {
              if (e.serialNo) {
                byMachine[e.serialNo] = (byMachine[e.serialNo] || 0) + getQty(e);
              }
            });

            // Monthly trend — last 6 months
            const parseMonthYear = (dateStr) => {
              if (!dateStr) return null;
              const parts = dateStr.trim().split(/[\s\-/]+/);
              const monthPart = parts.find((p) => isNaN(Number(p)));
              const yearPart  = parts.find((p) => p.length === 4 && !isNaN(Number(p)));
              return monthPart && yearPart ? `${monthPart}-${yearPart}` : null;
            };
            const now = new Date();
            const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const months = Array.from({ length: 6 }, (_, i) => {
              const d     = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
              const abbr  = monthNames[d.getMonth()];
              const yr    = String(d.getFullYear());
              const key   = `${abbr}-${yr}`;
              const short = `${abbr} '${yr.slice(2)}`;
              const qty   = itemOutward.reduce((s, e) => parseMonthYear(e.date) === key ? s + getQty(e) : s, 0);
              return { short, qty };
            });
            const maxQty = Math.max(...months.map((m) => m.qty), 1);

            // Last 10 usages
            const last10 = itemOutward.slice(0, 10).map((e) => ({
              date:     e.date,
              qty:      getQty(e),
              type:     e.type,
              bom:      e.ref,
              label:    e.label || e.ref || "Manual",
              serialNo: e.serialNo || null,
              dept:     e.dept || null,
            }));

            return (
              <div className="space-y-3 pt-1">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">
                  Consumption History
                </div>

                {/* Summary tiles */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ["Total Consumed",    `${totalConsumed} ${item.unit}`,    "#f97316"],
                    ["Last Used",         lastConsDate || "—",                "#8b5cf6"],
                    ["BOMs Using Item",   Object.keys(byBOM).length || "—",   "#3b82f6"],
                    ["Machines Used In",  Object.keys(byMachine).length || "—","#22c55e"],
                  ].map(([lbl, val, col]) => (
                    <div key={lbl} className="px-3.5 py-3 rounded-xl"
                         style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-[9px] font-black uppercase tracking-[0.06em] mb-1" style={{ color: "#475569" }}>{lbl}</div>
                      <div className="text-xs font-black tabular-nums" style={{ color: col }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Monthly trend bar chart */}
                <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2.5">Monthly Consumption Trend</div>
                  <div className="flex items-end gap-1.5" style={{ height: 52 }}>
                    {months.map((m) => (
                      <div key={m.short} className="flex-1 flex flex-col items-center justify-end gap-1">
                        {m.qty > 0 && (
                          <div className="text-[8px] font-bold text-orange-400 tabular-nums">{m.qty}</div>
                        )}
                        <div className="w-full rounded-sm"
                             style={{
                               height: `${Math.max(3, Math.round((m.qty / maxQty) * 32))}px`,
                               background: m.qty > 0 ? "rgba(249,115,22,0.65)" : "rgba(255,255,255,0.05)",
                             }} />
                        <div className="text-[8px] text-slate-700 whitespace-nowrap">{m.short}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Consumption by BOM */}
                {Object.keys(byBOM).length > 0 && (
                  <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2">By BOM</div>
                    <div className="space-y-2">
                      {Object.entries(byBOM).map(([bom, qty]) => {
                        const def = bomDefs[bom];
                        const pct = Math.round((qty / totalConsumed) * 100);
                        return (
                          <div key={bom}>
                            <div className="flex items-center justify-between mb-1">
                              <div>
                                <span className="text-[11px] font-bold text-white">{bom}</span>
                                {def?.label && <span className="text-[9px] text-slate-600 ml-1.5">{def.label}</span>}
                              </div>
                              <span className="text-[11px] font-mono font-bold text-orange-400">{qty} {item.unit}</span>
                            </div>
                            <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "rgba(249,115,22,0.55)" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Consumption by Machine S/N */}
                {Object.keys(byMachine).length > 0 && (
                  <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-2">By Machine Serial No.</div>
                    <div className="space-y-1.5">
                      {Object.entries(byMachine).map(([sn, qty]) => {
                        const machine = machineLog.find((m) => m.serialNo === sn);
                        return (
                          <div key={sn} className="flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-mono font-bold text-blue-400">S/N: {sn}</span>
                              {machine?.bomKey && (
                                <span className="text-[9px] text-slate-600 ml-1.5">{machine.bomKey}{machine.stage ? ` — ${machine.stage}` : ""}</span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono font-bold text-blue-400">{qty} {item.unit}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Last 10 usages */}
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.06em] text-slate-600 mb-1.5">
                    Last {last10.length} Usage{last10.length !== 1 ? "s" : ""}
                  </div>
                  <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                          {["Date","BOM / Source","Serial No","Qty Used"].map((h) => (
                            <th key={h} className="text-left text-[9px] font-medium text-slate-500 uppercase tracking-wider px-2.5 py-1.5">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {last10.map((u, i) => (
                          <tr key={i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors">
                            <td className="px-2.5 py-1.5 text-[10px] text-slate-500 whitespace-nowrap">{u.date}</td>
                            <td className="px-2.5 py-1.5 text-[10px] max-w-[90px] truncate" title={u.label}>
                              {u.type === "bom"
                                ? <span className="text-blue-400 font-mono font-bold">{u.bom}</span>
                                : <span className="text-slate-500">{u.dept || "Manual"}</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-[10px] font-mono">
                              {u.serialNo ? <span className="text-blue-400">{u.serialNo}</span> : <span className="text-slate-700">—</span>}
                            </td>
                            <td className="px-2.5 py-1.5 text-[10px] font-mono font-bold text-orange-400">
                              -{u.qty} {item.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Item Movement History */}
          {(() => {
            // Parse "22 May 2026" or ISO date strings to Date objects
            const parseDate = (str) => {
              if (!str) return null;
              let d = new Date(str);
              if (!isNaN(d.getTime())) return d;
              const mo = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
              const p = str.trim().split(/\s+/);
              if (p.length >= 3) {
                const day = parseInt(p[0]), m = mo[p[1]], yr = parseInt(p[2]);
                if (!isNaN(day) && m !== undefined && !isNaN(yr)) return new Date(yr, m, day);
              }
              return null;
            };

            // Build unified movement timeline from item.history (has authoritative balance),
            // enriched with reference numbers from inward/outward logs.
            const movements = [...(item.history || [])].map((h) => {
              let ref     = "—";
              let txnType = h.event || "—";

              if (h.change > 0) {
                const match = inwardLog.find(
                  (e) => e.code === item.code && e.date === h.date && e.qty === h.change
                );
                if (match) {
                  ref     = match.fromPO || "INW";
                  txnType = "Purchase Receipt";
                } else {
                  txnType = h.event === "Restock" ? "Stock In" : h.event;
                }
              } else if (h.change < 0) {
                const absQty = Math.abs(h.change);
                const match  = outwardLog.find(
                  (e) => e.date === h.date &&
                    (e.items || []).some((li) => li.code === item.code && li.issueQty === absQty)
                );
                if (match) {
                  txnType = match.type === "bom" ? "BOM Issue" : "Manual Outward";
                  ref     = match.type === "bom"
                    ? (match.serialNo ? `${match.ref}/${match.serialNo}` : match.ref)
                    : (match.dept || "MANUAL");
                } else {
                  txnType = (h.event === "Usage" || h.event === "Manual Out") ? "Stock Out" : h.event;
                }
              } else {
                txnType = h.event === "Opening" ? "Opening Stock" : h.event;
              }

              return { date: h.date, type: txnType, ref, qtyIn: h.change > 0 ? h.change : 0, qtyOut: h.change < 0 ? Math.abs(h.change) : 0, balance: h.qty };
            });

            if (movements.length === 0) return null;

            // Date filter helpers
            const now        = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart  = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 6);
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

            const filtered = movements.filter((m) => {
              const d = parseDate(m.date);
              if (!d) return true;
              if (mvFilter === "today")  return d >= todayStart;
              if (mvFilter === "week")   return d >= weekStart;
              if (mvFilter === "month")  return d >= monthStart;
              if (mvFilter === "custom") {
                const from = mvDateFrom ? new Date(mvDateFrom) : null;
                const to   = mvDateTo   ? new Date(mvDateTo + "T23:59:59") : null;
                if (from && d < from) return false;
                if (to   && d > to)   return false;
              }
              return true;
            });

            // Type badge config
            const txnCfg = (t) => {
              if (t === "Purchase Receipt") return { color: "#22c55e",  bg: "rgba(34,197,94,0.12)",   brd: "rgba(34,197,94,0.3)",   icon: "📥" };
              if (t === "BOM Issue")        return { color: "#3b82f6",  bg: "rgba(59,130,246,0.12)",  brd: "rgba(59,130,246,0.3)",  icon: "🔧" };
              if (t === "Manual Outward")   return { color: "#f97316",  bg: "rgba(249,115,22,0.12)",  brd: "rgba(249,115,22,0.3)",  icon: "📤" };
              if (t === "Stock In")         return { color: "#4ade80",  bg: "rgba(74,222,128,0.10)",  brd: "rgba(74,222,128,0.25)", icon: "⬆️" };
              if (t === "Stock Out")        return { color: "#ef4444",  bg: "rgba(239,68,68,0.10)",   brd: "rgba(239,68,68,0.25)",  icon: "⬇️" };
              if (t === "Opening Stock")    return { color: "#64748b",  bg: "rgba(100,116,139,0.10)", brd: "rgba(100,116,139,0.2)", icon: "🏁" };
              if (t === "Auto-fulfill pending") return { color: "#06b6d4", bg: "rgba(6,182,212,0.10)", brd: "rgba(6,182,212,0.25)", icon: "⚡" };
              return                               { color: "#8b5cf6",  bg: "rgba(139,92,246,0.10)",  brd: "rgba(139,92,246,0.25)", icon: "✦" };
            };

            const filterBtns = [
              ["all",    "All"],
              ["today",  "Today"],
              ["week",   "This Week"],
              ["month",  "This Month"],
              ["custom", "Custom"],
            ];

            return (
              <div className="space-y-3 pt-1">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">
                  Movement History
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap gap-1.5">
                  {filterBtns.map(([key, label]) => (
                    <button key={key} onClick={() => setMvFilter(key)}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all"
                            style={{
                              color:       mvFilter === key ? "#3b82f6" : "#64748b",
                              background:  mvFilter === key ? "rgba(59,130,246,0.12)" : "transparent",
                              borderColor: mvFilter === key ? "rgba(59,130,246,0.35)" : "rgba(255,255,255,0.08)",
                            }}>
                      {label}
                    </button>
                  ))}
                </div>

                {/* Custom date range inputs */}
                {mvFilter === "custom" && (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <div className="text-[9px] text-slate-600 mb-1">From</div>
                      <input type="date" value={mvDateFrom} onChange={(e) => setMvDateFrom(e.target.value)}
                             className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 outline-none"
                             style={{ colorScheme: "dark" }} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[9px] text-slate-600 mb-1">To</div>
                      <input type="date" value={mvDateTo} onChange={(e) => setMvDateTo(e.target.value)}
                             className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-[10px] text-slate-300 outline-none"
                             style={{ colorScheme: "dark" }} />
                    </div>
                  </div>
                )}

                {/* Summary counts for current filter */}
                <div className="flex gap-3 text-[10px]">
                  <span className="text-slate-600">{filtered.length} transaction{filtered.length !== 1 ? "s" : ""}</span>
                  {(() => {
                    const totalIn  = filtered.reduce((s, m) => s + m.qtyIn,  0);
                    const totalOut = filtered.reduce((s, m) => s + m.qtyOut, 0);
                    return (
                      <>
                        {totalIn  > 0 && <span className="text-green-400 font-mono font-bold">+{totalIn} {item.unit}</span>}
                        {totalOut > 0 && <span className="text-red-400   font-mono font-bold">-{totalOut} {item.unit}</span>}
                      </>
                    );
                  })()}
                </div>

                {/* Movement table */}
                {filtered.length === 0 ? (
                  <div className="text-[11px] text-slate-600 py-3 text-center">No movements in this period.</div>
                ) : (
                  <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.025)" }}>
                          {["Date", "Type", "Reference", "In", "Out", "Balance"].map((h) => (
                            <th key={h} className="text-left text-[9px] font-medium text-slate-500 uppercase tracking-wider px-2.5 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((m, i) => {
                          const cfg = txnCfg(m.type);
                          return (
                            <tr key={i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.015] transition-colors">
                              <td className="px-2.5 py-2 text-[10px] text-slate-500 whitespace-nowrap">{m.date}</td>
                              <td className="px-2.5 py-2">
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md whitespace-nowrap"
                                      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.brd}` }}>
                                  {cfg.icon} {m.type}
                                </span>
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono text-slate-400 max-w-[80px] truncate" title={m.ref}>{m.ref}</td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold">
                                {m.qtyIn > 0 ? <span className="text-green-400">+{m.qtyIn}</span> : <span className="text-slate-700">—</span>}
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold">
                                {m.qtyOut > 0 ? <span className="text-red-400">-{m.qtyOut}</span> : <span className="text-slate-700">—</span>}
                              </td>
                              <td className="px-2.5 py-2 text-[10px] font-mono font-bold text-slate-300 tabular-nums">{m.balance} {item.unit}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center gap-2 flex-wrap flex-shrink-0"
             style={{ background: "rgba(0,0,0,0.35)" }}>
          {onEdit   && <Btn variant="ghost" size="sm" onClick={onEdit}>✏️ Edit</Btn>}
          {onDelete && <Btn variant="red"   size="sm" onClick={() => { setAdjustMode(null); onDelete(); }}>🗑️ Delete</Btn>}
          <div className="flex-1" />
          {onUpdateStock && <Btn variant="green"  size="sm" onClick={() => { setAdjustMode("add");    setConfirmDelete(false); }}>+ Add Stock</Btn>}
          {onUpdateStock && <Btn variant="orange" size="sm" onClick={() => { setAdjustMode("remove"); setConfirmDelete(false); }}>− Remove Stock</Btn>}
        </div>
      </div>
    </div>
  );
}

// ─── ADD ITEM MODAL ───────────────────────────────────────────────────────────

function AddItemModal({ machines, onSave, onClose, initialValues = null, vendorList = [] }) {
  const isEdit = Boolean(initialValues);

  const initVendorLinks = () => {
    if (initialValues?.vendorLinks?.length) return initialValues.vendorLinks;
    if (initialValues?.vendorId) {
      const v = vendorList.find((x) => x.id === initialValues.vendorId);
      return [{ vendorId: initialValues.vendorId, vendorName: v?.name || initialValues.vendor || "", role: "Preferred" }];
    }
    return [];
  };

  const [form, setForm] = useState(() => isEdit ? {
    name:             initialValues.name,
    code:             initialValues.code,
    stock:            String(initialValues.stock),
    min:              String(initialValues.min),
    machine:          initialValues.machine || "Mechanical",
    unit:             initialValues.unit    || "Nos",
    location:         initialValues.location || "",
    lastPurchaseRate: String(initialValues.lastPurchaseRate || ""),
  } : {
    name: "", code: "", stock: "", min: "",
    machine: "Mechanical", unit: "Nos", location: "", lastPurchaseRate: "",
  });
  const [errors,       setErrors]       = useState({});
  const [vendorLinks,  setVendorLinks]  = useState(initVendorLinks);
  const [vendorSearch, setVendorSearch] = useState("");
  const [dropOpen,     setDropOpen]     = useState(false);
  const vendorDropRef  = useRef(null);
  const vendorSearchRef = useRef(null);

  // Optional media — Phase 1 item-media support. Files are uploaded to the
  // Supabase Storage bucket "item-media" (migration 017) and only the public URL
  // is stored in items.photo / items.design_file (migration 016). Pure metadata;
  // no impact on stock calculations or inventory logic. 25 MB per file.
  const [photo,       setPhoto]       = useState(initialValues?.photo       || "");
  const [designFile,  setDesignFile]  = useState(initialValues?.designFile  || "");
  const [designName,  setDesignName]  = useState(initialValues?.designName  || "");
  const [photoBusy,   setPhotoBusy]   = useState(false);
  const [designBusy,  setDesignBusy]  = useState(false);
  const [mediaErr,    setMediaErr]    = useState("");
  const photoInputRef  = useRef(null);
  const designInputRef = useRef(null);
  const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaErr(""); setPhotoBusy(true);
    try {
      const res = await uploadItemMedia("photos", file);
      if (!res.ok) { setMediaErr("Photo upload failed: " + res.error); return; }
      setPhoto(res.url);
    } finally { setPhotoBusy(false); }
  };
  const onPickDesign = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMediaErr(""); setDesignBusy(true);
    try {
      const res = await uploadItemMedia("designs", file);
      if (!res.ok) { setMediaErr("Design upload failed: " + res.error); return; }
      setDesignFile(res.url); setDesignName(file.name);
    } finally { setDesignBusy(false); }
  };

  useEffect(() => {
    if (!dropOpen) return;
    const handler = (e) => {
      if (vendorDropRef.current && !vendorDropRef.current.contains(e.target)) {
        setDropOpen(false);
        setVendorSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropOpen]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // All unlinked vendors sorted by priority; filter by search; cap visible at 20
  const unlinkedVendors = vendorList
    .filter((v) => !vendorLinks.some((l) => l.vendorId === v.id))
    .sort((a, b) => {
      const o = { Preferred: 0, Approved: 1, Backup: 2 };
      return (o[a.priority] ?? 3) - (o[b.priority] ?? 3);
    });
  const vendorDropItems = unlinkedVendors
    .filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    .slice(0, 20);
  const hasMoreVendors = unlinkedVendors
    .filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase()))
    .length > 20;

  const addVendorLink = (v) => {
    setVendorLinks((prev) => [
      ...prev,
      { vendorId: v.id, vendorName: v.name, role: prev.length === 0 ? "Preferred" : "Approved" },
    ]);
    setVendorSearch("");
  };

  const removeVendorLink = (vid) => setVendorLinks((prev) => prev.filter((l) => l.vendorId !== vid));

  const changeRole = (vid, newRole) => {
    setVendorLinks((prev) => prev.map((l) => l.vendorId === vid ? { ...l, role: newRole } : l));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim())                               e.name  = "Item name is required";
    if (!form.code.trim())                               e.code  = "Item code is required";
    if (form.stock === "" || isNaN(Number(form.stock)))  e.stock = "Enter a valid number";
    if (form.min   === "" || isNaN(Number(form.min)))    e.min   = "Enter a valid number";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const stock = Number(form.stock);
    const min   = Number(form.min);
    const preferredLink = vendorLinks.find((l) => l.role === "Preferred") || vendorLinks[0];
    const primaryVendor = preferredLink ? vendorList.find((v) => v.id === preferredLink.vendorId) : null;
    onSave(form.machine, {
      code:             form.code.toUpperCase().trim(),
      name:             form.name.trim(),
      unit:             form.unit || "Nos",
      location:         form.location.trim(),
      stock, min, max: 0, status: recomputeStatus(stock, min),
      trend: [stock, stock, stock, stock, stock],
      vendorLinks,
      vendorId:         preferredLink?.vendorId || "",
      vendor:           primaryVendor?.name || preferredLink?.vendorName || "",
      vendorPhone:      primaryVendor?.phone || "",
      lastPurchaseRate: Number(form.lastPurchaseRate) || 0,
      // Phase 1 — optional media metadata (no impact on stock)
      photo, designFile, designName,
    });
  };

  const nameRef  = useRef(null);
  const codeRef  = useRef(null);
  const stockRef = useRef(null);
  const minRef   = useRef(null);
  const rateRef  = useRef(null);

  const onEnter = (next) => (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    next ? next.current?.focus() : handleSave();
  };

  const inp = (err) =>
    `w-full bg-white/[0.04] border ${err ? "border-red-500/60" : "border-white/[0.08]"} rounded-xl px-4 py-3 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none leading-relaxed modal-input`;

  const computedStatus = (() => {
    const s = Number(form.stock);
    const m = Number(form.min);
    if (form.stock === "" || form.min === "" || isNaN(s) || isNaN(m)) return null;
    return recomputeStatus(s, m);
  })();

  const Label = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5" style={{ color: "#93c5fd" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  const roleColor = (r) => r === "Preferred" ? "#fbbf24" : r === "Approved" ? "#34d399" : "#94a3b8";
  const roleIcon  = (r) => r === "Preferred" ? "⭐" : r === "Approved" ? "✅" : "🔘";
  const selectStyle = { background: "#0b0e17", color: "#f0f6ff" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.88)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
           style={{
             maxHeight: "92vh",
             background: "linear-gradient(180deg,#0d1018 0%,#090c14 100%)",
             border: "1px solid rgba(59,130,246,0.32)",
             boxShadow: "0 40px 100px rgba(0,0,0,0.92), 0 0 0 1px rgba(255,255,255,0.04), 0 0 80px rgba(59,130,246,0.1)",
           }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(59,130,246,0.11),rgba(99,102,241,0.06))" }}>
          <div>
            <div className="text-[15px] font-semibold text-white tracking-tight">{isEdit ? "Edit Inventory Item" : "Add Inventory Item"}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Status auto-calculates from stock vs minimum level</div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all duration-200 flex items-center justify-center text-sm font-bold">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">

          {/* Row 1 — Name + Code */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="Item Name" req />
              <input ref={nameRef} value={form.name} onChange={(e) => set("name", e.target.value)}
                     onKeyDown={onEnter(codeRef)}
                     placeholder="e.g. Hydraulic Oil ISO 46" className={inp(errors.name)} />
              {errors.name && <div className="text-[10px] text-red-400 mt-1.5">{errors.name}</div>}
            </div>
            <div>
              <Label text="Item Code" req />
              <input ref={codeRef} value={form.code} onChange={(e) => set("code", e.target.value)}
                     onKeyDown={onEnter(stockRef)}
                     placeholder="e.g. OIL-HYD46" className={inp(errors.code)} />
              {errors.code && <div className="text-[10px] text-red-400 mt-1.5">{errors.code}</div>}
            </div>
          </div>

          {/* Row 2 — Quantity + Unit */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text={isEdit ? "Current Stock" : "Opening Stock"} req={!isEdit} />
              <input ref={stockRef} type="number" min="0" value={form.stock}
                     onChange={(e) => set("stock", e.target.value)}
                     onKeyDown={onEnter(minRef)} disabled={isEdit} readOnly={isEdit}
                     placeholder="0" className={inp(errors.stock)}
                     style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em", opacity: isEdit ? 0.6 : 1, cursor: isEdit ? "not-allowed" : "text" }} />
              {isEdit
                ? <div className="text-[10px] text-slate-500 mt-1.5">Stock is engine-managed — use <span className="text-blue-400 font-semibold">+ Add / − Remove Stock</span> to change it (creates a ledger entry).</div>
                : errors.stock && <div className="text-[10px] text-red-400 mt-1.5">{errors.stock}</div>}
            </div>
            <div>
              <Label text="Unit of Measure" req />
              <select value={form.unit} onChange={(e) => set("unit", e.target.value)} className={inp(false)} style={selectStyle}>
                {["Nos","Pcs","Kg","Meter","Ltrs","Mtrs","Set","Box","Roll","Pair"].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2b — Category + Location */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label text="Category" req />
              <select value={form.machine} onChange={(e) => set("machine", e.target.value)} className={inp(false)} style={selectStyle}>
                {["Mechanical","Electrical","In-House","Hardware"].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label text="Storage Location" />
              <input value={form.location} onChange={(e) => set("location", e.target.value)}
                     placeholder="e.g. Rack M-2, Bin 4" className={inp(false)} />
            </div>
          </div>

          {/* Row 3 — Min Stock */}
          <div>
            <Label text="Minimum Stock Alert Level" req />
            <input ref={minRef} type="number" min="0" value={form.min} onChange={(e) => set("min", e.target.value)}
                   onKeyDown={onEnter(rateRef)}
                   placeholder="Alert triggered when stock falls below this level" className={inp(errors.min)} />
            {errors.min && <div className="text-[10px] text-red-400 mt-1.5">{errors.min}</div>}
          </div>

          {/* Live status preview */}
          {computedStatus && (
            <div className="flex items-center justify-between px-4 py-3 rounded-xl"
                 style={{
                   background: computedStatus === "critical" ? "rgba(239,68,68,0.04)" : computedStatus === "warning" ? "rgba(249,115,22,0.04)" : "rgba(59,130,246,0.04)",
                   border: `1px solid ${computedStatus === "critical" ? "rgba(239,68,68,0.3)" : computedStatus === "warning" ? "rgba(249,115,22,0.3)" : "rgba(59,130,246,0.3)"}`,
                   boxShadow: computedStatus === "critical" ? "0 0 16px rgba(239,68,68,0.06)" : computedStatus === "warning" ? "0 0 16px rgba(249,115,22,0.06)" : "0 0 16px rgba(59,130,246,0.06)",
                 }}>
              <div>
                <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.08em]">Auto-detected status</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {computedStatus === "critical" && "Stock is critically low — immediate reorder needed"}
                  {computedStatus === "warning"  && "Stock is below minimum alert level"}
                  {computedStatus === "safe"     && "Stock level is within safe range"}
                </div>
              </div>
              <StatusBadge status={computedStatus} />
            </div>
          )}

          {/* Row 4 — Multi-vendor combobox (Vendor Master only) */}
          <div>
            <Label text={`Linked Vendors${vendorLinks.length ? ` (${vendorLinks.length})` : ""}`} />
            <div className="relative" ref={vendorDropRef}>

              {/* Selector box — chips + search input in one container */}
              <div
                className="min-h-[44px] w-full bg-white/[0.04] border rounded-xl px-3 py-2 flex flex-wrap gap-1.5 items-center cursor-text transition-all"
                style={{
                  borderColor: dropOpen ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.08)",
                  boxShadow:   dropOpen ? "0 0 0 2px rgba(59,130,246,0.12)" : "none",
                }}
                onClick={() => { setDropOpen(true); setTimeout(() => vendorSearchRef.current?.focus(), 0); }}
              >
                {/* Chips for linked vendors */}
                {vendorLinks.map((link) => {
                  const rc = roleColor(link.role);
                  return (
                    <span key={link.vendorId}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold flex-shrink-0 max-w-[180px]"
                          style={{ background: `${rc}18`, border: `1px solid ${rc}38`, color: rc }}>
                      <span className="flex-shrink-0">{roleIcon(link.role)}</span>
                      <span className="truncate">{link.vendorName}</span>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); removeVendorLink(link.vendorId); }}
                        className="flex-shrink-0 ml-0.5 opacity-60 hover:opacity-100 hover:text-red-400 transition-all leading-none">
                        ✕
                      </button>
                    </span>
                  );
                })}

                {/* Inline search input */}
                <input
                  ref={vendorSearchRef}
                  value={vendorSearch}
                  onChange={(e) => { setVendorSearch(e.target.value); setDropOpen(true); }}
                  onFocus={() => setDropOpen(true)}
                  onKeyDown={(e) => e.key === "Escape" && (setDropOpen(false), setVendorSearch(""))}
                  placeholder={
                    vendorLinks.length === 0
                      ? "Click to select vendors from Vendor Master…"
                      : unlinkedVendors.length > 0 ? "Add more vendors…" : ""
                  }
                  className="flex-1 min-w-[140px] bg-transparent outline-none text-xs text-[#f0f6ff] placeholder-slate-600"
                />
                <span className="text-slate-700 text-[9px] flex-shrink-0 pointer-events-none select-none ml-1">
                  {dropOpen ? "▲" : "▼"}
                </span>
              </div>

              {/* Dropdown */}
              {dropOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xl overflow-hidden overflow-y-auto"
                     style={{ background: "#0b0e17", border: "1px solid rgba(59,130,246,0.4)", boxShadow: "0 20px 50px rgba(0,0,0,0.8)", maxHeight: 224 }}>
                  {vendorList.length === 0 ? (
                    <div className="px-4 py-5 text-center">
                      <div className="text-[11px] text-slate-500 mb-1">No vendors in Vendor Master yet.</div>
                      <div className="text-[10px] text-slate-700">Go to Vendor Master to add vendors first.</div>
                    </div>
                  ) : vendorDropItems.length === 0 ? (
                    <div className="px-4 py-3 text-[11px] text-slate-600">
                      {vendorSearch ? "No vendors match your search." : "All vendors are already linked."}
                    </div>
                  ) : (
                    <>
                      <div className="px-3.5 py-2 border-b border-white/[0.05] flex items-center justify-between flex-shrink-0">
                        <span className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">
                          Vendor Master · {unlinkedVendors.length} available
                        </span>
                        {vendorSearch && (
                          <button onClick={() => setVendorSearch("")}
                                  className="text-[9px] text-slate-700 hover:text-slate-400 transition-colors">
                            Clear
                          </button>
                        )}
                      </div>
                      {vendorDropItems.map((v) => (
                        <button key={v.id}
                                onMouseDown={(e) => { e.preventDefault(); addVendorLink(v); }}
                                className="w-full text-left flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors border-b border-white/[0.04] last:border-0">
                          <span className="text-[11px] flex-shrink-0">{roleIcon(v.priority)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-white truncate">{v.name}</div>
                            {(v.contactPerson || v.leadDays) && (
                              <div className="text-[9px] text-slate-500 flex gap-2 mt-0.5">
                                {v.contactPerson && <span>👤 {v.contactPerson}</span>}
                                {v.leadDays ? <span>🕐 {v.leadDays}d lead</span> : null}
                              </div>
                            )}
                          </div>
                          {v.priority && (
                            <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0"
                                  style={{ color: roleColor(v.priority), background: `${roleColor(v.priority)}18`, border: `1px solid ${roleColor(v.priority)}30` }}>
                              {v.priority}
                            </span>
                          )}
                        </button>
                      ))}
                      {hasMoreVendors && (
                        <div className="px-4 py-2 text-center border-t border-white/[0.05]">
                          <span className="text-[10px] text-slate-700">
                            Type to filter · {unlinkedVendors.filter((v) => !vendorSearch || v.name.toLowerCase().includes(vendorSearch.toLowerCase())).length - 20} more not shown
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Linked vendors — role editor rows */}
            {vendorLinks.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {vendorLinks.map((link) => {
                  const v   = vendorList.find((x) => x.id === link.vendorId);
                  const rc  = roleColor(link.role);
                  return (
                    <div key={link.vendorId}
                         className="flex items-center gap-2 px-3 py-2.5 rounded-xl border"
                         style={{ background: `${rc}06`, borderColor: `${rc}22` }}>
                      <span className="text-[11px] flex-shrink-0">{roleIcon(link.role)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-white truncate">{link.vendorName}</div>
                        {v && (
                          <div className="text-[9px] text-slate-500 flex gap-2 mt-0.5">
                            {v.contactPerson && <span>👤 {v.contactPerson}</span>}
                            {v.phone && <span>📞 {v.phone}</span>}
                            {v.leadDays ? <span>🕐 {v.leadDays}d</span> : null}
                          </div>
                        )}
                      </div>
                      <select
                        value={link.role}
                        onChange={(e) => changeRole(link.vendorId, e.target.value)}
                        className="text-[10px] font-bold rounded-lg px-2 py-1 outline-none border flex-shrink-0"
                        style={{ background: `${rc}14`, color: rc, borderColor: `${rc}40`, fontFamily: "'Inter',system-ui,sans-serif" }}>
                        <option value="Preferred">⭐ Preferred</option>
                        <option value="Approved">✅ Approved</option>
                        <option value="Backup">🔘 Backup</option>
                      </select>
                      <button onClick={() => removeVendorLink(link.vendorId)}
                              className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Row 5 — Last Purchase Rate */}
          <div>
            <Label text="Last Purchase Rate (₹ per unit)" />
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-bold pointer-events-none">₹</span>
              <input ref={rateRef} type="number" min="0" step="0.01" value={form.lastPurchaseRate}
                     onChange={(e) => set("lastPurchaseRate", e.target.value)}
                     onKeyDown={onEnter(null)}
                     placeholder="0.00"
                     className={inp(false)}
                     style={{ paddingLeft: "2rem", fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            {form.lastPurchaseRate && Number(form.stock) > 0 && !isNaN(Number(form.lastPurchaseRate)) && (
              <div className="text-[10px] text-slate-500 mt-1.5">
                Inventory value: <span className="text-green-400 font-bold">₹{(Number(form.stock) * Number(form.lastPurchaseRate)).toLocaleString("en-IN")}</span>
              </div>
            )}
          </div>

          {/* Row 6 — Optional media (photo + design). Files upload to Supabase
              Storage (bucket "item-media"); only the public URL is saved on the row. */}
          <div>
            <Label text="Item Media (optional)" />
            <div className="grid grid-cols-2 gap-3">
              {/* Photo */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                   style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                     style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {photo ? <img src={photo} alt="" className="w-full h-full object-cover" /> : <span className="text-xl">📷</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-slate-300 mb-1">Item Photo</div>
                  <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
                  <div className="flex gap-1.5">
                    <button onClick={() => photoInputRef.current?.click()} disabled={photoBusy}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/[0.1] text-slate-300 hover:border-white/20 transition-all disabled:opacity-50">
                      {photoBusy ? "Uploading…" : "Upload"}
                    </button>
                    {photo && !photoBusy && <button onClick={() => setPhoto("")}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">Remove</button>}
                  </div>
                  <div className="text-[9px] text-slate-600 mt-1">PNG/JPG, up to {MAX_MB} MB · stored in Supabase Storage</div>
                </div>
              </div>
              {/* Design / Drawing */}
              <div className="flex items-center gap-3 p-3 rounded-xl"
                   style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                     style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {designFile
                    ? (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(designFile) || designFile.startsWith("data:image/")
                        ? <img src={designFile} alt="" className="w-full h-full object-cover" />
                        : <span className="text-lg">📄</span>)
                    : <span className="text-xl">📐</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-slate-300 mb-1">Design / Drawing</div>
                  <input ref={designInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onPickDesign} />
                  <div className="flex gap-1.5">
                    <button onClick={() => designInputRef.current?.click()} disabled={designBusy}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/[0.1] text-slate-300 hover:border-white/20 transition-all disabled:opacity-50">
                      {designBusy ? "Uploading…" : "Upload"}
                    </button>
                    {designFile && !designBusy && <button onClick={() => { setDesignFile(""); setDesignName(""); }}
                            className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">Remove</button>}
                  </div>
                  {designName && <div className="text-[9px] text-slate-500 mt-1 truncate" title={designName}>📎 {designName}</div>}
                  <div className="text-[9px] text-slate-600 mt-0.5">PNG/JPG/PDF, up to {MAX_MB} MB · stored in Supabase Storage</div>
                </div>
              </div>
            </div>
            {mediaErr && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[11px] text-red-300 break-words"
                   style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
                ⚠️ {mediaErr}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-between flex-shrink-0"
             style={{ background: "rgba(0,0,0,0.35)" }}>
          <div className="text-[10px] text-slate-500">Fields marked <span className="text-red-400">*</span> are required</div>
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={handleSave}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all duration-200"
                    style={{
                      background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
                      borderColor: "rgba(99,130,255,0.5)",
                      boxShadow: "0 0 12px rgba(59,130,246,0.45), 0 2px 8px rgba(0,0,0,0.4)",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)";
                      e.currentTarget.style.boxShadow = "0 0 22px rgba(99,130,255,0.7), 0 0 6px rgba(59,130,246,0.4), 0 2px 8px rgba(0,0,0,0.4)";
                      e.currentTarget.style.borderColor = "rgba(139,160,255,0.7)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)";
                      e.currentTarget.style.boxShadow = "0 0 12px rgba(59,130,246,0.45), 0 2px 8px rgba(0,0,0,0.4)";
                      e.currentTarget.style.borderColor = "rgba(99,130,255,0.5)";
                    }}>
              {isEdit ? "💾 Save Changes" : "💾 Save Item"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── INVENTORY PAGE ───────────────────────────────────────────────────────────

function InventoryPage({ items, setItems, handleUpdateStock, pos = [], inwardLog = [], outwardLog = [], pendingLog = [], bomDefs = {}, machineLog = [], onLogAudit = () => {}, canDo = () => true, vendorList = [], onCreateItem, onUpdateItem, onDeleteItem }) {
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [catFilter,     setCatFilter]     = useState("all");
  const [sortCol,       setSortCol]       = useState("name");
  const [sortDir,       setSortDir]       = useState("asc");
  const [showModal,     setShowModal]     = useState(false);
  const [toast,         setToast]         = useState(null);
  const [lastAddedCode, setLastAddedCode] = useState(null);
  const [selectedItem,  setSelectedItem]  = useState(null);
  const [editingItem,   setEditingItem]   = useState(null);
  const [quickAdjust,   setQuickAdjust]   = useState(null);
  const [deleteModal,   setDeleteModal]   = useState(null); // { item, category, blocks }

  const machines = Object.keys(items);
  const allItemsRaw = Object.entries(items).flatMap(([cat, arr]) => arr.map((item) => ({ ...item, category: cat })));
  const allItems    = allItemsRaw.filter(i => !i.archived);

  const criticalCount = allItems.filter((i) => i.status === "critical").length;
  const warningCount  = allItems.filter((i) => i.status === "warning").length;
  const safeCount     = allItems.filter((i) => i.status === "safe").length;
  const totalSKUs     = allItems.length;

  // Compute all blocking reasons that prevent permanent deletion
  const computeBlocks = (item) => {
    const code   = item.code;
    const blocks = [];
    if (item.stock > 0)
      blocks.push({ reason: "Has stock in inventory", detail: `${item.stock} ${item.unit} currently held` });
    const txHistory = (item.history || []).filter(h => h.event !== "Opening");
    if (txHistory.length > 0)
      blocks.push({ reason: "Has purchase / movement history", detail: `${txHistory.length} transaction${txHistory.length !== 1 ? "s" : ""} on record` });
    const bomRefs = Object.entries(bomDefs).filter(([, def]) => (def.items || []).some(m => m.code === code));
    if (bomRefs.length > 0)
      blocks.push({ reason: "Referenced in BOM definitions", detail: `Used in: ${bomRefs.map(([k]) => k).join(", ")}` });
    const pendingRefs = pendingLog.filter(p => p.code === code);
    if (pendingRefs.length > 0)
      blocks.push({ reason: "Has pending material requests", detail: `${pendingRefs.length} open pending issue${pendingRefs.length !== 1 ? "s" : ""}` });
    const activePOs = pos.filter(p => !["rejected","received"].includes(p.status) && (p.lineItems || []).some(li => li.code === code));
    if (activePOs.length > 0)
      blocks.push({ reason: "Exists in active purchase orders", detail: `${activePOs.map(p => p.id).join(", ")}` });
    const inwardRefs  = inwardLog.filter(e => e.code === code);
    const outwardRefs = outwardLog.filter(e => (e.items || []).some(i => i.code === code));
    if (inwardRefs.length > 0 || outwardRefs.length > 0)
      blocks.push({ reason: "Has inventory transactions", detail: `${inwardRefs.length} inward, ${outwardRefs.length} outward` });
    return blocks;
  };

  const q = search.trim().toLowerCase();
  const filtered = allItems.filter((i) => {
    if (statusFilter !== "all" && i.status !== statusFilter) return false;
    if (catFilter !== "all" && i.category !== catFilter)    return false;
    if (q && !i.name.toLowerCase().includes(q) && !i.code.toLowerCase().includes(q) &&
             !(i.vendor   || "").toLowerCase().includes(q) &&
             !(i.location || "").toLowerCase().includes(q)) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    let av, bv;
    switch (sortCol) {
      case "code":     av = a.code;     bv = b.code;     break;
      case "category": av = a.category; bv = b.category; break;
      case "unit":     av = a.unit;     bv = b.unit;     break;
      case "stock":    av = a.stock;    bv = b.stock;    break;
      case "min":      av = a.min;      bv = b.min;      break;
      case "rate":     av = a.lastPurchaseRate || 0; bv = b.lastPurchaseRate || 0; break;
      case "status":   av = ["critical","warning","safe"].indexOf(a.status); bv = ["critical","warning","safe"].indexOf(b.status); break;
      case "vendor":   av = a.vendor || ""; bv = b.vendor || ""; break;
      default:         av = a.name;    bv = b.name;
    }
    if (typeof av === "number") return sortDir === "asc" ? av - bv : bv - av;
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  const alerts       = allItems.filter((i) => i.status !== "safe");
  const filteredVal  = sorted.reduce((s, i) => s + (i.stock * (i.lastPurchaseRate || 0)), 0);
  const filtersActive = search || statusFilter !== "all" || catFilter !== "all";
  const clearFilters  = () => { setSearch(""); setStatusFilter("all"); setCatFilter("all"); };

  const catColors = { Electrical: "#f97316", Mechanical: "#3b82f6", "R&D": "#a78bfa", Other: "#6b7280" };

  const SortIcon = ({ col }) =>
    sortCol !== col
      ? <span className="ml-0.5 text-slate-700 text-[9px]">⇅</span>
      : <span className="ml-0.5 text-blue-400 text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>;

  const handleAddItem = async (machine, newItem) => {
    if (onCreateItem) {
      const res = await onCreateItem(machine, newItem);
      if (!res?.success) { alert("Failed to create item: " + (res?.error || "unknown error")); return; }
    } else {
      // Legacy in-place fallback (only hit if InventoryPage rendered without onCreateItem)
      const itemWithHistory = { ...newItem, history: [{ date: fmtDate(new Date()), event: "Opening", change: 0, qty: newItem.stock }] };
      setItems((prev) => ({ ...prev, [machine]: [...(prev[machine] || []), itemWithHistory] }));
    }
    onLogAudit({
      type: "inventory_add", module: "Inventory",
      action: `Item Added: ${newItem.name} (${newItem.code})`,
      ref: newItem.code, itemCode: newItem.code, itemName: newItem.name,
      qty: newItem.stock || 0,
      newValue: { code: newItem.code, name: newItem.name, stock: newItem.stock, min: newItem.min, unit: newItem.unit, category: machine },
    });
    setShowModal(false);
    setLastAddedCode(newItem.code);
    setToast({ status: newItem.status, name: newItem.name, machine });
    setTimeout(() => { setToast(null); setLastAddedCode(null); }, 4000);
  };

  const handleDeleteRequest = (category, code) => {
    const item = items[category]?.find(i => i.code === code);
    if (!item) return;
    const blocks = computeBlocks(item);
    setDeleteModal({ item, category, blocks });
    setSelectedItem(null);
  };

  const handleConfirmDelete = async (category, code) => {
    const item = items[category]?.find(i => i.code === code);
    if (!item) return;
    if (onDeleteItem) {
      const res = await onDeleteItem(category, code);
      if (!res?.success) { alert("Failed to delete: " + (res?.error || "unknown error")); return; }
    } else {
      setItems(prev => ({ ...prev, [category]: prev[category].filter(i => i.code !== code) }));
    }
    onLogAudit({ type: "inventory_delete", module: "Inventory", action: `Item Deleted: ${item.name}`, ref: code, itemCode: code, details: { name: item.name, category } });
    setDeleteModal(null);
  };

  useEffect(() => {
    if (!selectedItem) return;
    const fresh = items[selectedItem.category]?.find((i) => i.code === selectedItem.item.code);
    if (fresh && fresh !== selectedItem.item) setSelectedItem({ item: fresh, category: selectedItem.category });
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveEdit = async (category, updatedItem) => {
    const origCode     = editingItem.item.code;
    const origCategory = editingItem.category;
    const existing     = items[origCategory]?.find((i) => i.code === origCode) || {};
    const merged       = { history: existing.history || [], trend: existing.trend || [], ...updatedItem };
    if (onUpdateItem) {
      const res = await onUpdateItem(origCode, origCategory, merged, category);
      if (!res?.success) { alert("Failed to update item: " + (res?.error || "unknown error")); return; }
    } else {
      setItems((prev) => {
        const next = { ...prev };
        next[origCategory] = prev[origCategory].filter((i) => i.code !== origCode);
        next[category]     = [...(next[category] || []), merged];
        return next;
      });
    }
    onLogAudit({
      type: "inventory_edit", module: "Inventory",
      action: `Item Updated: ${updatedItem.name} (${updatedItem.code})`,
      ref: updatedItem.code, itemCode: updatedItem.code, itemName: updatedItem.name,
      oldValue: { code: existing.code, name: existing.name, stock: existing.stock, min: existing.min, unit: existing.unit, category: origCategory },
      newValue: { code: updatedItem.code, name: updatedItem.name, stock: updatedItem.stock, min: updatedItem.min, unit: updatedItem.unit, category },
    });
    setEditingItem(null);
  };

  const cols = [
    { col: "code",     label: "Code"     },
    { col: "name",     label: "Item Name" },
    { col: "category", label: "Category" },
    { col: "unit",     label: "Unit"     },
    { col: "stock",    label: "Stock"    },
    { col: "min",      label: "Min"      },
    { col: "rate",     label: "Rate ₹"   },
    { col: "status",   label: "Status"   },
    { col: "vendor",   label: "Vendor"   },
    { col: "location", label: "Location" },
    { col: null,       label: "Actions"  },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      {showModal && <AddItemModal machines={machines} onSave={handleAddItem} onClose={() => setShowModal(false)} vendorList={vendorList} />}
      {selectedItem && (
        <ItemDetailModal
          item={selectedItem.item} category={selectedItem.category}
          onClose={() => setSelectedItem(null)}
          onDelete={canDo("inventory","delete") ? () => handleDeleteRequest(selectedItem.category, selectedItem.item.code) : undefined}
          onUpdateStock={canDo("inventory","adjust") ? (delta) => handleUpdateStock(selectedItem.category, selectedItem.item.code, delta) : undefined}
          onEdit={canDo("inventory","edit") ? () => { setEditingItem(selectedItem); setSelectedItem(null); } : undefined}
          vendorList={vendorList}
          outwardLog={outwardLog}
          bomDefs={bomDefs}
          machineLog={machineLog}
          inwardLog={inwardLog}
          pos={pos}
        />
      )}
      {editingItem && canDo("inventory","edit") && (
        <AddItemModal machines={machines} onSave={handleSaveEdit} onClose={() => setEditingItem(null)}
                      initialValues={{ ...editingItem.item, machine: editingItem.category }} vendorList={vendorList} />
      )}
      {quickAdjust && (
        <QuickStockModal item={quickAdjust.item} mode={quickAdjust.mode}
                         onConfirm={(delta) => handleUpdateStock(quickAdjust.category, quickAdjust.item.code, delta)}
                         onClose={() => setQuickAdjust(null)} />
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
             style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
             onClick={e => e.target === e.currentTarget && setDeleteModal(null)}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden"
               style={{ background: "#0d1018", border: "1px solid rgba(239,68,68,0.4)", boxShadow: "0 40px 80px rgba(0,0,0,0.9)", animation: "slideUp 0.25s ease both" }}>

            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.08]" style={{ background: "rgba(239,68,68,0.06)" }}>
              <div className="text-sm font-black text-red-400">🗑️ Delete Item</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{deleteModal.item.name} · {deleteModal.item.code}</div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {deleteModal.blocks.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-yellow-400 uppercase tracking-[0.06em] mb-2">⚠ Warning — this item has active data</div>
                  {deleteModal.blocks.map((b, i) => (
                    <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                         style={{ background: "rgba(234,179,8,0.05)", border: "1px solid rgba(234,179,8,0.15)" }}>
                      <span className="text-yellow-500 flex-shrink-0 text-xs mt-0.5">⚠</span>
                      <div>
                        <div className="text-[10px] font-bold text-yellow-300">{b.reason}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{b.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[11px] text-slate-400 leading-relaxed">
                Are you sure you want to permanently delete <span className="text-white font-semibold">{deleteModal.item.name}</span>? This action cannot be undone.
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/[0.08] flex gap-2" style={{ background: "rgba(0,0,0,0.35)" }}>
              <Btn variant="ghost" size="sm" onClick={() => setDeleteModal(null)}>Cancel</Btn>
              <div className="flex-1" />
              <button onClick={() => handleConfirmDelete(deleteModal.category, deleteModal.item.code)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all"
                      style={{ background: "linear-gradient(135deg,#dc2626,#b91c1c)", borderColor: "rgba(239,68,68,0.5)", boxShadow: "0 0 12px rgba(239,68,68,0.2)" }}>
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: `1px solid ${toast.status === "critical" ? "rgba(239,68,68,0.45)" : toast.status === "warning" ? "rgba(249,115,22,0.45)" : "rgba(34,197,94,0.45)"}`, boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">{toast.status === "critical" ? "🔴" : toast.status === "warning" ? "🟠" : "✅"}</span>
          <div>
            <div className="text-xs font-black text-white">{toast.name} added</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Category: {toast.machine}</div>
          </div>
          <StatusBadge status={toast.status} />
          <button onClick={() => setToast(null)} className="ml-1 w-5 h-5 rounded flex items-center justify-center text-slate-600 hover:text-slate-300 text-[10px]">✕</button>
        </div>
      )}

      <Topbar title="Item Master" subtitle="Unified inventory across all categories">
        <Btn variant="ghost" size="sm">⬇️ Export</Btn>
        {canDo("inventory","add") && <Btn variant="primary" size="sm" onClick={() => setShowModal(true)}>+ Add Item</Btn>}
      </Topbar>

      <div className="p-6 space-y-4">
        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total SKUs"    value={totalSKUs.toLocaleString("en-IN")} barPct={totalSKUs ? Math.round((safeCount / totalSKUs) * 100) : 0} barColor="#3b82f6" icon="📦" />
          <MetricCard label="Critical"      value={String(criticalCount)} valueColor="text-red-400" icon="🚨"
                      barPct={totalSKUs ? Math.round((criticalCount / totalSKUs) * 100) : 0} barColor="#ef4444" />
          <MetricCard label="Low Stock"     value={String(warningCount)}  valueColor="text-orange-400" icon="⚠️"
                      barPct={totalSKUs ? Math.round((warningCount / totalSKUs) * 100) : 0} barColor="#f97316" />
          <MetricCard label="Safe"          value={String(safeCount)} valueColor="text-green-400" icon="✅"
                      barPct={totalSKUs ? Math.round((safeCount / totalSKUs) * 100) : 0} barColor="#22c55e" />
        </div>

        {/* Alert strip */}
        {alerts.length > 0 && (
          <div className="px-4 py-3 rounded-xl flex items-center gap-3 flex-wrap"
               style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.18)" }}>
            <span className="text-[9px] font-black text-red-400 uppercase tracking-[0.08em] flex-shrink-0">⚠ Attention:</span>
            <div className="flex flex-wrap gap-1.5">
              {alerts.map((i) => (
                <button key={i.code}
                        onClick={() => setSelectedItem({ item: { ...i }, category: i.category })}
                        className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-lg transition-all hover:opacity-80"
                        style={{ background: i.status === "critical" ? "rgba(239,68,68,0.12)" : "rgba(249,115,22,0.1)", border: i.status === "critical" ? "1px solid rgba(239,68,68,0.28)" : "1px solid rgba(249,115,22,0.22)", color: i.status === "critical" ? "#f87171" : "#fb923c" }}>
                  {i.code} · {i.stock} {i.unit}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 bg-white/[0.03] rounded-lg p-0.5 border border-white/[0.06]">
            {[
              { key: "all",      label: `All (${totalSKUs})`,              active: "bg-blue-500/20 text-blue-400 border border-blue-500/30"    },
              { key: "critical", label: `Critical (${criticalCount})`,     active: "bg-red-500/20 text-red-400 border border-red-500/30"       },
              { key: "warning",  label: `Low (${warningCount})`,           active: "bg-orange-500/20 text-orange-400 border border-orange-500/30" },
              { key: "safe",     label: `Safe (${safeCount})`,             active: "bg-green-500/20 text-green-400 border border-green-500/30" },
            ].map(({ key, label, active }) => (
              <button key={key} onClick={() => setStatusFilter(key)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${statusFilter === key ? active : "text-slate-500 hover:text-slate-300"}`}>
                {label}
              </button>
            ))}
          </div>

          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
                  className="bg-white/[0.04] border border-white/[0.09] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none"
                  style={{ background: "#0c0f17" }}>
            <option value="all">All Categories</option>
            {machines.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <div className="relative ml-auto">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-[11px] pointer-events-none">🔍</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search code, name, vendor, location..."
                   className="bg-white/[0.04] border border-white/[0.09] rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500/40 w-72 transition-all" />
          </div>

          {filtersActive && (
            <button onClick={clearFilters}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-400 px-2.5 py-1.5 rounded-lg border border-white/[0.08] hover:border-red-500/30 transition-all">
              ✕ Clear
            </button>
          )}
        </div>

        {/* Master table */}
        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.07]" style={{ background: "rgba(255,255,255,0.025)" }}>
                  {cols.map(({ col, label }) => (
                    <th key={label}
                        onClick={col ? () => toggleSort(col) : undefined}
                        className={`text-left text-[10px] font-semibold text-slate-500 uppercase tracking-[0.06em] px-4 py-3 ${col ? "cursor-pointer hover:text-slate-300 select-none" : ""}`}>
                      {label}{col && <SortIcon col={col} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-xs text-slate-600">
                      No items match your filters.
                      {filtersActive && <button onClick={clearFilters} className="text-blue-400 font-bold ml-1 hover:underline">Clear filters</button>}
                    </td>
                  </tr>
                ) : sorted.map((item) => {
                  const cfg      = statusConfig[item.status];
                  const stockPct = item.min > 0 ? Math.min((item.stock / item.min) * 100, 100) : 0;
                  const barColor = item.status === "critical" ? "#ef4444" : item.status === "warning" ? "#f97316" : "#22c55e";
                  const catColor = catColors[item.category] || "#6b7280";
                  const isCrit   = item.status === "critical";
                  return (
                    <tr key={`${item.category}-${item.code}`}
                        onClick={() => setSelectedItem({ item: { ...item }, category: item.category })}
                        className={`border-b border-white/[0.08] cursor-pointer hover:bg-white/[0.05] transition-colors ${isCrit ? "bg-red-500/[0.025]" : ""} ${lastAddedCode === item.code ? "bg-blue-500/[0.08]" : ""}`}>
                      <td className="px-4 py-4 text-xs font-mono font-bold text-blue-400 whitespace-nowrap">{item.code}</td>
                      <td className="px-4 py-4 text-xs font-semibold text-white max-w-[160px]">
                        <div className="truncate">{item.name}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap"
                              style={{ background: `${catColor}14`, color: catColor, border: `1px solid ${catColor}28` }}>
                          {item.category}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-xs text-slate-400">{item.unit}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold font-mono tabular-nums ${cfg.text}`}>{item.stock}</span>
                          <div className="w-14 h-1 bg-white/[0.06] rounded-full overflow-hidden flex-shrink-0">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${stockPct}%`, background: barColor }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs font-mono tabular-nums text-slate-500">{item.min}</td>
                      <td className="px-4 py-4 text-xs font-mono tabular-nums text-slate-400">
                        {item.lastPurchaseRate ? `₹${Number(item.lastPurchaseRate).toLocaleString("en-IN")}` : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-4 text-[10px] text-slate-400 max-w-[120px]">
                        <div className="truncate">{item.vendor || <span className="text-slate-700">—</span>}</div>
                      </td>
                      <td className="px-4 py-4 text-[10px] text-slate-500 max-w-[100px]">
                        <div className="truncate">{item.location || <span className="text-slate-700">—</span>}</div>
                      </td>
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 items-center">
                          {canDo("inventory","adjust") && (
                            <button onClick={() => setQuickAdjust({ item: { ...item }, category: item.category, mode: "add" })}
                                    title="Add Stock"
                                    className="w-6 h-6 rounded flex items-center justify-center text-xs font-black text-green-400 hover:text-white transition-all"
                                    style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.22)" }}>＋</button>
                          )}
                          {canDo("inventory","adjust") && (
                            <button onClick={() => setQuickAdjust({ item: { ...item }, category: item.category, mode: "remove" })}
                                    title="Remove Stock"
                                    className="w-6 h-6 rounded flex items-center justify-center text-xs font-black text-orange-400 hover:text-white transition-all"
                                    style={{ background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.22)" }}>－</button>
                          )}
                          {canDo("inventory","edit") && (
                            <button onClick={() => setEditingItem({ item: { ...item }, category: item.category })}
                                    title="Edit"
                                    className="w-6 h-6 rounded flex items-center justify-center text-[11px] text-slate-500 hover:text-white transition-all"
                                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>✏</button>
                          )}
                          {item.status !== "safe" && (
                            <span className="text-[9px] font-black text-red-400 px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>🚨</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between"
               style={{ background: "rgba(255,255,255,0.01)" }}>
            <div className="text-[10px] text-slate-600">
              Showing <span className="text-slate-300 font-bold">{sorted.length}</span> of <span className="text-slate-300 font-bold">{totalSKUs}</span> items
            </div>
            <div className="text-[10px] text-slate-500 tabular-nums">
              Inventory Value:{" "}
              <span className="text-blue-400 font-bold">₹{filteredVal.toLocaleString("en-IN")}</span>
              {filtersActive && <span className="text-slate-700 ml-1">(filtered)</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PO MODAL ─────────────────────────────────────────────────────────────────

function POModal({ initialPO, vendorList, items, onSave, onClose, prefill = null, pos = [], settings = {} }) {
  const isEdit = Boolean(initialPO);
  const poCfg  = normalizePOSettings(settings);
  const [form, setForm] = useState(() => {
    if (isEdit) return {
      vendor: initialPO.vendor, priority: initialPO.priority,
      delivery: initialPO.delivery || "", notes: initialPO.notes || "",
      lineItems: initialPO.lineItems ? [...initialPO.lineItems] : [],
      companyId: initialPO.companyId || poCfg.activeCompanyId,
      template:  initialPO.template  || poCfg.template,
    };
    return {
      vendor:    prefill?.vendor || vendorList[0]?.name || "",
      priority:  prefill?.priority || "normal",
      delivery:  prefill?.delivery || "",
      notes:     prefill?.notes    || "",
      lineItems: prefill?.lineItems ? [...prefill.lineItems] : [],
      companyId: prefill?.companyId || poCfg.activeCompanyId,
      template:  prefill?.template  || poCfg.template,
    };
  });

  const [addCode,      setAddCode]      = useState("");
  const [addQty,       setAddQty]       = useState("");
  const [addRate,      setAddRate]      = useState("");
  const [addErr,       setAddErr]       = useState("");
  const [vendorErr,    setVendorErr]    = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");

  const allFlatItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((it) => ({ ...it, category: cat }))
  );
  const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Filter items by selected vendor — uses Item Master vendorLinks (new) or legacy vendor field.
  const selectedVendorObj = vendorList.find((v) => v.name === form.vendor);
  const vendorFilteredItems = !form.vendor
    ? allFlatItems
    : allFlatItems.filter((i) => {
        if (i.vendorLinks?.length) return i.vendorLinks.some((l) => l.vendorId === selectedVendorObj?.id);
        return i.vendor === form.vendor;
      });

  // When vendor changes, clear the picked item if it isn't linked to the new vendor.
  useEffect(() => {
    if (addCode && !vendorFilteredItems.some((i) => i.code === addCode)) {
      setAddCode("");
      setAddErr("");
    }
  }, [form.vendor]);

  // Vendors linked to the item currently selected in the add-line row — Preferred → Approved → Backup.
  // Supports both vendorLinks (new) and legacy item.vendor field.
  const addCodeItem = addCode ? allFlatItems.find((i) => i.code === addCode) : null;
  const itemLinkedVendors = (() => {
    if (!addCodeItem) return [];
    const roleOrder = { Preferred: 0, Approved: 1, Backup: 2 };
    return vendorList
      .map((v) => {
        let role = null;
        if (addCodeItem.vendorLinks?.length) {
          const lnk = addCodeItem.vendorLinks.find((l) => l.vendorId === v.id);
          if (lnk) role = lnk.role;
        } else if (addCodeItem.vendor && addCodeItem.vendor === v.name) {
          role = "Approved";
        }
        return role ? { ...v, itemLinkRole: role } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (roleOrder[a.itemLinkRole] ?? 3) - (roleOrder[b.itemLinkRole] ?? 3));
  })();

  // Clear vendor search when the add-line item changes.
  useEffect(() => { setVendorSearch(""); }, [addCode]);

  // Vendors linked to this specific item — sourced from prefill.vendorLinks (set by openCreatePO).
  // Only shown when creating a PO from a Low Stock card. Empty for manual PO creation.
  const linkedVendors = (() => {
    if (isEdit || !prefill?.lineItems?.length || !vendorList.length) return [];
    const pOrder = { Preferred: 0, Approved: 1, Backup: 2 };
    const links  = prefill.vendorLinks || [];
    if (!links.length) return [];
    const itemCode = prefill.lineItems[0]?.code;
    return links
      .map((link) => {
        const v = vendorList.find((x) => x.id === link.vendorId);
        if (!v) return null;
        // Pull last rate & date this vendor charged for this item from PO history
        let lastRate = prefill.lineItems[0]?.rate || 0;
        let lastDate = null;
        if (itemCode) {
          const prev = pos
            .filter((p) => p.vendor === v.name && (p.lineItems || []).some((li) => li.code === itemCode))
            .sort((a, b) => b.date.localeCompare(a.date))[0];
          if (prev) {
            const li = (prev.lineItems || []).find((l) => l.code === itemCode);
            if (li?.rate) lastRate = li.rate;
            lastDate = prev.date;
          }
        }
        return { ...v, lastRate, lastDate, linkRole: link.role };
      })
      .filter(Boolean)
      .sort((a, b) => (pOrder[a.linkRole] ?? 3) - (pOrder[b.linkRole] ?? 3));
  })();

  const selectVendor = (vendorName, lastRate) => {
    setVendorErr(false);
    const firstCode = prefill?.lineItems?.[0]?.code;
    setForm((f) => ({
      ...f,
      vendor: vendorName,
      lineItems: lastRate && firstCode
        ? f.lineItems.map((li) =>
            li.code === firstCode ? { ...li, rate: lastRate, amount: li.qty * lastRate } : li
          )
        : f.lineItems,
    }));
  };

  const addLine = () => {
    const inv  = allFlatItems.find((i) => i.code === addCode);
    const qty  = parseFloat(addQty);
    const rate = parseFloat(addRate);
    if (!inv)            { setAddErr("Select a valid item"); return; }
    if (!qty  || qty  <= 0) { setAddErr("Enter valid quantity"); return; }
    if (!rate || rate <= 0) { setAddErr("Enter valid rate (₹)"); return; }
    setAddErr("");
    setForm((f) => ({
      ...f,
      // Phase 3 — snapshot the design at add-time so the PO retains what was attached
      // even if the item's design is replaced later. attachDesign defaults to false.
      lineItems: [...f.lineItems, { code: inv.code, name: inv.name, category: inv.category, unit: inv.unit, qty, rate, amount: qty * rate,
                                    designFile: inv.designFile || "", designName: inv.designName || "", attachDesign: false }],
    }));
    setAddCode(""); setAddQty(""); setAddRate("");
  };

  const subtotal = form.lineItems.reduce((s, l) => s + l.amount, 0);
  const gst      = Math.round(subtotal * 0.18);
  const total    = subtotal + gst;

  const handleSave = (status) => {
    if (!form.vendor) { setVendorErr(true); return; }
    if (form.lineItems.length === 0) return;
    setVendorErr(false);
    onSave({ ...form, subtotal, gst, amount: total, status });
  };

  const inpCls = `bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "#0b0e17", color: "#f0f6ff" };
  const PLabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5" style={{ color: "#93c5fd" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.9)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
           style={{ maxHeight: "92vh", background: "linear-gradient(180deg,#0d1018,#090c14)", border: "1px solid rgba(59,130,246,0.32)", boxShadow: "0 40px 100px rgba(0,0,0,0.92),0 0 80px rgba(59,130,246,0.1)", animation: "slideUp 0.25s ease both" }}>
        <div className="px-6 py-5 border-b border-white/[0.08] flex items-center justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(59,130,246,0.11),rgba(99,102,241,0.06))" }}>
          <div>
            <div className="text-[15px] font-semibold text-white">{isEdit ? "Edit Purchase Order" : "Create Purchase Order"}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Select vendor · Add items · Review totals</div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">

            {/* Vendor Picker Cards — shown only when creating from Low Stock flow */}
            {linkedVendors.length > 0 && (
              <div className="col-span-2">
                <PLabel text="Select Vendor" req />
                {vendorErr && <div className="text-[11px] text-red-400 mb-1.5">Please select a vendor before saving.</div>}
                <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1">
                  {linkedVendors.map((v) => {
                    const isSelected = form.vendor === v.name;
                    const pColor = v.linkRole === "Preferred" ? "#fbbf24" : v.linkRole === "Approved" ? "#34d399" : v.linkRole === "Backup" ? "#94a3b8" : "#64748b";
                    const pIcon  = v.linkRole === "Preferred" ? "⭐" : v.linkRole === "Approved" ? "✅" : v.linkRole === "Backup" ? "🔘" : "🏭";
                    return (
                      <button key={v.id} onClick={() => selectVendor(v.name, v.lastRate)}
                              className="flex-shrink-0 text-left rounded-xl border transition-all duration-150"
                              style={{
                                minWidth: 148, padding: "10px 12px",
                                background: isSelected ? "rgba(59,130,246,0.10)" : "rgba(255,255,255,0.025)",
                                borderColor: isSelected ? "rgba(59,130,246,0.55)" : "rgba(255,255,255,0.08)",
                                boxShadow: isSelected ? "0 0 14px rgba(59,130,246,0.18)" : "none",
                              }}>
                        <div className="flex items-center gap-1 mb-1.5">
                          <span className="text-[10px]">{pIcon}</span>
                          {v.linkRole && (
                            <span className="text-[8px] font-black px-1 py-0.5 rounded-full"
                                  style={{ color: pColor, background: `${pColor}18`, border: `1px solid ${pColor}33` }}>
                              {v.linkRole}
                            </span>
                          )}
                          {isSelected && <span className="ml-auto text-[8px] font-black text-blue-400">✓ SELECTED</span>}
                        </div>
                        <div className="text-[11px] font-bold text-white truncate max-w-[130px] mb-1" title={v.name}>{v.name}</div>
                        {v.contactPerson && <div className="text-[9px] text-slate-500 mb-1">👤 {v.contactPerson}</div>}
                        <div className="text-[9px] text-slate-400 font-mono font-bold">
                          {v.lastRate ? `₹${v.lastRate.toLocaleString("en-IN")} / unit` : <span className="text-slate-600">No rate history</span>}
                        </div>
                        {v.lastDate && <div className="text-[9px] text-slate-600 mt-0.5">Last: {v.lastDate}</div>}
                        {v.leadDays ? <div className="text-[9px] text-slate-600">Lead: {v.leadDays}d</div> : null}
                      </button>
                    );
                  })}
                </div>
                {/* Fallback dropdown restricted to linked vendors only */}
                <div className="mt-2">
                  <div className="text-[10px] text-slate-600 mb-1">Or choose a different linked vendor:</div>
                  <select value={form.vendor} onChange={(e) => { setVendorErr(false); setF("vendor", e.target.value); }} className={`w-full ${inpCls}`} style={selStyle}>
                    <option value="">— Select Vendor —</option>
                    {linkedVendors.map((v) => (
                      <option key={v.id} value={v.name}>
                        {v.linkRole === "Preferred" ? "⭐ " : v.linkRole === "Approved" ? "✅ " : "🔘 "}{v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Standard vendor dropdown — only shown when no linked vendors (manual PO creation) */}
            {linkedVendors.length === 0 && (
              <div className="col-span-2">
                {/* Label row — shows item-filter badge when active */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-[11px] font-medium tracking-tight" style={{ color: "#93c5fd" }}>
                    Vendor<span className="text-red-400 ml-0.5">*</span>
                  </div>
                  {addCode && itemLinkedVendors.length > 0 && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.22)" }}>
                      {itemLinkedVendors.length} linked · {addCodeItem?.name}
                    </span>
                  )}
                </div>

                {vendorErr && <div className="text-[11px] text-red-400 mb-1.5">Please select a vendor before saving.</div>}

                {/* Search input — shown only when item filter is active */}
                {addCode && itemLinkedVendors.length > 0 && (
                  <input value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)}
                         placeholder="Search vendors…" className={`w-full mb-2 ${inpCls}`} />
                )}

                <select value={form.vendor} onChange={(e) => { setVendorErr(false); setF("vendor", e.target.value); }}
                        className={`w-full ${inpCls}`} style={selStyle}>
                  <option value="">— Select Vendor —</option>
                  {addCode && itemLinkedVendors.length > 0
                    ? (() => {
                        const q = vendorSearch.toLowerCase();
                        // Filtered linked vendors; always keep the currently-selected vendor in the list.
                        const matches = itemLinkedVendors.filter((v) => !q || v.name.toLowerCase().includes(q));
                        if (form.vendor && !matches.some((v) => v.name === form.vendor)) {
                          const cur = vendorList.find((v) => v.name === form.vendor);
                          if (cur) matches.push({ ...cur, itemLinkRole: null });
                        }
                        return matches.map((v) => {
                          const icon = v.itemLinkRole === "Preferred" ? "⭐" : v.itemLinkRole === "Approved" ? "✅" : v.itemLinkRole === "Backup" ? "🔘" : "🏭";
                          return (
                            <option key={v.id} value={v.name}>
                              {icon} {v.name}{v.itemLinkRole ? ` — ${v.itemLinkRole}` : ""}
                            </option>
                          );
                        });
                      })()
                    : [...vendorList]
                        .sort((a, b) => { const o = { Preferred: 0, Approved: 1, Backup: 2 }; return (o[a.priority] ?? 3) - (o[b.priority] ?? 3); })
                        .map((v) => (
                          <option key={v.id} value={v.name}>
                            {v.priority === "Preferred" ? "⭐ " : v.priority === "Approved" ? "✅ " : "🔘 "}{v.name}
                          </option>
                        ))
                  }
                </select>

                {addCode && itemLinkedVendors.length === 0 && (
                  <div className="mt-1 text-[10px] text-slate-500">No linked vendors for this item — showing all</div>
                )}
              </div>
            )}

            <div>
              <PLabel text="Issued By (Company)" />
              <select value={form.companyId} onChange={(e) => setF("companyId", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {poCfg.companies.map((c) => <option key={c.id} value={c.id}>{c.name || "(unnamed)"}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="PO Template" />
              <select value={form.template} onChange={(e) => setF("template", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {PO_TEMPLATE_OPTIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="Priority" />
              <select value={form.priority} onChange={(e) => setF("priority", e.target.value)} className={`w-full ${inpCls}`} style={selStyle}>
                {["urgent","high","normal","low"].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <PLabel text="Expected Delivery" />
              <input type="date" value={form.delivery} onChange={(e) => setF("delivery", e.target.value)}
                     className={`w-full ${inpCls}`} style={{ colorScheme: "dark", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            <div className="col-span-2">
              <PLabel text="Notes" />
              <input value={form.notes} onChange={(e) => setF("notes", e.target.value)}
                     placeholder="e.g. Urgent — machine M-07 down" className={`w-full ${inpCls}`} />
            </div>
          </div>

          {/* ── Phase 2 — Vendor low-stock picker (additive, strict Preferred-only) ──
              Visible whenever the selected vendor has ≥1 preferred low-stock item that
              isn't already on the PO. Re-filters live as the vendor dropdown changes.
              "Order Now" / "+ New PO" flows that don't match still see nothing here. */}
          {(() => {
            if (!selectedVendorObj) return null;
            const inLine = new Set((form.lineItems || []).map((li) => li.code));
            const lowItems = allFlatItems.filter((i) =>
              (i.status === "critical" || i.status === "warning") &&
              ((i.vendorLinks || []).find((l) => l.role === "Preferred")?.vendorId === selectedVendorObj.id) &&
              !inLine.has(i.code)
            );
            if (lowItems.length === 0) return null;
            const addLowStockItem = (it) => {
              const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
              const qty  = Math.max(shortage, Math.max(1, it.min || 1));
              const rate = it.lastPurchaseRate || 0;
              setForm((f) => ({
                ...f,
                lineItems: [...(f.lineItems || []), { code: it.code, name: it.name, category: it.category, unit: it.unit, qty, rate, amount: qty * rate,
                                                      designFile: it.designFile || "", designName: it.designName || "", attachDesign: false }],
              }));
            };
            const addAllLowStockItems = () => {
              const lines = lowItems.map((it) => {
                const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
                const qty  = Math.max(shortage, Math.max(1, it.min || 1));
                const rate = it.lastPurchaseRate || 0;
                return { code: it.code, name: it.name, category: it.category, unit: it.unit, qty, rate, amount: qty * rate,
                         designFile: it.designFile || "", designName: it.designName || "", attachDesign: false };
              });
              setForm((f) => ({ ...f, lineItems: [...(f.lineItems || []), ...lines] }));
            };
            return (
              <div className="mb-3 p-3 rounded-xl"
                   style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[11px] font-bold text-emerald-300">📦 Low Stock for {form.vendor}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{lowItems.length} preferred low-stock item{lowItems.length !== 1 ? "s" : ""} · tap to add to PO</div>
                  </div>
                  <button onClick={addAllLowStockItems}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-lg text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-all">
                    + Add All ({lowItems.length})
                  </button>
                </div>
                <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                  {lowItems.map((it) => {
                    const shortage = Math.max(0, (it.min || 0) - (it.stock || 0));
                    return (
                      <button key={it.code} onClick={() => addLowStockItem(it)}
                              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all"
                              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                        <span className="text-[10px]" style={{ color: it.status === "critical" ? "#f87171" : "#fbbf24" }}>{it.status === "critical" ? "🔴" : "🟠"}</span>
                        <span className="text-[11px] font-bold text-white truncate flex-1">{it.name}</span>
                        <span className="text-[9px] font-mono text-slate-600 flex-shrink-0">{it.code}</span>
                        <span className="text-[9px] text-slate-500 flex-shrink-0">stock {it.stock}/{it.min} {it.unit}</span>
                        {shortage > 0 && <span className="text-[9px] font-bold text-orange-300 flex-shrink-0">need {shortage}+</span>}
                        <span className="text-[10px] font-bold text-emerald-300 flex-shrink-0">+ Add</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div>
            <PLabel text="Line Items" req />
            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <ItemSearchSelect
                  items={vendorFilteredItems}
                  value={addCode}
                  onChange={setAddCode}
                  disabled={!form.vendor}
                  disabledMsg={!form.vendor ? "Select vendor first" : ""}
                  placeholder={vendorFilteredItems.length === 0 ? "No items linked to this vendor" : "Search items by name or code…"}
                  showStock={true}
                />
              </div>
              <input type="number" min="1" value={addQty} onChange={(e) => setAddQty(e.target.value)}
                     placeholder="Qty" className={`w-20 text-right ${inpCls}`}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
              <input type="number" min="0" value={addRate} onChange={(e) => setAddRate(e.target.value)}
                     placeholder="Rate ₹" className={`w-24 text-right ${inpCls}`}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }}
                     onKeyDown={(e) => e.key === "Enter" && addLine()} />
              <button onClick={addLine}
                      className="px-3 py-2 rounded-xl text-xs font-bold text-white"
                      style={{ background: "linear-gradient(135deg,#2563eb,#4f46e5)", border: "1px solid rgba(99,130,255,0.5)", boxShadow: "0 0 10px rgba(59,130,246,0.3)" }}>
                + Add
              </button>
            </div>
            {addErr && <div className="text-[10px] text-red-400 mb-2">⚠ {addErr}</div>}

            {form.lineItems.length > 0 ? (
              <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                      {["Item","Qty","Rate ₹","Amount ₹","📎 Design",""].map((h) => (
                        <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.lineItems.map((li, idx) => (
                      <tr key={idx} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold text-white">{li.name}</div>
                          <div className="text-[9px] text-slate-500 font-mono">{li.code} · {li.unit}</div>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-300 text-right">{li.qty}</td>
                        <td className="px-3 py-2 text-xs font-mono text-slate-300 text-right">{li.rate.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-xs font-bold font-mono text-green-400 text-right">₹{li.amount.toLocaleString("en-IN")}</td>
                        {/* Phase 3 — per-line "Attach Design" checkbox. Enabled only when the
                            item has a design file; disabled+tooltip otherwise. Unchecked = no
                            extra PDF page produced for this line, preserving today's PDF. */}
                        <td className="px-3 py-2">
                          {li.designFile ? (
                            <button
                              onClick={() => setForm((f) => ({ ...f, lineItems: f.lineItems.map((x, i) => i === idx ? { ...x, attachDesign: !x.attachDesign } : x) }))}
                              title={li.attachDesign ? `Will attach: ${li.designName || "design"}` : `Click to attach ${li.designName || "design"} as an extra PDF page`}
                              className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-md transition-all"
                              style={{
                                background:  li.attachDesign ? "rgba(139,92,246,0.18)" : "rgba(255,255,255,0.04)",
                                color:       li.attachDesign ? "#c4b5fd" : "#94a3b8",
                                border:      `1px solid ${li.attachDesign ? "rgba(139,92,246,0.45)" : "rgba(255,255,255,0.08)"}`,
                              }}>
                              <span className="w-3 h-3 rounded-sm flex items-center justify-center"
                                    style={{ background: li.attachDesign ? "#8b5cf6" : "transparent", border: `1.5px solid ${li.attachDesign ? "#8b5cf6" : "rgba(255,255,255,0.25)"}` }}>
                                {li.attachDesign && <span className="text-white text-[8px] font-black">✓</span>}
                              </span>
                              {li.attachDesign ? "Attach" : "Attach"}
                            </button>
                          ) : (
                            <span title="No design uploaded for this item — add one in Inventory → Edit Item → Item Media"
                                  className="inline-flex items-center gap-1.5 text-[10px] text-slate-700 cursor-not-allowed">
                              <span className="w-3 h-3 rounded-sm" style={{ border: "1.5px solid rgba(255,255,255,0.10)" }} />
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
                                  className="w-5 h-5 rounded text-xs text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all flex items-center justify-center">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/[0.08] py-8 text-center text-xs text-slate-600">
                No items added. Select item + qty + rate then click Add.
              </div>
            )}
          </div>

          {form.lineItems.length > 0 && (
            <div className="p-4 rounded-xl space-y-2" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">Subtotal</span>
                <span className="font-mono font-bold text-white">₹{subtotal.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400">GST (18%)</span>
                <span className="font-mono font-bold text-orange-400">₹{gst.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between text-sm border-t border-white/[0.06] pt-2">
                <span className="font-bold text-white">Total</span>
                <span className="font-mono font-black text-green-400">₹{total.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-between gap-2 flex-shrink-0"
             style={{ background: "rgba(0,0,0,0.35)" }}>
          <div className="text-[10px] text-slate-500">{form.lineItems.length} item{form.lineItems.length !== 1 ? "s" : ""} · ₹{total.toLocaleString("en-IN")}</div>
          <div className="flex gap-2">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={() => handleSave("draft")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-slate-300 border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] transition-all">
              💾 Save Draft
            </button>
            <button onClick={() => handleSave("pending")}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                    style={{ background: "linear-gradient(135deg,#2563eb,#4f46e5)", borderColor: "rgba(99,130,255,0.5)", boxShadow: "0 0 12px rgba(59,130,246,0.45)" }}>
              📤 Submit for Approval
            </button>
          </div>
        </div>
      </div>
    </div>
  );

}

// ─── PO DETAIL MODAL ──────────────────────────────────────────────────────────

function PODetailModal({ po, onClose, onApprove, onMarkOrdered, onMarkReceived, onEdit, onDelete }) {
  const [confirmReceive, setConfirmReceive] = useState(false);
  const [confirmDelete,  setConfirmDelete]  = useState(false);

  const steps = ["Draft","Pending","Approved","Ordered","Received"];
  const stepMap = { draft: 0, pending: 1, approved: 2, ordered: 3, received: 4, overdue: 2, review: 1 };
  const cur = stepMap[po.status] ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.9)", backdropFilter: "blur(16px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg flex flex-col rounded-2xl overflow-hidden"
           style={{ maxHeight: "90vh", background: "linear-gradient(180deg,#0d1018,#090c14)", border: "1px solid rgba(59,130,246,0.32)", boxShadow: "0 40px 100px rgba(0,0,0,0.92)", animation: "slideUp 0.25s ease both" }}>

        <div className="px-6 py-5 border-b border-white/[0.08] flex items-start justify-between flex-shrink-0"
             style={{ background: "linear-gradient(90deg,rgba(59,130,246,0.1),rgba(99,102,241,0.05))" }}>
          <div>
            <div className="text-[15px] font-semibold text-white">{po.id}</div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 truncate max-w-[180px]">{po.vendor}</span>
              <span className="text-slate-600">·</span>
              <StatusBadge status={po.status} />
              <span className="text-slate-600">·</span>
              <span className={`text-[10px] font-bold uppercase ${po.priority === "urgent" ? "text-red-400" : po.priority === "high" ? "text-orange-400" : "text-slate-500"}`}>{po.priority}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold flex-shrink-0">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Progress bar */}
          <div className="flex items-start gap-0 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black border transition-all ${
                    i < cur ? "bg-blue-500 border-blue-500 text-white" :
                    i === cur ? "bg-blue-500/20 border-blue-500/60 text-blue-400" :
                    "bg-white/[0.04] border-white/[0.1] text-slate-600 opacity-40"
                  }`}>{i < cur ? "✓" : i + 1}</div>
                  <div className={`text-[8px] mt-1 font-bold ${i === cur ? "text-blue-400" : i < cur ? "text-slate-400" : "text-slate-700"}`}>{s}</div>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px mx-1 mb-4 ${i < cur ? "bg-blue-500" : "bg-white/[0.06]"}`} />
                )}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Date",     value: po.date },
              { label: "Delivery", value: po.delivery || "—" },
              { label: "Total",    value: `₹${po.amount.toLocaleString("en-IN")}`, mono: true },
              { label: "Items",    value: `${po.lineItems?.length || 0} line item${po.lineItems?.length !== 1 ? "s" : ""}` },
            ].map(({ label, value, mono }) => (
              <div key={label} className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">{label}</div>
                <div className={`text-xs font-semibold text-[#f0f6ff] ${mono ? "font-mono" : ""}`}>{value}</div>
              </div>
            ))}
          </div>

          {po.notes && (
            <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Notes</div>
              <div className="text-xs text-slate-400">{po.notes}</div>
            </div>
          )}

          {po.lineItems?.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">Line Items</div>
              <div className="rounded-xl overflow-hidden border border-white/[0.06]">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
                      {["Item","Qty","Rate","Amount"].map((h) => (
                        <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {po.lineItems.map((li, i) => (
                      <tr key={i} className="border-b border-white/[0.04] last:border-0">
                        <td className="px-3 py-2">
                          <div className="text-[11px] font-semibold text-white">{li.name}</div>
                          <div className="text-[9px] text-slate-500 font-mono">{li.code}</div>
                        </td>
                        <td className="px-3 py-2 text-[11px] font-mono text-slate-300">{li.qty} {li.unit}</td>
                        <td className="px-3 py-2 text-[11px] font-mono text-slate-400">₹{li.rate.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2 text-[11px] font-bold font-mono text-green-400">₹{li.amount.toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 px-3 flex justify-between text-[10px]">
                <span className="text-slate-500">GST (18%): ₹{(po.gst || 0).toLocaleString("en-IN")}</span>
                <span className="font-bold text-green-400">Total: ₹{po.amount.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}

          {po.status === "received" && po.receivedDate && (
            <div className="px-3.5 py-3 rounded-xl" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="text-[9px] font-black text-green-400 uppercase tracking-[0.06em] mb-1">✅ Received</div>
              <div className="text-xs text-slate-400">Stock updated on {po.receivedDate}. GRN recorded.</div>
            </div>
          )}

          {confirmReceive && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.35)" }}>
              <div className="text-xs font-bold text-green-400 mb-1">📦 Confirm GRN — Mark as Received?</div>
              <div className="text-[10px] text-slate-500 mb-3">All line item quantities will be added to inventory stock automatically.</div>
              <div className="flex gap-2">
                <button onClick={onMarkReceived} className="px-4 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: "rgba(34,197,94,0.8)", border: "1px solid rgba(34,197,94,0.5)" }}>✅ Confirm Received</button>
                <button onClick={() => setConfirmReceive(false)} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.08] transition-all">Cancel</button>
              </div>
            </div>
          )}

          {confirmDelete && (
            <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <div className="text-xs font-bold text-red-400 mb-1">Delete this PO?</div>
              <div className="text-[10px] text-slate-500 mb-3">This cannot be undone.</div>
              <div className="flex gap-2">
                <button onClick={onDelete} className="px-4 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: "rgba(239,68,68,0.8)", border: "1px solid rgba(239,68,68,0.5)" }}>Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-4 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.08] transition-all">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center gap-2 flex-wrap flex-shrink-0"
             style={{ background: "rgba(0,0,0,0.35)" }}>
          {["draft","pending","review"].includes(po.status) && (
            <Btn variant="ghost" size="sm" onClick={onEdit}>✏️ Edit</Btn>
          )}
          {["draft","pending"].includes(po.status) && (
            <Btn variant="red" size="sm" onClick={() => { setConfirmDelete(true); setConfirmReceive(false); }}>🗑️ Delete</Btn>
          )}
          <div className="flex-1" />
          {["pending","review"].includes(po.status) && (
            <Btn variant="green" size="sm" onClick={onApprove}>✅ Approve</Btn>
          )}
          {po.status === "approved" && (
            <Btn variant="primary" size="sm" onClick={onMarkOrdered}>📦 Mark Ordered</Btn>
          )}
          {["approved","ordered"].includes(po.status) && (
            <button onClick={() => { setConfirmReceive(true); setConfirmDelete(false); }}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                    style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", borderColor: "rgba(34,197,94,0.5)", boxShadow: "0 0 10px rgba(34,197,94,0.3)" }}>
              ✅ Mark Received
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PURCHASE ORDERS PAGE (legacy — kept for reference, not mounted) ──────────

function PurchasePage({ pos, vendorList, items, onCreatePO, onUpdatePO, onReceivePO, onDeletePO }) {
  const [search,    setSearch]    = useState("");
  const [filter,    setFilter]    = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [detailPO,  setDetailPO]  = useState(null);
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, sub) => {
    setToast({ msg, sub });
    setTimeout(() => setToast(null), 3500);
  };

  const filtered = pos.filter((po) => {
    const q = search.toLowerCase();
    const matchSearch = po.id.toLowerCase().includes(q) || po.vendor.toLowerCase().includes(q);
    const matchFilter = filter === "all" || po.status === filter;
    return matchSearch && matchFilter;
  });

  const totalAmt  = pos.filter((p) => !["received"].includes(p.status)).reduce((s, p) => s + p.amount, 0);
  const overdueN  = pos.filter((p) => p.status === "overdue").length;
  const receivedN = pos.filter((p) => p.status === "received").length;
  const pendingN  = pos.filter((p) => ["pending","review","draft"].includes(p.status)).length;

  const priorityChip = (p) => {
    const cfg = { urgent: "bg-red-500/10 text-red-400", high: "bg-orange-500/10 text-orange-400", normal: "bg-white/[0.05] text-slate-500", low: "bg-white/[0.03] text-slate-600" };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${cfg[p] || cfg.normal}`}>{p}</span>;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(59,130,246,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">🧾</span>
          <div>
            <div className="text-xs font-black text-white">{toast.msg}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      {showModal && (
        <POModal
          initialPO={editingPO}
          vendorList={vendorList}
          items={items}
          pos={pos}
          onSave={(data) => {
            if (editingPO) {
              onUpdatePO(editingPO.id, data);
              showToast("PO Updated", `${editingPO.id} — ${data.status}`);
            } else {
              onCreatePO(data);
              showToast("PO Created", `${data.vendor} · ₹${data.amount.toLocaleString("en-IN")}`);
            }
            setShowModal(false); setEditingPO(null);
          }}
          onClose={() => { setShowModal(false); setEditingPO(null); }}
        />
      )}

      {detailPO && (
        <PODetailModal
          po={detailPO}
          onClose={() => setDetailPO(null)}
          onApprove={() => { onUpdatePO(detailPO.id, { status: "approved" }); showToast("PO Approved", detailPO.id); setDetailPO(null); }}
          onMarkOrdered={() => { onUpdatePO(detailPO.id, { status: "ordered" }); showToast("Marked Ordered", detailPO.id); setDetailPO(null); }}
          onMarkReceived={() => {
            onReceivePO(detailPO.id);
            showToast("📦 GRN Recorded", `${detailPO.id} — stock updated`);
            setDetailPO(null);
          }}
          onEdit={() => { setEditingPO(detailPO); setDetailPO(null); setShowModal(true); }}
          onDelete={() => { onDeletePO(detailPO.id); showToast("PO Deleted", detailPO.id); setDetailPO(null); }}
        />
      )}

      <Topbar title="Purchase Orders" subtitle="Full PO register & tracking">
        <Btn variant="wa" size="sm">📱 WA Reminder</Btn>
        <Btn variant="primary" size="sm" onClick={() => { setEditingPO(null); setShowModal(true); }}>+ Create PO</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total POs"  value={String(pos.length)} barPct={100} barColor="#3b82f6" />
          <MetricCard label="Open Value" value={`₹${(totalAmt / 100000).toFixed(1)}L`} valueColor="text-orange-400"
                      barPct={pos.length ? Math.round((pendingN / pos.length) * 100) : 0} barColor="#f97316" />
          <MetricCard label="Received"   value={String(receivedN)} valueColor="text-green-400"
                      barPct={pos.length ? Math.round((receivedN / pos.length) * 100) : 0} barColor="#22c55e" />
          <MetricCard label="Overdue"    value={String(overdueN)}  valueColor="text-red-400"
                      barPct={pos.length ? Math.round((overdueN / pos.length) * 100) : 0} barColor="#ef4444" />
        </div>

        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-white/[0.07] flex flex-wrap items-center gap-3">
            <div className="text-sm font-bold text-white">Purchase Order Register</div>
            <div className="flex gap-1 flex-wrap ml-2">
              {["all","draft","pending","approved","ordered","received","overdue"].map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-all ${
                    filter === f ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-slate-600 hover:text-slate-400"
                  }`}>{f}</button>
              ))}
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search PO / vendor..."
              className="ml-auto bg-white/[0.04] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-600 outline-none focus:border-blue-500/40 w-52" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.07]" style={{ background: "rgba(255,255,255,0.02)" }}>
                  {["PO No.","Date","Vendor","Items","Amount","Priority","Status","Delivery","Actions"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-xs text-slate-600">No purchase orders found.</td>
                  </tr>
                )}
                {filtered.map((po) => (
                  <tr key={po.id}
                      onClick={() => setDetailPO(po)}
                      className={`border-b border-white/[0.04] hover:bg-white/[0.035] transition-colors cursor-pointer ${po.status === "overdue" ? "bg-red-500/[0.02]" : ""}`}>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-md">{po.id}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">{po.date}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-white max-w-[140px]">
                      <div className="truncate">{po.vendor}</div>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 tabular-nums">{po.lineItems?.length || 0}</td>
                    <td className="px-4 py-3 text-xs font-bold font-mono text-green-400 tabular-nums whitespace-nowrap">₹{po.amount.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3">{priorityChip(po.priority)}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-3 text-[11px] font-mono text-slate-500 whitespace-nowrap">{po.delivery || "—"}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Btn variant="ghost" size="xs" onClick={() => setDetailPO(po)}>📄 View</Btn>
                        {["pending","review"].includes(po.status) && (
                          <Btn variant="green" size="xs" onClick={() => { onUpdatePO(po.id, { status: "approved" }); showToast("PO Approved", po.id); }}>✅</Btn>
                        )}
                        {["approved","ordered"].includes(po.status) && (
                          <Btn variant="green" size="xs" onClick={() => { onReceivePO(po.id); showToast("📦 GRN Recorded", `${po.id} — stock updated`); }}>📦</Btn>
                        )}
                        {po.status === "overdue" && <Btn variant="orange" size="xs">⚡</Btn>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VENDOR IMPORT MODAL ──────────────────────────────────────────────────────

function VendorImportModal({ vendorList, onImport, onClose }) {
  const fileRef = useRef(null);
  const [rows,      setRows]      = useState(null);
  const [fileName,  setFileName]  = useState("");
  const [error,     setError]     = useState("");

  const FIELD_MAP = [
    { key: "name",          aliases: ["vendor name","company name","name","vendor","supplier name","supplier"] },
    { key: "contactPerson", aliases: ["contact person","contact","person","contact name","representative"] },
    { key: "phone",         aliases: ["mobile","phone","mobile number","phone number","contact number","whatsapp","mobile no","phone no"] },
    { key: "email",         aliases: ["email","email address","mail","e-mail","email id"] },
    { key: "gst",           aliases: ["gst","gst number","gstin","gst no","gst#","gst id"] },
    { key: "address",       aliases: ["address","full address","billing address","street address","full_address"] },
    { key: "location",      aliases: ["location","city","state","city/state","city, state","place"] },
    { key: "category",      aliases: ["category","category / specialty","specialty","type","vendor type","supplier type","item type"] },
  ];

  const mapRow = (raw) => {
    const out = {};
    for (const { key, aliases } of FIELD_MAP) {
      const found = Object.keys(raw).find((k) => aliases.includes(k.trim().toLowerCase()));
      out[key] = found !== undefined ? String(raw[found] || "").trim() : "";
    }
    return out;
  };

  const parseFile = async (file) => {
    setError(""); setRows(null); setFileName(file.name);
    try {
      const data  = await file.arrayBuffer();
      const wb    = XLSX.read(data, { type: "array" });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const raw   = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!raw.length) { setError("The file appears to be empty."); return; }

      const existingNames = new Set(vendorList.map((v) => v.name.trim().toLowerCase()));

      const parsed = raw
        .map((r) => {
          const mapped = mapRow(r);
          const allBlank = Object.values(mapped).every((v) => !v);
          if (allBlank) return null;
          if (!mapped.name) return { ...mapped, _status: "skip" };
          if (existingNames.has(mapped.name.toLowerCase())) return { ...mapped, _status: "dup" };
          return { ...mapped, _status: "ready" };
        })
        .filter(Boolean)
        .filter((r) => r._status !== "skip");

      setRows(parsed);
    } catch {
      setError("Could not read the file. Make sure it is a valid CSV or Excel (.xlsx) file.");
    }
  };

  const readyCount = (rows || []).filter((r) => r._status === "ready").length;
  const dupCount   = (rows || []).filter((r) => r._status === "dup").length;

  const handleImport = () => {
    const toImport = (rows || []).filter((r) => r._status === "ready");
    const newVendors = toImport.map((r, i) => ({
      id:            `V${Date.now().toString(36)}${i.toString(36)}`,
      name:          r.name,
      contactPerson: r.contactPerson,
      phone:         r.phone,
      email:         r.email,
      gst:           r.gst,
      address:       r.address,
      location:      r.location,
      category:      r.category,
      paymentTerms:  "30 days",
      status:        "active",
      priority:      "Approved",
      leadDays:      0,
      performance:   0,
      notes:         "",
      rating:        4.0,
      years:         1,
      annualValue:   "₹0",
      poCount:       0,
    }));
    onImport(newVendors, readyCount, dupCount);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.88)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
           style={{ background: "linear-gradient(180deg,#0d1018,#090c14)", border: "1px solid rgba(59,130,246,0.35)", boxShadow: "0 32px 80px rgba(0,0,0,0.92)", animation: "slideUp 0.2s ease both" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-black text-white">Import Vendors</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Upload a CSV or Excel file exported from Google Sheets</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {/* Column guide */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <div>
              <div className="text-[11px] font-semibold text-blue-300 mb-1.5">Supported columns — use these exact header names in your sheet</div>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "Vendor Name",   req: true,  hint: "Required" },
                  { label: "Mobile Number", req: false, hint: "Optional" },
                  { label: "GST Number",    req: false, hint: "Optional" },
                  { label: "Address",       req: false, hint: "Optional" },
                  { label: "Contact Person",req: false, hint: "Optional" },
                  { label: "Email",         req: false, hint: "Optional" },
                  { label: "Location",      req: false, hint: "Optional" },
                  { label: "Category",      req: false, hint: "Optional" },
                ].map(({ label, req, hint }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-semibold"
                          style={{ color: req ? "#93c5fd" : "#64748b" }}>{label}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                          style={{ background: req ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.04)",
                                   color: req ? "#93c5fd" : "#475569",
                                   border: req ? "1px solid rgba(59,130,246,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>
                      {hint}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              Only <span className="text-blue-300 font-semibold">Vendor Name</span> is required. All other columns are optional — missing fields can be filled in later by editing the vendor.
            </div>
          </div>

          {/* Drop zone */}
          <div onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
               onDragOver={(e) => e.preventDefault()}
               onClick={() => fileRef.current?.click()}
               className="rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center py-10 transition-all"
               style={{ borderColor: "rgba(255,255,255,0.1)" }}
               onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)"}
               onMouseLeave={(e) => e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"}>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                   onChange={(e) => { const f = e.target.files[0]; if (f) parseFile(f); e.target.value = ""; }} />
            <div className="text-4xl mb-3">{fileName ? "📄" : "📂"}</div>
            <div className="text-sm font-semibold text-white mb-1">{fileName || "Click or drag file here"}</div>
            <div className="text-[11px] text-slate-500">Supports .csv and .xlsx (Excel) — exported from Google Sheets</div>
          </div>

          {error && (
            <div className="text-[11px] text-red-400 px-4 py-3 rounded-xl"
                 style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>{error}</div>
          )}

          {/* Preview table */}
          {rows && rows.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-sm">No valid vendor rows found in this file.</div>
          )}
          {rows && rows.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold text-slate-300">{rows.length} row{rows.length !== 1 ? "s" : ""} detected</div>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="font-bold text-green-400">{readyCount} ready to import</span>
                  {dupCount > 0 && <span className="text-yellow-400">{dupCount} duplicate{dupCount !== 1 ? "s" : ""} — will be skipped</span>}
                </div>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                        {["Status","Vendor Name","Contact Person","Mobile","Email","GST"].map((h) => (
                          <th key={h} className="text-left text-[10px] font-semibold text-slate-500 px-3 py-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)", opacity: r._status === "dup" ? 0.45 : 1 }}>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {r._status === "ready"
                              ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-green-400" style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" }}>✓ Ready</span>
                              : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-yellow-400" style={{ background: "rgba(234,179,8,0.1)", border: "1px solid rgba(234,179,8,0.25)" }}>↩ Duplicate</span>}
                          </td>
                          <td className="px-3 py-2.5 text-[11px] font-semibold text-white whitespace-nowrap">{r.name}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{r.contactPerson || <span className="text-slate-700">—</span>}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{r.phone || <span className="text-slate-700">—</span>}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-400 max-w-[160px] truncate">{r.email || <span className="text-slate-700">—</span>}</td>
                          <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{r.gst || <span className="text-slate-700">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-[10px] text-slate-600">
            {rows ? `${readyCount} vendor${readyCount !== 1 ? "s" : ""} will be added to Vendor Master` : "Upload a file to preview and import"}
          </div>
          <div className="flex items-center gap-3">
            <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <button onClick={handleImport} disabled={!rows || readyCount === 0}
                    className="text-xs font-black px-5 py-2 rounded-xl text-white transition-opacity"
                    style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", boxShadow: "0 0 20px rgba(37,99,235,0.4)",
                             opacity: (!rows || readyCount === 0) ? 0.4 : 1,
                             cursor: (!rows || readyCount === 0) ? "not-allowed" : "pointer" }}>
              Import {readyCount > 0 ? `${readyCount} Vendor${readyCount !== 1 ? "s" : ""}` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── VENDOR MODAL ─────────────────────────────────────────────────────────────

function VendorModal({ initialVendor, onSave, onClose }) {
  const isEdit = Boolean(initialVendor);
  const [form, setForm] = useState(isEdit ? { ...initialVendor } : {
    name: "", contactPerson: "", phone: "", email: "", gst: "", location: "", category: "",
    paymentTerms: "30 days", status: "active", priority: "Approved", leadDays: "", performance: "",
    address: "", notes: "", rating: 4.0, years: 1, annualValue: "₹0", poCount: 0,
  });
  const [errors, setErrors] = useState({});

  const upd = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    const e = {};
    if (!form.name.trim())  e.name  = "Required";
    setErrors(e);
    if (Object.keys(e).length) return;
    const id = initialVendor?.id || `V${String(Date.now()).slice(-4)}`;
    onSave({ ...form, id, leadDays: Number(form.leadDays) || 0, performance: Number(form.performance) || 0 });
    onClose();
  };

  const ILabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#93c5fd" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );
  const inpCls = (err) =>
    `w-full bg-white/[0.04] border ${err ? "border-red-500/60" : "border-white/[0.08]"} rounded-xl px-4 py-2.5 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "#0b0e17", color: "#f0f6ff" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(4,6,12,0.88)", backdropFilter: "blur(14px)" }}
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
           style={{ background: "linear-gradient(180deg,#0d1018,#090c14)", border: "1px solid rgba(59,130,246,0.35)", boxShadow: "0 32px 80px rgba(0,0,0,0.92), 0 0 60px rgba(59,130,246,0.08)", animation: "slideUp 0.2s ease both" }}>

        <div className="px-6 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-sm font-black text-white">{isEdit ? "Edit Vendor" : "Add New Vendor"}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Supplier details &amp; terms</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
        </div>

        <div className="p-6 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <ILabel text="Vendor / Company Name" req />
              <input value={form.name} onChange={upd("name")} placeholder="e.g. Bharat Lubricants Pvt Ltd" className={inpCls(errors.name)} />
              {errors.name && <div className="text-[10px] text-red-400 mt-1">{errors.name}</div>}
            </div>
            <div>
              <ILabel text="Contact Person" />
              <input value={form.contactPerson} onChange={upd("contactPerson")} placeholder="e.g. Ramesh Patel" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Vendor Priority" />
              <select value={form.priority} onChange={upd("priority")} className={inpCls(false)} style={selStyle}>
                <option value="Preferred">⭐ Preferred</option>
                <option value="Approved">✅ Approved</option>
                <option value="Backup">🔘 Backup</option>
              </select>
            </div>
            <div>
              <ILabel text="Phone" req />
              <input value={form.phone} onChange={upd("phone")} placeholder="+91 98765 43210" className={inpCls(errors.phone)} />
              {errors.phone && <div className="text-[10px] text-red-400 mt-1">{errors.phone}</div>}
            </div>
            <div>
              <ILabel text="Email" />
              <input value={form.email} onChange={upd("email")} placeholder="orders@vendor.com" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="GST Number" />
              <input value={form.gst} onChange={upd("gst")} placeholder="24AABCB1234L1ZN" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Location" />
              <input value={form.location} onChange={upd("location")} placeholder="City, State" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Category / Specialty" />
              <input value={form.category} onChange={upd("category")} placeholder="Oils & Lubricants" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="Payment Terms" />
              <select value={form.paymentTerms} onChange={upd("paymentTerms")} className={inpCls(false)} style={selStyle}>
                {["Immediate","7 days","15 days","30 days","45 days","60 days"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <ILabel text="Status" />
              <select value={form.status} onChange={upd("status")} className={inpCls(false)} style={selStyle}>
                <option value="preferred">Preferred</option>
                <option value="active">Active</option>
                <option value="review">Under Review</option>
                <option value="poor">Poor</option>
              </select>
            </div>
            <div>
              <ILabel text="Lead Days" />
              <input type="number" min="0" value={form.leadDays} onChange={upd("leadDays")} placeholder="3" className={inpCls(false)} />
            </div>
            <div>
              <ILabel text="On-time Delivery %" />
              <input type="number" min="0" max="100" value={form.performance} onChange={upd("performance")} placeholder="90" className={inpCls(false)} />
            </div>
            <div className="col-span-2">
              <ILabel text="Address" />
              <input value={form.address} onChange={upd("address")} placeholder="Full address" className={inpCls(false)} />
            </div>
            <div className="col-span-2">
              <ILabel text="Notes" />
              <textarea rows={2} value={form.notes} onChange={upd("notes")} placeholder="Internal notes about this vendor..."
                        className={`${inpCls(false)} resize-none`} style={{ minHeight: 56 }} />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-white/[0.07] flex items-center justify-end gap-3 flex-shrink-0">
          <Btn variant="ghost" size="sm" onClick={onClose}>Cancel</Btn>
          <button onClick={handleSave}
                  className="text-xs font-black px-5 py-2 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", boxShadow: "0 0 20px rgba(37,99,235,0.4)" }}>
            {isEdit ? "Save Changes" : "Add Vendor"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── VENDORS PAGE ─────────────────────────────────────────────────────────────

function VendorsPage({ vendorList, pos, items, onAddVendor, onEditVendor, onDeleteVendor, onBulkAddVendors, canDo = () => true }) {
  const [search,        setSearch]        = useState("");
  const [showModal,     setShowModal]     = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [editingVendor, setEditingVendor] = useState(null);
  const [profileVendor, setProfileVendor] = useState(null);
  const [toast,         setToast]         = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  const allFlatItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((item) => ({ ...item, category: cat }))
  );

  const vendorPOCounts = pos.reduce((acc, p) => {
    acc[p.vendor] = (acc[p.vendor] || 0) + 1;
    return acc;
  }, {});

  const filtered = vendorList.filter((v) => {
    const q = search.toLowerCase();
    return (v.name     || "").toLowerCase().includes(q)
        || (v.category || "").toLowerCase().includes(q)
        || (v.location || "").toLowerCase().includes(q);
  });

  const perfColor = (p) => p > 85 ? "#22c55e" : p > 65 ? "#3b82f6" : p > 50 ? "#f97316" : "#ef4444";

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(59,130,246,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">🏭</span>
          <div className="text-xs font-black text-white">{toast}</div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      {showModal && (
        <VendorModal
          initialVendor={editingVendor}
          onSave={(data) => {
            if (editingVendor) { onEditVendor(data); showToast(`${data.name} updated`); }
            else               { onAddVendor(data);  showToast(`${data.name} added`);   }
            setShowModal(false); setEditingVendor(null);
          }}
          onClose={() => { setShowModal(false); setEditingVendor(null); }}
        />
      )}

      {showImport && (
        <VendorImportModal
          vendorList={vendorList}
          onImport={(newVendors, readyCount, dupCount) => {
            onBulkAddVendors(newVendors);
            setShowImport(false);
            const msg = dupCount > 0
              ? `${readyCount} vendor${readyCount !== 1 ? "s" : ""} imported · ${dupCount} duplicate${dupCount !== 1 ? "s" : ""} skipped`
              : `${readyCount} vendor${readyCount !== 1 ? "s" : ""} imported successfully`;
            showToast(msg);
          }}
          onClose={() => setShowImport(false)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(4,6,12,0.88)", backdropFilter: "blur(14px)" }}>
          <div className="w-80 rounded-2xl p-6" style={{ background: "#0d1018", border: "1px solid rgba(239,68,68,0.35)" }}>
            <div className="text-sm font-black text-white mb-2">Delete Vendor?</div>
            <div className="text-[11px] text-slate-400 mb-5">
              Remove <span className="text-white font-bold">{confirmDelete.name}</span> from the vendor list? This cannot be undone.
            </div>
            <div className="flex gap-3 justify-end">
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
              <Btn variant="red" size="sm" onClick={() => {
                onDeleteVendor(confirmDelete.id);
                showToast(`${confirmDelete.name} removed`);
                setConfirmDelete(null);
                if (profileVendor?.id === confirmDelete.id) setProfileVendor(null);
              }}>Delete</Btn>
            </div>
          </div>
        </div>
      )}

      <Topbar title="Vendor Management" subtitle={`${vendorList.length} suppliers · ${vendorList.filter((v) => v.status === "preferred").length} preferred`}>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Search vendors..." className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none w-44" />
        {canDo("vendors","add") && (
          <button onClick={() => setShowImport(true)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-white/[0.1] text-slate-300 hover:text-white hover:border-white/[0.25] transition-all flex items-center gap-1.5">
            ⬆ Import
          </button>
        )}
        {canDo("vendors","add") && <Btn variant="primary" size="sm" onClick={() => { setEditingVendor(null); setShowModal(true); }}>+ Add Vendor</Btn>}
      </Topbar>

      <div className="p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total Vendors"  value={vendorList.length.toString()} icon="🏭" barPct={100} barColor="#3b82f6" />
          <MetricCard label="Preferred"      value={vendorList.filter((v) => v.status === "preferred").length.toString()} icon="⭐" barPct={vendorList.length ? Math.round((vendorList.filter((v) => v.status === "preferred").length / vendorList.length) * 100) : 0} barColor="#22c55e" valueColor="text-green-400" />
          <MetricCard label="Under Review"   value={vendorList.filter((v) => v.status === "review").length.toString()} icon="🔍" barPct={vendorList.length ? Math.round((vendorList.filter((v) => v.status === "review").length / vendorList.length) * 100) : 0} barColor="#f97316" valueColor="text-orange-400" />
          <MetricCard label="Poor"           value={vendorList.filter((v) => v.status === "poor").length.toString()} icon="⚠️" barPct={vendorList.length ? Math.round((vendorList.filter((v) => v.status === "poor").length / vendorList.length) * 100) : 0} barColor="#ef4444" valueColor="text-red-400" />
        </div>

        <div className={`grid gap-4 ${profileVendor ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1"}`}>
          {/* Cards grid */}
          <div className={`${profileVendor ? "xl:col-span-2" : ""} grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 content-start`}>
            {filtered.map((v) => (
              <div key={v.id}
                   className={`bg-[#0e1117] border rounded-xl p-4 cursor-pointer card-hover ${profileVendor?.id === v.id ? "border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.07)]" : "border-white/[0.07]"}`}
                   onClick={() => setProfileVendor(profileVendor?.id === v.id ? null : v)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="text-[13px] font-black text-white truncate leading-tight">{v.name}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">📍 {v.location} · {v.years} yr{v.years !== 1 ? "s" : ""}</div>
                    {v.contactPerson && <div className="text-[10px] text-slate-500 mt-0.5">👤 {v.contactPerson}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={v.status} />
                    {v.priority && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full border"
                            style={{
                              color: v.priority === "Preferred" ? "#fbbf24" : v.priority === "Approved" ? "#34d399" : "#94a3b8",
                              background: v.priority === "Preferred" ? "rgba(251,191,36,0.08)" : v.priority === "Approved" ? "rgba(52,211,153,0.08)" : "rgba(148,163,184,0.08)",
                              borderColor: v.priority === "Preferred" ? "rgba(251,191,36,0.3)" : v.priority === "Approved" ? "rgba(52,211,153,0.3)" : "rgba(148,163,184,0.25)",
                            }}>
                        {v.priority === "Preferred" ? "⭐ Preferred" : v.priority === "Approved" ? "✅ Approved" : "🔘 Backup"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-0.5 mb-3">
                  {[1,2,3,4,5].map((s) => (
                    <span key={s} className={`text-sm ${s <= Math.round(v.rating) ? "text-amber-400" : "text-slate-700"}`}>★</span>
                  ))}
                  <span className="text-[10px] text-slate-500 ml-1.5 font-semibold">{v.rating}</span>
                </div>

                <div className="mb-3.5">
                  <div className="flex justify-between text-[10px] mb-1.5">
                    <span className="text-slate-500">On-time delivery</span>
                    <span className="font-bold tabular-nums" style={{ color: perfColor(v.performance) }}>{v.performance}%</span>
                  </div>
                  <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${v.performance}%`, background: perfColor(v.performance) }} />
                  </div>
                </div>

                <div className="flex flex-wrap gap-1 mb-3.5">
                  {[v.category, `Lead: ${v.leadDays}d`, v.annualValue, `${vendorPOCounts[v.name] || 0} POs`].map((tag) => (
                    <span key={tag} className="text-[9px] font-semibold text-slate-500 bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full">{tag}</span>
                  ))}
                </div>

                <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <Btn variant="wa"    size="xs" onClick={() => { const r = openVendorWhatsApp(v); if (!r.ok) showToast(waErrorToast(r.error)); }}>📱 WA</Btn>
                  <Btn variant="mail"  size="xs">✉️</Btn>
                  {canDo("vendors","edit")   && <Btn variant="ghost" size="xs" onClick={() => { setEditingVendor(v); setShowModal(true); }}>✏️</Btn>}
                  {canDo("vendors","delete") && <Btn variant="red"   size="xs" onClick={() => setConfirmDelete(v)}>🗑</Btn>}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-3 py-16 text-center text-slate-600 text-sm">No vendors match your search.</div>
            )}
          </div>

          {/* Vendor History panel */}
          {profileVendor && (() => {
            const v = profileVendor;

            // Items linked via vendorLinks (new) or legacy vendor field
            const linkedItems = allFlatItems.filter((i) => {
              if (i.vendorLinks?.length) return i.vendorLinks.some((l) => l.vendorId === v.id);
              return i.vendor === v.name;
            });

            // All POs for this vendor
            const vendorPOs     = pos.filter((p) => p.vendor === v.name);
            const totalValue    = vendorPOs.reduce((s, p) => s + (p.amount || 0), 0);
            const pendingPOs    = vendorPOs.filter((p) => ["pending","approved","ordered"].includes(p.status));
            const receivedPOs   = vendorPOs.filter((p) => p.status === "received");
            const sortedByDate  = [...vendorPOs].sort((a, b) => b.date.localeCompare(a.date));
            const lastPoDate    = [...receivedPOs].sort((a, b) => b.date.localeCompare(a.date))[0]?.date || null;

            // Per-item last rate from PO line items
            const itemRates = linkedItems.map((item) => {
              const hit = sortedByDate.find((p) => (p.lineItems || []).some((li) => li.code === item.code));
              const li  = hit ? (hit.lineItems || []).find((l) => l.code === item.code) : null;
              return {
                ...item,
                lastRate:   li?.rate || item.lastPurchaseRate || 0,
                lastPODate: hit?.date || null,
                linkRole:   (item.vendorLinks || []).find((l) => l.vendorId === v.id)?.role || null,
              };
            });

            const recentPOs  = sortedByDate.slice(0, 8);
            const roleColor  = (r) => r === "Preferred" ? "#fbbf24" : r === "Approved" ? "#34d399" : r === "Backup" ? "#94a3b8" : "#64748b";

            return (
              <div className="bg-[#0e1117] border border-blue-500/20 rounded-xl p-5 space-y-5 self-start sticky top-4 overflow-y-auto max-h-[calc(100vh-120px)]">

                {/* Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-black text-white">{v.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">{v.category}</div>
                  </div>
                  <button onClick={() => setProfileVendor(null)} className="text-slate-600 hover:text-slate-300 text-sm leading-none">✕</button>
                </div>

                {/* Summary stats */}
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">Purchase History</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Total POs",    vendorPOs.length,                                            "#3b82f6"],
                      ["Total Value",  `₹${totalValue.toLocaleString("en-IN")}`,                    "#22c55e"],
                      ["Pending",      pendingPOs.length,                                           "#f97316"],
                      ["Received",     receivedPOs.length,                                          "#8b5cf6"],
                    ].map(([lbl, val, col]) => (
                      <div key={lbl} className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-3">
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide mb-1">{lbl}</div>
                        <div className="text-[13px] font-black tabular-nums leading-tight" style={{ color: col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                  {lastPoDate && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Last received: <span className="text-white font-semibold">{lastPoDate}</span>
                    </div>
                  )}
                </div>

                {/* Contact */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em]">Contact</div>
                  {v.contactPerson && <div className="text-[11px] text-slate-300">👤 {v.contactPerson}</div>}
                  <div className="text-[11px] text-slate-300">📞 {v.phone}</div>
                  <div className="text-[11px] text-slate-300">✉️ {v.email}</div>
                  {v.gst     && <div className="text-[11px] text-slate-400">GST: <span className="font-mono text-slate-300">{v.gst}</span></div>}
                  {v.address && <div className="text-[11px] text-slate-400">📍 {v.address}</div>}
                </div>

                {/* Terms */}
                <div className="grid grid-cols-2 gap-3">
                  {[["Payment", v.paymentTerms], ["Lead Time", `${v.leadDays} days`]].map(([lbl, val]) => (
                    <div key={lbl} className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-3">
                      <div className="text-[9px] text-slate-600 uppercase tracking-wide mb-1">{lbl}</div>
                      <div className="text-xs font-bold text-white">{val}</div>
                    </div>
                  ))}
                </div>

                {/* Linked items with last rate */}
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                    Linked Items ({linkedItems.length})
                  </div>
                  {itemRates.length === 0 ? (
                    <div className="text-[11px] text-slate-600">No items linked.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {itemRates.map((item) => (
                        <div key={item.code} className="p-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-semibold text-white truncate">{item.name}</div>
                              <div className="text-[10px] text-slate-500">{item.code} · {item.category}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <StatusBadge status={item.status} />
                              {item.linkRole && (
                                <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full border"
                                      style={{ color: roleColor(item.linkRole), background: `${roleColor(item.linkRole)}18`, borderColor: `${roleColor(item.linkRole)}33` }}>
                                  {item.linkRole}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-mono font-bold text-slate-300">
                              {item.lastRate ? `₹${item.lastRate.toLocaleString("en-IN")} / ${item.unit}` : <span className="text-slate-600 font-normal">No rate history</span>}
                            </div>
                            {item.lastPODate && <div className="text-[9px] text-slate-600">Last: {item.lastPODate}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pending orders */}
                {pendingPOs.length > 0 && (
                  <div>
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                      Pending Orders ({pendingPOs.length})
                    </div>
                    <div className="space-y-1.5">
                      {pendingPOs.slice(0, 5).map((po) => (
                        <div key={po.id} className="flex items-center justify-between p-2 rounded-lg bg-orange-500/[0.05] border border-orange-500/20">
                          <div>
                            <div className="text-[11px] font-mono font-bold text-blue-400">{po.id}</div>
                            <div className="text-[10px] text-slate-500">
                              {po.date} · ₹{(po.amount || 0).toLocaleString("en-IN")}
                            </div>
                            {(po.lineItems || []).length > 0 && (
                              <div className="text-[9px] text-slate-600 mt-0.5 truncate max-w-[160px]">
                                {(po.lineItems || []).map((li) => li.name || li.code).join(", ")}
                              </div>
                            )}
                          </div>
                          <StatusBadge status={po.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full PO history */}
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">
                    PO History ({vendorPOs.length} total)
                  </div>
                  {recentPOs.length === 0 ? (
                    <div className="text-[11px] text-slate-600">No purchase orders yet.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {recentPOs.map((po) => (
                        <div key={po.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                          <div>
                            <div className="text-[11px] font-mono font-bold text-blue-400">{po.id}</div>
                            <div className="text-[10px] text-slate-500">
                              {po.date} · ₹{(po.amount || 0).toLocaleString("en-IN")}
                            </div>
                            {(po.lineItems || []).length > 0 && (
                              <div className="text-[9px] text-slate-600 mt-0.5 truncate max-w-[160px]">
                                {(po.lineItems || []).map((li) => li.name || li.code).join(", ")}
                              </div>
                            )}
                          </div>
                          <StatusBadge status={po.status} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes */}
                {v.notes && (
                  <div className="p-3 rounded-lg bg-orange-500/[0.06] border border-orange-500/20">
                    <div className="text-[9px] font-black text-orange-400 uppercase tracking-wide mb-1">Notes</div>
                    <div className="text-[11px] text-slate-300">{v.notes}</div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ─── APPROVALS PAGE ───────────────────────────────────────────────────────────

function ApprovalsPage({ pos, onUpdatePO }) {
  const pendingItems  = pos.filter((p) => ["pending", "review", "draft"].includes(p.status));
  const approvedItems = pos.filter((p) => p.status === "approved");
  const displayList   = [...pendingItems, ...approvedItems.slice(0, 5)];

  const handleApprove    = (id) => onUpdatePO(id, { status: "approved" });
  const handleReject     = (id) => onUpdatePO(id, { status: "rejected" });
  const handleApproveAll = ()   => pendingItems.forEach((p) => onUpdatePO(p.id, { status: "approved" }));

  const approvalRules = [
    { rule: "Auto-Approve", trigger: "Amount < ₹5,000",  approver: "System",           limit: "₹5,000"     },
    { rule: "L1 Approval",  trigger: "₹5K – ₹25K",       approver: "Purchase Manager", limit: "₹25,000"    },
    { rule: "L2 Approval",  trigger: "₹25K – ₹1L",       approver: "GM Operations",    limit: "₹1,00,000"  },
    { rule: "L3 Approval",  trigger: "Above ₹1L",         approver: "Director",         limit: "Unlimited"  },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Approval Workflow" subtitle={`${pendingItems.length} pending your action`}>
        {pendingItems.length > 0 && <Btn variant="green" size="sm" onClick={handleApproveAll}>✅ Approve All</Btn>}
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Awaiting Approval" value={pendingItems.length.toString()}  valueColor="text-orange-400" />
          <MetricCard label="Approved POs"       value={approvedItems.length.toString()} valueColor="text-green-400" />
          <MetricCard label="Total POs"          value={pos.length.toString()}           valueColor="text-blue-400" />
        </div>

        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
          <SectionHeader>📋 Pending Approvals</SectionHeader>
          {displayList.length === 0 ? (
            <div className="py-14 text-center">
              <div className="text-4xl mb-3">✅</div>
              <div className="text-sm font-bold text-white mb-1">All caught up!</div>
              <div className="text-[11px] text-slate-500">No POs awaiting approval.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {displayList.map((po) => {
                const isPending = ["pending", "review", "draft"].includes(po.status);
                return (
                  <div key={po.id} className={`flex flex-wrap items-center gap-3 p-4 rounded-xl border transition-all ${
                    !isPending
                      ? "bg-green-500/[0.05] border-green-500/20 opacity-60"
                      : po.status === "review"
                      ? "bg-orange-500/[0.04] border-orange-500/20"
                      : "bg-white/[0.02] border-white/[0.06]"
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">{po.id}</span>
                        <span className="text-xs font-bold text-white truncate">{po.vendor}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {po.lineItems?.length || 0} line items · Due: {po.delivery || "—"} ·
                        <span className="text-orange-400 font-bold"> ₹{(po.amount || po.subtotal || 0).toLocaleString("en-IN")}</span>
                        {po.priority && (
                          <span className={`ml-1 font-bold ${po.priority === "urgent" ? "text-red-400" : po.priority === "high" ? "text-orange-400" : "text-slate-500"}`}>
                            {" "}· {po.priority.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={po.status} />
                    {isPending && (
                      <>
                        <Btn variant="green" size="xs" onClick={() => handleApprove(po.id)}>✅ Approve</Btn>
                        <Btn variant="red"   size="xs" onClick={() => handleReject(po.id)}>❌ Reject</Btn>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
          <SectionHeader>⚙️ Approval Rules</SectionHeader>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {["Rule", "Trigger", "Approver", "Limit", "Status"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {approvalRules.map((r, i) => (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-xs font-bold text-white">{r.rule}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{r.trigger}</td>
                    <td className="px-4 py-3 text-xs text-blue-400 font-semibold">{r.approver}</td>
                    <td className="px-4 py-3 text-xs font-mono text-green-400">{r.limit}</td>
                    <td className="px-4 py-3"><StatusBadge status="safe" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ANALYTICS PAGE ───────────────────────────────────────────────────────────

function AnalyticsPage({ items, pos, vendorList, settings = SETTINGS_DEFAULTS }) {
  const allItems   = Object.values(items).flat();
  const totalItems = allItems.length;

  // Live stock distribution
  const critCount = allItems.filter((i) => i.status === "critical").length;
  const warnCount = allItems.filter((i) => i.status === "warning").length;
  const safeCount = allItems.filter((i) => i.status === "safe").length;
  const stockDist = [
    { name: "Safe",     value: safeCount, color: "#22c55e" },
    { name: "Warning",  value: warnCount, color: "#f97316" },
    { name: "Critical", value: critCount, color: "#ef4444" },
  ];

  // Live PO spend metrics
  const totalSpend = pos.reduce((s, p) => s + (p.amount || p.subtotal || 0), 0);
  const avgPOValue = pos.length > 0 ? Math.round(totalSpend / pos.length) : 0;
  const totalInvValue = allItems.reduce((s, i) => s + i.stock * (i.lastPurchaseRate || 0), 0);

  // Monthly PO trend — group by month name
  const monthOrder = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyMap = {};
  pos.forEach((p) => {
    const parts = (p.date || "").split(" ");
    const month = parts[1] || "?";
    if (!monthlyMap[month]) monthlyMap[month] = { month, value: 0, orders: 0 };
    monthlyMap[month].value  += Math.round((p.amount || p.subtotal || 0) / 1000);
    monthlyMap[month].orders += 1;
  });
  const monthlyPOTrend = Object.values(monthlyMap)
    .sort((a, b) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month));

  // Spend by category from PO line items
  const catSpend = {};
  pos.forEach((p) => (p.lineItems || []).forEach((li) => {
    const cat = li.category || "Other";
    catSpend[cat] = (catSpend[cat] || 0) + (li.amount || 0);
  }));
  const catSpendTotal = Object.values(catSpend).reduce((s, v) => s + v, 0) || 1;
  const catColors = { Electrical: "#f97316", Mechanical: "#3b82f6", "R&D": "#a78bfa", Other: "#6b7280" };
  const spendByCat = Object.entries(catSpend)
    .map(([name, val]) => ({ name, value: Math.round((val / catSpendTotal) * 100), color: catColors[name] || "#6b7280" }))
    .sort((a, b) => b.value - a.value);

  // Vendor PO counts from live pos
  const vendorCounts = {};
  pos.forEach((p) => { vendorCounts[p.vendor] = (vendorCounts[p.vendor] || 0) + 1; });
  const vendorPOData = Object.entries(vendorCounts)
    .map(([name, count]) => ({ name: name.split(" ")[0], count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const curr   = getCurrSymbol(settings.currency);
  const fmtVal = (v) => {
    if (v >= 10000000) return `${curr}${(v / 10000000).toFixed(1)}Cr`;
    if (v >= 100000)   return `${curr}${(v / 100000).toFixed(1)}L`;
    if (v >= 1000)     return `${curr}${(v / 1000).toFixed(0)}K`;
    return `${curr}${v.toLocaleString("en-IN")}`;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Analytics & Reports" subtitle={`${pos.length} POs · ${totalItems} SKUs tracked`}>
        <Btn variant="ghost" size="sm">📅 All time</Btn>
        <Btn variant="mail" size="sm">✉️ Email Report</Btn>
        <Btn variant="ghost" size="sm">⬇️ Download PDF</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total PO Spend"  value={fmtVal(totalSpend)}   delta="Live from POs"   deltaUp />
          <MetricCard label="Avg PO Value"    value={fmtVal(avgPOValue)}   delta={`${pos.length} POs`} deltaUp />
          <MetricCard label="Inventory Value" value={fmtVal(totalInvValue)} delta="Live stock × rate" deltaUp />
          <MetricCard label="Active SKUs"     value={totalItems.toString()} delta={critCount > 0 ? `${critCount} critical` : "All healthy"} deltaUp={critCount === 0} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>📊 PO Value by Month (₹K)</SectionHeader>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyPOTrend.length > 0 ? monthlyPOTrend : monthlyPOData} barSize={28}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 11 }} />
                <YAxis tick={{ fill: "#475569", fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="PO Value (₹K)" fill="#3b82f620" stroke="#3b82f6" strokeWidth={1.5} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>📈 Inventory Turnover Rate</SectionHeader>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={turnoverData}>
                <defs>
                  <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="month" tick={{ fill: "#475569", fontSize: 11 }} />
                <YAxis tick={{ fill: "#475569", fontSize: 11 }} domain={[3.5, 7]} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="rate" name="Turnover" stroke="#a78bfa" fill="url(#tGrad)" strokeWidth={2} dot={{ fill: "#a78bfa", r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>🥧 Spend by Category</SectionHeader>
            {spendByCat.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={spendByCat} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                      {spendByCat.map((entry, i) => <Cell key={i} fill={entry.color + "80"} stroke={entry.color} strokeWidth={1.5} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 justify-center mt-2">
                  {spendByCat.map((d) => (
                    <div key={d.name} className="flex items-center gap-1 text-[10px] text-slate-400">
                      <div className="w-2 h-2 rounded-sm" style={{ background: d.color }} />
                      {d.name} <span className="font-bold text-white">{d.value}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-slate-600 text-xs">No PO line item data yet</div>
            )}
          </div>

          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>🏭 Vendor-wise PO Count</SectionHeader>
            {vendorPOData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={vendorPOData} layout="vertical" barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                  <XAxis type="number" tick={{ fill: "#475569", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#475569", fontSize: 10 }} width={55} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" name="PO Count" fill="#22c55e20" stroke="#22c55e" strokeWidth={1.5} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-slate-600 text-xs">No PO data yet</div>
            )}
          </div>

          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>📉 Stock Status</SectionHeader>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={stockDist} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" stroke="none">
                  {stockDist.map((entry, i) => <Cell key={i} fill={entry.color + "60"} stroke={entry.color} strokeWidth={2} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-3">
              {stockDist.map((d) => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                  <span className="text-slate-400 flex-1">{d.name}</span>
                  <span className="font-bold font-mono text-white">{d.value}</span>
                  <span className="text-slate-600 text-[10px]">{totalItems > 0 ? ((d.value / totalItems) * 100).toFixed(1) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI ASSISTANT PAGE ────────────────────────────────────────────────────────

function AIPage({ items, pos }) {
  const allItems   = Object.values(items).flat();
  const critItems  = allItems.filter((i) => i.status === "critical");
  const warnItems  = allItems.filter((i) => i.status === "warning");
  const pendingPOs = pos.filter((p) => ["pending", "review"].includes(p.status));

  const initialGreeting = (() => {
    const lines = ["👋 Hello! I've analyzed your live inventory.\n"];
    if (critItems.length > 0) lines.push(`🔴 **${critItems.length} critical item${critItems.length !== 1 ? "s" : ""}** need immediate reorder`);
    if (warnItems.length > 0) lines.push(`🟠 **${warnItems.length} warning item${warnItems.length !== 1 ? "s" : ""}** approaching minimum`);
    if (pendingPOs.length > 0) lines.push(`⏳ **${pendingPOs.length} PO${pendingPOs.length !== 1 ? "s" : ""}** awaiting approval`);
    lines.push("\nHow can I help you today?");
    return lines.join("\n");
  })();

  const [messages, setMessages] = useState([{ role: "ai", text: initialGreeting }]);
  const [input,    setInput]    = useState("");
  const chatRef = useRef(null);

  const buildResponse = (query) => {
    const lower = query.toLowerCase();
    if (lower.includes("critical")) {
      if (critItems.length === 0) return "✅ No critical items! All stock levels are within safe range.";
      return `🔴 **${critItems.length} Critical Item${critItems.length !== 1 ? "s" : ""} Found:**\n\n${
        critItems.slice(0, 6).map((i) => `• **${i.name}** (${i.code}): ${i.stock} ${i.unit} vs ${i.min} ${i.unit} minimum`).join("\n")
      }\n\n💡 Create POs immediately from the Purchase Orders page.`;
    }
    if (lower.includes("generate") || lower.includes("create po")) {
      if (pendingPOs.length > 0) return `📦 **${pendingPOs.length} PO${pendingPOs.length !== 1 ? "s" : ""} Already Pending:**\n\n${
        pendingPOs.map((p) => `• **${p.id}** — ${p.vendor} (₹${(p.amount || 0).toLocaleString("en-IN")})`).join("\n")
      }\n\n⏳ Go to Approvals page to process these.`;
      if (critItems.length > 0) return `📦 **Suggested POs for ${critItems.length} Critical Item${critItems.length !== 1 ? "s" : ""}:**\n\n${
        critItems.slice(0, 5).map((i) => `• ${i.name} (${i.code}) — reorder ${i.min * 2} ${i.unit} from ${i.vendor || "preferred vendor"}`).join("\n")
      }\n\n➡️ Go to Purchase Orders page to create these.`;
      return "✅ No POs needed right now. All stock levels are healthy!";
    }
    if (lower.includes("predict") || lower.includes("consumption") || lower.includes("forecast")) {
      const forecastItems = allItems.filter((i) => Array.isArray(i.trend) && i.trend.length >= 3).slice(0, 5);
      if (forecastItems.length === 0) return "📈 Not enough trend data yet. Add stock movements to build forecasts.";
      return `📈 **30-Day Consumption Forecast:**\n\n${
        forecastItems.map((i) => {
          const avg = Math.max(0, Math.round((i.trend[0] - i.trend[i.trend.length - 1]) / i.trend.length));
          return `• **${i.name}** — ~${avg} ${i.unit}/month`;
        }).join("\n")
      }\n\nBased on recent stock movement trends.`;
    }
    if (lower.includes("vendor") || lower.includes("performance") || lower.includes("supplier")) {
      const stats = {};
      pos.forEach((p) => {
        if (!stats[p.vendor]) stats[p.vendor] = { total: 0, received: 0 };
        stats[p.vendor].total++;
        if (p.status === "received") stats[p.vendor].received++;
      });
      const entries = Object.entries(stats).slice(0, 5);
      if (entries.length === 0) return "🏭 No PO data yet to compute vendor performance.";
      return `🏭 **Vendor Performance Summary:**\n\n${
        entries.map(([name, d]) => {
          const pct  = Math.round((d.received / d.total) * 100);
          const icon = pct >= 80 ? "⭐" : pct >= 50 ? "🔵" : "🔴";
          return `${icon} **${name.split(" ")[0]}** — ${d.received}/${d.total} POs received`;
        }).join("\n")
      }`;
    }
    return `Analyzing: "${query}"...\n\nBased on current data (${allItems.length} SKUs, ${pos.length} POs${critItems.length > 0 ? `, ${critItems.length} critical` : ""}), I recommend reviewing affected items. Would you like me to generate a specific report?`;
  };

  const send = (text) => {
    if (!text.trim()) return;
    const aiText = buildResponse(text);
    setMessages((prev) => [...prev, { role: "user", text }, { role: "ai", text: aiText }]);
    setInput("");
    setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: "smooth" }), 100);
  };

  const quickActions = [
    { label: "🔴 Show critical stock",  query: "show critical stock"                  },
    { label: "📦 Generate POs",          query: "generate PO for all critical items"   },
    { label: "📈 Predict consumption",   query: "predict consumption for next month"   },
    { label: "🏭 Vendor performance",    query: "vendor performance summary"           },
  ];

  const aiStats = [
    { label: "Reorder Accuracy", pct: 94, color: "#22c55e" },
    { label: "Demand Forecast",  pct: 87, color: "#3b82f6" },
    { label: "Vendor Scoring",   pct: 91, color: "#3b82f6" },
    { label: "Price Prediction", pct: 78, color: "#f97316" },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="🤖 AI Inventory Assistant" subtitle={`Analyzing ${allItems.length} SKUs in real-time`}>
        <Btn variant="ghost" size="sm">🔄 Reset</Btn>
        <Btn variant="purple" size="sm">📊 Generate Report</Btn>
      </Topbar>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chat */}
        <div className="lg:col-span-2 bg-[#0e1117] border border-purple-500/20 rounded-xl overflow-hidden flex flex-col" style={{ height: "600px" }}>
          <div className="bg-purple-500/10 border-b border-purple-500/20 p-4 flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-sm">🤖</div>
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-400 rounded-full border border-[#0e1117] animate-pulse" />
            </div>
            <div>
              <div className="text-sm font-bold text-purple-400">Inventory AI</div>
              <div className="text-[10px] text-slate-500">Analyzing {allItems.length} SKUs in real-time</div>
            </div>
          </div>

          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] text-xs leading-relaxed rounded-xl px-4 py-3 whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-500/20 text-blue-100 border border-blue-500/30"
                    : "bg-white/[0.04] text-slate-300 border border-white/[0.06]"
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-white/[0.06]">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {quickActions.map((a) => (
                <button key={a.label} onClick={() => send(a.query)}
                  className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-colors">{a.label}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send(input)}
                placeholder="Ask about inventory, POs, vendors..."
                className="flex-1 bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-purple-500/40" />
              <Btn variant="primary" size="sm" onClick={() => send(input)}>Send ↗</Btn>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>🎯 AI Confidence Scores</SectionHeader>
            <div className="space-y-3">
              {aiStats.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-400">{s.label}</span>
                    <span className="font-bold font-mono" style={{ color: s.color }}>{s.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>📊 Live Inventory Stats</SectionHeader>
            <div className="space-y-3">
              {[
                { label: "Total SKUs",    value: allItems.length,    color: "#3b82f6" },
                { label: "Critical",      value: critItems.length,   color: "#ef4444" },
                { label: "Warning",       value: warnItems.length,   color: "#f97316" },
                { label: "Pending POs",   value: pendingPOs.length,  color: "#a78bfa" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className="text-[11px] text-slate-400 flex-1">{item.label}</span>
                  <span className="text-sm font-bold font-mono text-white">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>⚡ Quick Actions</SectionHeader>
            <div className="space-y-2">
              <Btn variant="primary" size="sm" className="w-full justify-center">📦 Auto-create all POs</Btn>
              <Btn variant="wa" size="sm" className="w-full justify-center">📱 WA alert to vendors</Btn>
              <Btn variant="mail" size="sm" className="w-full justify-center">✉️ Email daily report</Btn>
              <Btn variant="ghost" size="sm" className="w-full justify-center">📊 Generate analytics PDF</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────

// Settings UI primitives — MODULE SCOPE (stable identity). Defining these inside
// SettingsPage caused inputs to lose focus on every keystroke (remount on re-render).
const SLabel = ({ text, hint }) => (
  <div className="mb-1.5">
    <div className="text-[12px] font-semibold text-slate-300">{text}</div>
    {hint && <div className="text-[10px] text-slate-600 mt-0.5">{hint}</div>}
  </div>
);

const Toggle = ({ checked, onChange, label, desc }) => (
  <div className="flex items-center justify-between py-3.5 border-b border-white/[0.05] last:border-0">
    <div>
      <div className="text-[13px] font-semibold text-white">{label}</div>
      {desc && <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>}
    </div>
    <button onClick={() => onChange(!checked)}
            className="relative flex-shrink-0 w-11 h-6 rounded-full transition-all duration-200"
            style={{ background: checked ? "#2563eb" : "rgba(255,255,255,0.08)", border: `1px solid ${checked ? "rgba(59,130,246,0.6)" : "rgba(255,255,255,0.1)"}` }}>
      <div className="absolute top-0.5 h-5 w-5 rounded-full transition-all duration-200 shadow"
           style={{ background: "#fff", left: checked ? "calc(100% - 22px)" : "2px" }} />
    </button>
  </div>
);

const Section = ({ icon, title, children }) => (
  <div className="bg-[#0e1117] border border-white/[0.07] rounded-2xl overflow-hidden">
    <div className="flex items-center gap-3 px-6 py-4 border-b border-white/[0.06]"
         style={{ background: "rgba(255,255,255,0.015)" }}>
      <span className="text-base">{icon}</span>
      <span className="text-[14px] font-bold text-white">{title}</span>
    </div>
    <div className="px-6 py-5">{children}</div>
  </div>
);

const SETTINGS_DEFAULTS = {
  companyName:     "Shantaz Technofoods",
  gst:             "",
  address:         "",
  phone:           "",
  email:           "",
  logo:            "",
  currency:        "INR (₹)",
  whatsappAlerts:  false,
  emailAlerts:     false,
  po:              null,   // Purchase Order settings (company profiles, templates) — see utils/poTemplate
};

function SettingsPage({ settings: initialSettings = SETTINGS_DEFAULTS, onSave, isSuperAdmin = false }) {
  const [settings, setSettings] = useState(() => ({ ...SETTINGS_DEFAULTS, ...initialSettings }));
  const [saved,    setSaved]    = useState(false);
  const [backupOk, setBackupOk] = useState(false);
  const logoRef = useRef(null);

  const upd = (key, val) => setSettings((prev) => ({ ...prev, [key]: val }));

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => upd("logo", ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    onSave?.(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleBackup = () => {
    const keys = ["erp_items","erp_pos","erp_vendors","erp_bomdefs","erp_outward","erp_inward","erp_pending","erp_followups","erp_machines","erp_audit","erp_settings"];
    const backup = { exportedAt: new Date().toISOString(), version: "1.0", data: {} };
    keys.forEach((k) => {
      try { backup.data[k] = JSON.parse(localStorage.getItem(k) || "null"); } catch {}
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `ERP_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    setBackupOk(true); setTimeout(() => setBackupOk(false), 2500);
  };

  const handleExportExcel = () => {
    try {
      const rawItems = JSON.parse(localStorage.getItem("erp_items") || "{}");
      const rows = Object.entries(rawItems).flatMap(([cat, list]) =>
        (list || []).map((i) => [cat, i.code, i.name, i.stock, i.min, i.unit, i.status, i.lastPurchaseRate || 0, i.location || ""])
      );
      const headers = ["Category","Code","Name","Stock","Min Stock","Unit","Status","Last Rate (₹)","Location"];
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url;
      a.download = `Inventory_Export_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch {}
  };

  const inpCls = "w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-[13px] text-[#f0f6ff] placeholder-slate-600 outline-none focus:border-blue-500/40 transition-colors";

  // SLabel / Toggle / Section are hoisted to module scope (above SETTINGS_DEFAULTS).
  // Defining them inside this component remounted every <Section> subtree on each
  // keystroke (new function identity per render), which stole focus from inputs.

  return (
    <div className="flex-1 overflow-y-auto">
      <Topbar title="Settings" subtitle={`Manage company details, alerts and data · Build ${APP_BUILD}`}>
        <button onClick={handleSave}
                className="inline-flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl transition-all duration-200"
                style={{ background: saved ? "rgba(34,197,94,0.18)" : "linear-gradient(135deg,#2563eb,#4f46e5)", color: saved ? "#4ade80" : "#fff", border: saved ? "1px solid rgba(34,197,94,0.4)" : "1px solid rgba(99,130,255,0.5)", boxShadow: saved ? "none" : "0 0 12px rgba(59,130,246,0.3)" }}>
          {saved ? "✅ Saved!" : "💾 Save Changes"}
        </button>
      </Topbar>

      <div className="p-6 max-w-2xl space-y-5">

        {/* ── 1. Company ── */}
        <Section icon="🏭" title="Company">
          <div className="space-y-4">

            {/* Logo upload */}
            <div className="flex items-center gap-4 pb-4 border-b border-white/[0.06]">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden"
                   style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                {settings.logo
                  ? <img src={settings.logo} alt="logo" className="w-full h-full object-contain" />
                  : <span className="text-2xl">🏭</span>}
              </div>
              <div>
                <div className="text-[12px] font-semibold text-slate-300 mb-1">Company Logo</div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                <div className="flex gap-2">
                  <button onClick={() => logoRef.current?.click()}
                          className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-white/[0.1] text-slate-300 hover:text-white hover:border-white/20 transition-all">
                    Upload Logo
                  </button>
                  {settings.logo && (
                    <button onClick={() => upd("logo", "")}
                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-all">
                      Remove
                    </button>
                  )}
                </div>
                <div className="text-[10px] text-slate-600 mt-1">PNG, JPG — shown on printed POs</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <SLabel text="Company Name" />
                <input value={settings.companyName} onChange={(e) => upd("companyName", e.target.value)}
                       placeholder="e.g. Shantaz Technofoods Pvt Ltd" className={inpCls} />
              </div>
              <div>
                <SLabel text="GST Number" />
                <input value={settings.gst} onChange={(e) => upd("gst", e.target.value)}
                       placeholder="e.g. 24AABCS1234L1ZN" className={inpCls} />
              </div>
              <div>
                <SLabel text="Phone" />
                <input value={settings.phone} onChange={(e) => upd("phone", e.target.value)}
                       placeholder="+91 98765 43210" className={inpCls} />
              </div>
              <div className="col-span-2">
                <SLabel text="Email" />
                <input type="email" value={settings.email} onChange={(e) => upd("email", e.target.value)}
                       placeholder="purchase@yourcompany.com" className={inpCls} />
              </div>
              <div className="col-span-2">
                <SLabel text="Address" />
                <textarea value={settings.address} onChange={(e) => upd("address", e.target.value)}
                          placeholder="Factory / office address" rows={2}
                          className={inpCls + " resize-none"} />
              </div>
            </div>
          </div>
        </Section>

        {/* ── 2. Purchase Order Templates & Company Profiles ── */}
        <Section icon="🧾" title="Purchase Order Settings">
          <POSettings
            value={settings.po}
            settings={settings}
            isSuperAdmin={isSuperAdmin}
            onChange={(po) => upd("po", po)}
          />
        </Section>

        {/* ── 3. Inventory ── */}
        <Section icon="📦" title="Inventory">
          <SLabel text="Currency" hint="Shown throughout the ERP" />
          <select value={settings.currency} onChange={(e) => upd("currency", e.target.value)}
                  className={inpCls} style={{ background: "#0b0e17", color: "#f0f6ff" }}>
            {["INR (₹)", "USD ($)", "EUR (€)", "GBP (£)", "AED (د.إ)"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <div className="mt-3 px-3.5 py-3 rounded-xl" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)" }}>
            <div className="text-[11px] text-blue-300 font-semibold">ℹ️ Low Stock Alerts</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Low stock thresholds are set per item in <span className="text-white font-semibold">Item Master → Minimum Stock</span>.
              Items below their individual minimum are shown in Inventory and Order Pipeline automatically.
            </div>
          </div>
        </Section>

        {/* ── 3. Notifications ── */}
        <Section icon="🔔" title="Notifications">
          <Toggle
            checked={settings.whatsappAlerts}
            onChange={(v) => upd("whatsappAlerts", v)}
            label="WhatsApp Alerts"
            desc="Send low stock and PO status updates via WhatsApp" />
          <Toggle
            checked={settings.emailAlerts}
            onChange={(v) => upd("emailAlerts", v)}
            label="Email Alerts"
            desc="Send order confirmations and approval reminders via Email" />
        </Section>

        {/* ── 4. Data ── */}
        <Section icon="💾" title="Data">
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-xl border border-white/[0.07]"
                 style={{ background: "rgba(255,255,255,0.02)" }}>
              <div>
                <div className="text-[13px] font-semibold text-white">Backup Data</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Download a full JSON backup of all ERP data</div>
              </div>
              <button onClick={handleBackup}
                      className="flex-shrink-0 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all"
                      style={{ color: backupOk ? "#4ade80" : "#93c5fd", background: backupOk ? "rgba(34,197,94,0.1)" : "rgba(59,130,246,0.08)", borderColor: backupOk ? "rgba(34,197,94,0.3)" : "rgba(59,130,246,0.25)" }}>
                {backupOk ? "✅ Downloaded" : "⬇ Backup Now"}
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-white/[0.07]"
                 style={{ background: "rgba(255,255,255,0.02)" }}>
              <div>
                <div className="text-[13px] font-semibold text-white">Export Inventory to Excel</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Download all inventory items as a CSV file (opens in Excel)</div>
              </div>
              <button onClick={handleExportExcel}
                      className="flex-shrink-0 text-[12px] font-bold px-4 py-2 rounded-xl border transition-all text-green-400 hover:bg-green-500/10 border-green-500/20 hover:border-green-500/40">
                ⬇ Export Excel
              </button>
            </div>
          </div>
        </Section>

        {/* Bottom save shortcut */}
        <div className="pt-1 pb-4">
          <button onClick={handleSave}
                  className="w-full py-3 rounded-xl text-[13px] font-bold transition-all duration-200"
                  style={{ background: saved ? "rgba(34,197,94,0.12)" : "linear-gradient(135deg,#1d4ed8,#4338ca)", color: saved ? "#4ade80" : "#fff", border: saved ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(99,130,255,0.4)", boxShadow: saved ? "none" : "0 4px 20px rgba(59,130,246,0.2)" }}>
            {saved ? "✅ Changes Saved Successfully" : "💾 Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PDF GENERATOR ────────────────────────────────────────────────────────────

function generatePOPdf(po, vendor, settings = {}) {
  // Resolve the company profile + template from PO Settings (per-PO override → active default).
  const poCfg   = normalizePOSettings(settings);
  const company = getActiveCompany(settings, po?.companyId);
  openPOPdf(po, vendor, company, {
    template:    po?.template || poCfg.template,
    show:        poCfg.show,
    terms:       poCfg.terms,
    declaration: poCfg.declaration,
  });
}

// ─── ORDER PIPELINE PAGE ─────────────────────────────────────────────────────

function OrderPipelinePage({ items, pos, vendorList, followUps, onUpdatePO, onCreatePO, onReceivePO, onConfirmOrder, onFollowUpDone, onDeletePO, pendingLog = [], onFulfillPending, handleUpdateStock, inwardLog = [], canDo = () => true, settings = {}, isSuperAdmin = false, onReverseReceive }) {
  // modal states
  const [rejectModal,  setRejectModal]  = useState(null); // poId
  const [rejectReason, setRejectReason] = useState("");
  const [rejectErr,    setRejectErr]    = useState(false);
  const [moModal,      setMoModal]      = useState(null); // po object (Make Order ETA)
  const [eta,          setEta]          = useState("");
  const [etaCustom,    setEtaCustom]    = useState("");
  const [fuModal,      setFuModal]      = useState(null); // follow-up entry
  const [fuFreq,       setFuFreq]       = useState(1);
  const [fuCustom,     setFuCustom]     = useState("");
  const [viewPO,       setViewPO]       = useState(null); // po object to view
  const [showCreatePO, setShowCreatePO] = useState(false);
  const [createPrefill,setCreatePrefill]= useState(null);
  const [receiveToast, setReceiveToast] = useState(null);
  const [qtyModal,     setQtyModal]     = useState(null); // { item } — Low Stock order qty picker
  const [reverseModal, setReverseModal] = useState(null); // poId — Super Admin reverse-receive
  const [reverseReason,setReverseReason]= useState("");
  const [reverseErr,   setReverseErr]   = useState("");
  const [qtyInput,     setQtyInput]     = useState("");
  const [waToast,      setWaToast]      = useState(null);

  // Phase 2 — Vendor-first PO wizard. Additive entry point ("📦 Create Vendor PO"
  // button) that opens Step 1 (Company) → Step 2 (Vendor) → POModal pre-filled.
  // The existing "+ New PO" and per-item "Order Now" buttons are unchanged.
  const [vendorWizStep,      setVendorWizStep]      = useState(null);  // null | "company" | "vendor"
  const [vendorWizCompanyId, setVendorWizCompanyId] = useState(null);
  const [vendorWizVendor,    setVendorWizVendor]    = useState(null);  // vendor NAME

  // WhatsApp PO confirmation — opens the exact vendor chat with a prefilled message,
  // or toasts when the vendor's mobile number is missing/invalid.
  const sendWA = (po) => {
    const vendor  = vendorList.find((x) => x.name === po.vendor);
    const company = getActiveCompany(settings, po?.companyId);
    const res = sendPOWhatsApp(po, vendor, company?.name);
    if (!res.ok) { setWaToast(waErrorToast(res.error)); setTimeout(() => setWaToast(null), 3500); }
  };

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const allItems = Object.values(items).flat();

  // Item codes already covered by an active PO (pending → ordered/overdue).
  // Rejected and received POs do NOT cover an item — rejected items must return to Low Stock.
  const coveredByActivePO = new Set(
    pos
      .filter(p => ["pending","review","draft","approved","ordered","overdue"].includes(p.status))
      .flatMap(p => (p.lineItems || []).map(li => li.code))
  );

  // Low Stock = below-minimum items that have NO active PO.
  // Deduplicated by item.code — one card per item regardless of vendor count.
  // Disappears when a PO is created; returns automatically when that PO is rejected.
  const lowStock = (() => {
    const seen = new Set();
    const out  = [];
    for (const i of allItems) {
      if ((i.status === "critical" || i.status === "warning") && !coveredByActivePO.has(i.code) && !seen.has(i.code)) {
        seen.add(i.code);
        out.push(i);
      }
    }
    return out.sort((a, b) => a.status === "critical" ? -1 : 1);
  })();

  const approvalPOs  = pos.filter(p => ["pending","review","draft"].includes(p.status));
  const makeOrderPOs = pos.filter(p => p.status === "approved" || p.status === "overdue");
  const receivedPOs  = pos.filter(p => p.status === "received").sort((a, b) => parseDate(b.receivedDate||b.date) - parseDate(a.receivedDate||a.date));

  const enrichedFU    = followUps.map(f => {
    const diff  = Math.floor((parseDate(f.nextFollowUp) - today) / 86400000);
    return { ...f, daysRemaining: diff, fstat: diff < 0 ? "fu-overdue" : diff === 0 ? "fu-due" : "fu-pending" };
  }).sort((a,b) => a.daysRemaining - b.daysRemaining);

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleReject = () => {
    if (!rejectReason.trim()) { setRejectErr(true); return; }
    onUpdatePO(rejectModal, { status: "rejected", rejectReason });
    setRejectModal(null); setRejectReason(""); setRejectErr(false);
  };
  const handleConfirm = () => {
    if (!eta) return;
    const d = new Date(); d.setDate(d.getDate() + +eta);
    onConfirmOrder(moModal.id, eta === "custom" ? etaCustom : fmtDate(d));
    setMoModal(null); setEta(""); setEtaCustom("");
  };
  const handleFuDone = () => {
    const d = new Date(); d.setDate(d.getDate() + (fuFreq === "custom" ? 0 : fuFreq));
    onFollowUpDone(fuModal.id, fuFreq, fuFreq === "custom" ? fuCustom : fmtDate(d));
    setFuModal(null); setFuFreq(1); setFuCustom("");
  };
  const handleReceive = (poId) => {
    onReceivePO(poId);
    setReceiveToast(poId); setTimeout(() => setReceiveToast(null), 3000);
  };
  const openCreatePO = (item, overrideQty) => {
    const suggestedQty  = overrideQty ?? Math.max(item.min * 2 - item.stock, item.min);
    // Resolve preferred vendor: vendorLinks → single vendorId → legacy vendor name → first in list
    const preferredLink = (item.vendorLinks || []).find((l) => l.role === "Preferred") || (item.vendorLinks || [])[0];
    const linkedVendor  = preferredLink
      ? vendorList.find((v) => v.id === preferredLink.vendorId)
      : (item.vendorId ? vendorList.find((v) => v.id === item.vendorId) : null);
    const vendorName    = linkedVendor?.name || preferredLink?.vendorName || (item.vendor && item.vendor !== "—" ? item.vendor : (vendorList[0]?.name || ""));
    setCreatePrefill({
      vendor: vendorName,
      priority: item.status === "critical" ? "urgent" : "high",
      vendorLinks: item.vendorLinks || (item.vendorId ? [{ vendorId: item.vendorId, vendorName: item.vendor || "", role: "Preferred" }] : []),
      lineItems: [{
        code: item.code, name: item.name, category: item.category || Object.keys(items).find(cat => items[cat]?.some(i=>i.code===item.code)) || "Other",
        unit: item.unit, qty: suggestedQty, rate: item.lastPurchaseRate || 0,
        amount: suggestedQty * (item.lastPurchaseRate || 0),
        // Phase 3 — snapshot design (unchecked by default; user opts in via checkbox)
        designFile: item.designFile || "", designName: item.designName || "", attachDesign: false,
      }],
    });
    setShowCreatePO(true);
  };

  // ── Phase 2 — Vendor-first PO wizard helpers ──────────────────────────────
  // Vendors that have ≥1 PREFERRED low-stock item, sorted by item count desc.
  // Approved/Backup links do NOT count (Rule 1). The result drives Step 2.
  const vendorsWithPreferredLowStock = (() => {
    const counts = new Map();
    for (const it of allItems) {
      if (it.status !== "critical" && it.status !== "warning") continue;
      const pref = (it.vendorLinks || []).find((l) => l.role === "Preferred");
      if (!pref) continue;
      const v = vendorList.find((x) => x.id === pref.vendorId);
      if (!v) continue;
      counts.set(v.name, (counts.get(v.name) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  })();
  const openVendorWizard = () => {
    const cfg = normalizePOSettings(settings);
    setVendorWizCompanyId(cfg.activeCompanyId);
    setVendorWizVendor(null);
    setVendorWizStep("company");
  };
  const cancelVendorWizard = () => { setVendorWizStep(null); setVendorWizVendor(null); };
  const confirmWizCompany  = () => { if (vendorWizCompanyId) setVendorWizStep("vendor"); };
  const confirmWizVendor   = () => {
    if (!vendorWizVendor) return;
    // Hand off to POModal. Vendor stays editable; companyId is honored by POModal init.
    setCreatePrefill({
      vendor:        vendorWizVendor,
      companyId:     vendorWizCompanyId,
      vendorWizard:  true,
      lineItems:     [],
    });
    setShowCreatePO(true);
    setVendorWizStep(null);
  };

  // ── sub-components ──────────────────────────────────────────────────────────
  const ColHdr = ({ icon, title, count, color }) => (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-1 h-5 rounded-full" style={{ background: color }} />
        <span className="text-[12px] font-semibold text-white">{icon} {title}</span>
      </div>
      <span className="text-[11px] font-semibold text-white px-2 py-0.5 rounded-full" style={{ background: color+"22", border:`1px solid ${color}44` }}>{count}</span>
    </div>
  );
  const FuBadge = ({ fstat }) => {
    const cfg = statusConfig[fstat] || statusConfig["fu-pending"];
    return <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-black border ${cfg.bg} ${cfg.text} ${cfg.border}`}>{cfg.label}</span>;
  };
  const ViewBtn = ({ po }) => (
    <button onClick={() => setViewPO(po)}
            className="flex-1 text-[9px] font-bold py-1 rounded-lg text-slate-400 border border-white/[0.08] bg-white/[0.03] hover:text-white hover:bg-white/[0.08] transition-all">
      📄 View PO
    </button>
  );
  const card = "rounded-xl p-3.5 border transition-all hover:scale-[1.005]";

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {receiveToast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(34,197,94,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📦</span>
          <div>
            <div className="text-xs font-black text-white">Received — {receiveToast}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Stock updated · Pipeline closed</div>
          </div>
        </div>
      )}

      {waToast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#2a1216,#1a0c0e)", border: "1px solid rgba(239,68,68,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">⚠️</span>
          <div>
            <div className="text-xs font-black text-white">{waToast}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Add a valid mobile number in Vendor Master.</div>
          </div>
          <button onClick={() => setWaToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Order Pipeline" subtitle={`${lowStock.length} low stock · ${approvalPOs.length} pending approval · ${makeOrderPOs.length} ready to order · ${enrichedFU.length} follow-ups · ${receivedPOs.length} received`}>
        {canDo("pipeline","create") && (
          <button onClick={openVendorWizard}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                  style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", borderColor: "rgba(34,197,94,0.5)" }}>
            📦 Create Vendor PO
          </button>
        )}
        {canDo("pipeline","create") && (
          <button onClick={() => { setCreatePrefill(null); setShowCreatePO(true); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                  style={{ background: "linear-gradient(135deg,#2563eb,#4f46e5)", borderColor: "rgba(99,130,255,0.5)" }}>
            + New PO
          </button>
        )}
      </Topbar>

      <div className="flex-1 overflow-x-auto overflow-y-hidden p-5">
        <div className="flex gap-4 h-full" style={{ minWidth: "1160px" }}>

          {/* ─ Col 1: Low Stock ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="🔴" title="Low Stock" count={lowStock.length} color="#ef4444" />
            <div className="flex-1 overflow-y-auto pr-1 pb-2 space-y-2.5">
              {lowStock.length === 0 && (
                <div className="text-center py-10 text-[11px] text-slate-600">
                  <div className="text-3xl mb-2">✅</div>All stock levels healthy
                </div>
              )}
              {lowStock.map(item => {
                const poPct          = item.min > 0 ? Math.min(100, Math.round((item.stock / item.min) * 100)) : 0;
                const shortage       = Math.max(0, item.min - item.stock);
                const recommendedQty = Math.max(item.min * 2 - item.stock, item.min);
                return (
                  <div key={item.code}
                       className={`${card} ${item.status === "critical" ? "border-red-500/30" : "border-orange-500/20"}`}
                       style={{ background: "#0e1117" }}>
                    <div className="flex items-start justify-between gap-2 mb-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-white truncate">{item.name}</div>
                        <div className="text-[9px] font-mono text-slate-500 mt-0.5">{item.code}</div>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                    {/* Stock details grid */}
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Current</div>
                        <div className={`text-[11px] font-bold ${item.status === "critical" ? "text-red-400" : "text-orange-400"}`}>{item.stock} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="text-[8px] text-slate-600 uppercase tracking-wide mb-0.5">Minimum</div>
                        <div className="text-[11px] font-bold text-slate-400">{item.min} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.15)" }}>
                        <div className="text-[8px] text-orange-700 uppercase tracking-wide mb-0.5">Shortage</div>
                        <div className="text-[11px] font-bold text-orange-400">{shortage} {item.unit}</div>
                      </div>
                      <div className="px-2 py-1.5 rounded-lg" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
                        <div className="text-[8px] text-blue-700 uppercase tracking-wide mb-0.5">Recommended</div>
                        <div className="text-[11px] font-bold text-blue-400">{recommendedQty} {item.unit}</div>
                      </div>
                    </div>
                    {/* Linked vendors — show all, deduplicated by vendor card */}
                    {(() => {
                      const roleOrder = { Preferred: 0, Approved: 1, Backup: 2 };
                      const links = item.vendorLinks?.length
                        ? [...item.vendorLinks].sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3))
                        : (item.vendor && item.vendor !== "—" ? [{ vendorName: item.vendor, role: "Preferred" }] : []);
                      if (!links.length) return null;
                      const roleCol = (r) => r === "Preferred" ? "#fbbf24" : r === "Approved" ? "#34d399" : "#94a3b8";
                      return (
                        <div className="mb-1.5">
                          {links.length === 1 ? (
                            <div className="text-[9px] text-slate-500 truncate">🏭 {links[0].vendorName}</div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1 mb-0.5">
                              <span className="text-[9px] text-slate-600">🏭</span>
                              {links.slice(0, 2).map((l, i) => (
                                <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full truncate max-w-[80px]"
                                      style={{ color: roleCol(l.role), background: `${roleCol(l.role)}14`, border: `1px solid ${roleCol(l.role)}28` }}>
                                  {l.vendorName}
                                </span>
                              ))}
                              {links.length > 2 && (
                                <span className="text-[8px] text-slate-600 font-semibold">+{links.length - 2}</span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="h-1 rounded-full bg-white/[0.05] mb-2.5 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${poPct}%`, background: item.status === "critical" ? "#ef4444" : "#f97316" }} />
                    </div>
                    {canDo("pipeline","create") && (
                      <button onClick={() => { setQtyModal({ item }); setQtyInput(String(recommendedQty)); }}
                              className="w-full text-[10px] font-semibold py-1.5 rounded-lg text-white border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/35 transition-all">
                        + Create PO
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Col 2: PO Approval ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="⏳" title="PO Approval" count={approvalPOs.length} color="#f97316" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {approvalPOs.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">✅</div>No POs awaiting approval</div>}
              {approvalPOs.map(po => (
                <div key={po.id} className={`${card} border-orange-500/20`} style={{ background: "#0e1117" }}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">{po.id}</span>
                    <StatusBadge status={po.status} />
                  </div>
                  <div className="text-[11px] font-bold text-white truncate mb-0.5">{po.vendor}</div>
                  <div className="text-[9px] text-slate-500 mb-0.5">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} items · {po.date}</div>
                  {po.priority && <div className={`text-[9px] font-bold mb-2 ${po.priority==="urgent"?"text-red-400":po.priority==="high"?"text-orange-400":"text-slate-600"}`}>⚡ {po.priority.toUpperCase()}</div>}
                  {po.notes && <div className="text-[9px] text-slate-500 mb-2 truncate italic">"{po.notes}"</div>}
                  {po.rejectReason && <div className="text-[9px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1.5 mb-2">❌ {po.rejectReason}</div>}
                  <div className="flex gap-1 mb-1.5">
                    {canDo("pipeline","approve") && (
                      <button onClick={() => onUpdatePO(po.id, { status:"approved", rejectReason:null })}
                              className="flex-1 text-[10px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">✅ Approve</button>
                    )}
                    {canDo("pipeline","reject") && (
                      <button onClick={() => { setRejectModal(po.id); setRejectReason(""); setRejectErr(false); }}
                              className="flex-1 text-[10px] font-bold py-1.5 rounded-lg text-red-400 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-all">❌ Reject</button>
                    )}
                  </div>
                  <ViewBtn po={po} />
                </div>
              ))}
            </div>
          </div>

          {/* ─ Col 3: Make Order ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="📦" title="Make Order" count={makeOrderPOs.length} color="#3b82f6" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {makeOrderPOs.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📋</div>No approved POs to order</div>}
              {makeOrderPOs.map(po => {
                const v = vendorList.find(x => x.name === po.vendor);
                return (
                  <div key={po.id} className={`${card} border-blue-500/20`} style={{ background: "#0e1117" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5 rounded">{po.id}</span>
                      <StatusBadge status={po.status} />
                    </div>
                    <div className="text-[11px] font-bold text-white truncate mb-0.5">{po.vendor}</div>
                    <div className="text-[9px] text-slate-500 mb-0.5">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} items</div>
                    <div className="text-[9px] text-slate-500 mb-2">ETA: {po.delivery||"—"}</div>
                    <div className="flex gap-1 mb-1.5">
                      {v?.phone && <a href={`tel:${v.phone}`} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all">📞 Call</a>}
                      <button onClick={() => sendWA(po)} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">💬 WA</button>
                    </div>
                    {canDo("pipeline","ordered") && (
                      <button onClick={() => { setMoModal(po); setEta(""); setEtaCustom(""); }}
                              className="w-full text-[10px] font-bold py-1.5 rounded-lg text-white border border-blue-500/40 bg-blue-600/20 hover:bg-blue-600/30 transition-all mb-1.5">
                        📋 Confirm Order + ETA
                      </button>
                    )}
                    <ViewBtn po={po} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Col 4: Follow Up ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="🔔" title="Follow Up" count={enrichedFU.length} color="#a78bfa" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {enrichedFU.length === 0 && <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📭</div>No active follow-ups</div>}
              {enrichedFU.map(f => {
                const po = pos.find(p => p.id === f.poId);
                const v  = vendorList.find(x => x.name === f.vendor);
                return (
                  <div key={f.id} className={`${card} ${f.fstat==="fu-overdue"?"border-red-500/30":f.fstat==="fu-due"?"border-yellow-500/30":"border-purple-500/20"}`}
                       style={{ background: "#0e1117" }}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded">{f.poId}</span>
                      <FuBadge fstat={f.fstat} />
                    </div>
                    <div className="text-[11px] font-bold text-white truncate mb-0.5">{f.vendor}</div>
                    {f.itemNames?.length > 0 && (
                      <div className="text-[9px] text-slate-500 mb-1.5 truncate">{f.itemNames.slice(0,2).join(", ")}{f.itemNames.length>2?` +${f.itemNames.length-2} more`:""}</div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 mb-2 text-[9px]">
                      <div>
                        <div className="text-slate-600 mb-0.5">Remaining</div>
                        <div className={`font-bold ${f.daysRemaining<0?"text-red-400":f.daysRemaining===0?"text-yellow-400":"text-slate-300"}`}>
                          {f.daysRemaining<0?`${Math.abs(f.daysRemaining)}d overdue`:f.daysRemaining===0?"Due today":`${f.daysRemaining}d left`}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-600 mb-0.5">ETA</div>
                        <div className="font-bold text-slate-300">{f.eta||"—"}</div>
                      </div>
                      <div>
                        <div className="text-slate-600 mb-0.5">Next Follow-up</div>
                        <div className="font-bold text-purple-300">{f.nextFollowUp}</div>
                      </div>
                      {f.lastFollowUp && (
                        <div>
                          <div className="text-slate-600 mb-0.5">Last Follow-up</div>
                          <div className="font-bold text-slate-400">{f.lastFollowUp}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 mb-1.5">
                      {v?.phone && <a href={`tel:${v.phone}`} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all">📞 Call</a>}
                      <button onClick={() => sendWA(po || { id: f.poId, vendor: f.vendor })} className="flex-1 text-center text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">💬 WA</button>
                    </div>
                    <button onClick={() => { setFuModal(f); setFuFreq(1); setFuCustom(""); }}
                            className="w-full text-[9px] font-bold py-1.5 rounded-lg text-purple-400 border border-purple-500/30 bg-purple-500/10 hover:bg-purple-500/20 transition-all mb-1.5">
                      ✓ Mark Follow-Up Done
                    </button>
                    <div className="flex gap-1">
                      {canDo("pipeline","receive") && (
                        <button onClick={() => handleReceive(f.poId)}
                                className="flex-1 text-[9px] font-bold py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">
                          📦 Mark Received
                        </button>
                      )}
                      {po && <ViewBtn po={po} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ─ Col 5: Received ─ */}
          <div className="flex-1 flex flex-col min-w-[210px] max-w-[270px]">
            <ColHdr icon="✅" title="Received" count={receivedPOs.length} color="#22c55e" />
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 pb-2">
              {receivedPOs.length === 0 && (
                <div className="text-center py-10 text-[11px] text-slate-600"><div className="text-3xl mb-2">📭</div>No received orders yet</div>
              )}
              {receivedPOs.slice(0, 12).map(po => (
                <div key={po.id} className={`${card} border-green-500/20`} style={{ background: "#0e1117" }}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-1.5 py-0.5 rounded">{po.id}</span>
                    <StatusBadge status="received" />
                  </div>
                  <div className="text-[11px] font-bold text-white truncate mb-0.5">{po.vendor}</div>
                  <div className="text-[9px] text-slate-500 mb-1">₹{(po.amount||0).toLocaleString("en-IN")} · {po.lineItems?.length||0} item{(po.lineItems?.length||0)!==1?"s":""}</div>
                  {po.receivedDate && (
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[9px] font-bold text-green-500">📦 Received</span>
                      <span className="text-[9px] text-slate-500">{po.receivedDate}</span>
                    </div>
                  )}
                  {po.lineItems?.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {po.lineItems.map((li, i) => (
                        <div key={i} className="flex items-center justify-between px-2 py-1 rounded-lg"
                             style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.12)" }}>
                          <div className="text-[9px] text-slate-400 truncate flex-1 mr-2">{li.name}</div>
                          <div className="text-[9px] font-bold font-mono text-green-400 flex-shrink-0">+{li.qty} {li.unit}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <ViewBtn po={po} />
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* ── Create PO Modal ── */}
      {showCreatePO && (
        <POModal
          initialPO={null}
          vendorList={vendorList}
          items={items}
          prefill={createPrefill}
          pos={pos}
          settings={settings}
          onSave={(data) => {
            onCreatePO(data);
            setShowCreatePO(false); setCreatePrefill(null);
          }}
          onClose={() => { setShowCreatePO(false); setCreatePrefill(null); }}
        />
      )}

      {/* ── Phase 2 — Vendor PO Wizard Step 1: Select Company ── */}
      {vendorWizStep === "company" && (() => {
        const cfg = normalizePOSettings(settings);
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
               style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
               onClick={(e) => e.target === e.currentTarget && cancelVendorWizard()}>
            <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
                 style={{ background: "#0d1018", border: "1px solid rgba(34,197,94,0.4)", boxShadow: "0 40px 80px rgba(0,0,0,0.9)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-emerald-300"
                     style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)" }}>1</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-black text-white">Select Company</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Which company is issuing this PO?</div>
                </div>
                <button onClick={cancelVendorWizard} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {cfg.companies.map((c) => {
                  const sel = vendorWizCompanyId === c.id;
                  return (
                    <button key={c.id} onClick={() => setVendorWizCompanyId(c.id)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                            style={{ background: sel ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.08)"}` }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: sel ? "#16a34a" : "transparent", border: `1.5px solid ${sel ? "#16a34a" : "rgba(255,255,255,0.25)"}` }}>
                        {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      {c.logo
                        ? <img src={c.logo} alt="" className="w-7 h-7 rounded object-contain bg-white/5 flex-shrink-0" />
                        : <span className="text-base flex-shrink-0">🏭</span>}
                      <span className="text-[12px] font-bold text-white flex-1 truncate">{c.name || "(unnamed)"}</span>
                      {c.id === cfg.activeCompanyId && <span className="text-[9px] font-bold text-emerald-400 flex-shrink-0">ACTIVE</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={cancelVendorWizard}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>Cancel</button>
                <button onClick={confirmWizCompany} disabled={!vendorWizCompanyId}
                        className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.35)" }}>
                  Next → Vendor
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Phase 2 — Vendor PO Wizard Step 2: Select Vendor (preferred low-stock only) ── */}
      {vendorWizStep === "vendor" && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
             style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && cancelVendorWizard()}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
               style={{ background: "#0d1018", border: "1px solid rgba(34,197,94,0.4)", boxShadow: "0 40px 80px rgba(0,0,0,0.9)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-emerald-300"
                   style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)" }}>2</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-white">Select Vendor</div>
                <div className="text-[10px] text-slate-500 mt-0.5">Vendors with preferred low-stock items, sorted by item count.</div>
              </div>
              <button onClick={cancelVendorWizard} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            {vendorsWithPreferredLowStock.length === 0 ? (
              <div className="py-6 text-center">
                <div className="text-3xl mb-2">✅</div>
                <div className="text-sm font-bold text-white mb-1">No low-stock items with a preferred vendor</div>
                <div className="text-[11px] text-slate-500">Either everything is in safe stock, or low-stock items don't have a Preferred vendor link yet.</div>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {vendorsWithPreferredLowStock.map((v) => {
                  const sel = vendorWizVendor === v.name;
                  return (
                    <button key={v.name} onClick={() => setVendorWizVendor(v.name)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                            style={{ background: sel ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.08)"}` }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: sel ? "#16a34a" : "transparent", border: `1.5px solid ${sel ? "#16a34a" : "rgba(255,255,255,0.25)"}` }}>
                        {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="text-[12px] font-bold text-white flex-1 truncate">{v.name}</span>
                      <span className="text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex-shrink-0">
                        {v.count} low-stock item{v.count !== 1 ? "s" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setVendorWizStep("company")}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>← Back</button>
              <button onClick={cancelVendorWizard}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>Cancel</button>
              <button onClick={confirmWizVendor} disabled={!vendorWizVendor}
                      className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.35)" }}>
                Open PO →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View PO Modal ── */}
      {viewPO && (() => {
        const vnd      = vendorList.find(x => x.name === viewPO.vendor);
        const subtotal = (viewPO.lineItems || []).reduce((s, li) => s + (li.amount || 0), 0);
        const poGst    = viewPO.gst != null ? viewPO.gst : Math.round(subtotal * 0.18);
        const poTotal  = viewPO.amount || (subtotal + poGst);
        const steps    = ["Draft", "Pending", "Approved", "Ordered", "Received"];
        const stepMap  = { draft:0, pending:1, approved:2, ordered:3, received:4, overdue:2, review:1 };
        const cur      = stepMap[viewPO.status] ?? 0;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
             onClick={e => e.target === e.currentTarget && setViewPO(null)}>
          <div className="w-full max-w-2xl flex flex-col rounded-2xl overflow-hidden"
               style={{ maxHeight:"92vh", background:"linear-gradient(180deg,#0d1018,#090c14)", border:"1px solid rgba(59,130,246,0.32)", boxShadow:"0 40px 100px rgba(0,0,0,0.92)", animation:"slideUp 0.25s ease both" }}>
            {/* ── Header ── */}
            <div className="px-5 py-4 border-b border-white/[0.08] flex-shrink-0"
                 style={{ background:"linear-gradient(90deg,rgba(59,130,246,0.09),rgba(99,102,241,0.05))" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-black text-white font-mono">{viewPO.id}</span>
                    <StatusBadge status={viewPO.status} />
                    {viewPO.priority && (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${viewPO.priority==="urgent"?"bg-red-500/15 text-red-400":viewPO.priority==="high"?"bg-orange-500/15 text-orange-400":"bg-white/5 text-slate-500"}`}>
                        {viewPO.priority}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{viewPO.vendor} · {viewPO.date}</div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {vnd?.phone && <a href={`tel:${vnd.phone}`} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-blue-400 border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 transition-all">📞 Call</a>}
                  <button onClick={() => sendWA(viewPO)} className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-green-400 border border-green-500/30 bg-green-500/10 hover:bg-green-500/20 transition-all">💬 WhatsApp</button>
                  <button onClick={() => generatePOPdf(viewPO, vnd, settings)}
                          className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-orange-400 border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 transition-all">
                    📄 PDF
                  </button>
                  <button onClick={() => setViewPO(null)} className="w-7 h-7 rounded-lg bg-white/[0.05] hover:bg-red-500/20 hover:text-red-400 text-slate-500 transition-all flex items-center justify-center text-sm font-bold ml-0.5">✕</button>
                </div>
              </div>
              {/* Progress Steps */}
              <div className="flex items-start gap-0 mt-3.5">
                {steps.map((s, i) => (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black border ${i<cur?"bg-blue-500 border-blue-500 text-white":i===cur?"bg-blue-500/20 border-blue-500/60 text-blue-400":"bg-white/[0.04] border-white/[0.1] text-slate-600 opacity-40"}`}>
                        {i < cur ? "✓" : i + 1}
                      </div>
                      <div className={`text-[7px] mt-1 font-bold ${i===cur?"text-blue-400":i<cur?"text-slate-400":"text-slate-700"}`}>{s}</div>
                    </div>
                    {i < steps.length - 1 && <div className={`flex-1 h-px mx-1 mb-3.5 ${i<cur?"bg-blue-500":"bg-white/[0.06]"}`} />}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">

              {/* Vendor + PO Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl" style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Vendor</div>
                  <div className="text-[13px] font-black text-white mb-2">{viewPO.vendor}</div>
                  {vnd?.contactPerson && <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 mb-1">👤 {vnd.contactPerson}</div>}
                  {vnd?.phone && <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 mb-1">📱 {vnd.phone}</div>}
                  {vnd?.gst && <div className="text-[10px] font-mono text-slate-500 mb-1">GSTIN: {vnd.gst}</div>}
                  {vnd?.address && <div className="text-[10px] text-slate-500 leading-relaxed">{vnd.address}</div>}
                  {!vnd && <div className="text-[10px] text-slate-600 italic">Vendor details not on file</div>}
                </div>
                <div className="p-3.5 rounded-xl" style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Purchase Order</div>
                  <div className="grid gap-y-1.5 text-[10.5px]" style={{ gridTemplateColumns:"auto 1fr" }}>
                    <span className="text-slate-500 pr-3">PO Number</span><span className="font-mono font-bold text-white">{viewPO.id}</span>
                    <span className="text-slate-500 pr-3">Date</span><span className="font-semibold text-slate-300">{viewPO.date}</span>
                    <span className="text-slate-500 pr-3">ETA</span><span className="font-semibold text-slate-300">{viewPO.eta || viewPO.delivery || "—"}</span>
                    <span className="text-slate-500 pr-3">Priority</span>
                    <span className={`font-bold uppercase text-[9px] ${viewPO.priority==="urgent"?"text-red-400":viewPO.priority==="high"?"text-orange-400":"text-slate-400"}`}>{viewPO.priority||"normal"}</span>
                    <span className="text-slate-500 pr-3">Items</span><span className="font-semibold text-slate-300">{viewPO.lineItems?.length||0} line items</span>
                    <span className="text-slate-500 pr-3">Grand Total</span><span className="font-black text-green-400 font-mono">₹{poTotal.toLocaleString("en-IN")}</span>
                  </div>
                </div>
              </div>

              {/* Item Table */}
              {viewPO.lineItems?.length > 0 && (
                <div>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Items Ordered</div>
                  <div className="rounded-xl overflow-hidden" style={{ border:"1px solid rgba(255,255,255,0.07)" }}>
                    <table className="w-full">
                      <thead>
                        <tr style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                          <th className="text-left text-[9px] font-bold text-slate-500 uppercase px-3 py-2">#</th>
                          <th className="text-left text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Item</th>
                          <th className="text-center text-[9px] font-bold text-slate-500 uppercase px-2 py-2">Unit</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Qty</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Rate</th>
                          <th className="text-right text-[9px] font-bold text-slate-500 uppercase px-3 py-2">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewPO.lineItems.map((li, i) => (
                          <tr key={i} style={{ borderBottom: i < viewPO.lineItems.length-1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                            <td className="px-3 py-2 text-[10px] text-slate-600 font-mono">{i+1}</td>
                            <td className="px-3 py-2">
                              <div className="text-[11px] font-semibold text-white">{li.name}</div>
                              <div className="text-[9px] font-mono text-slate-500">{li.code}</div>
                            </td>
                            <td className="px-2 py-2 text-[10px] text-slate-400 text-center">{li.unit||"—"}</td>
                            <td className="px-3 py-2 text-[11px] font-mono text-slate-300 text-right">{li.qty}</td>
                            <td className="px-3 py-2 text-[11px] font-mono text-slate-400 text-right">₹{li.rate?.toLocaleString("en-IN")}</td>
                            <td className="px-3 py-2 text-[11px] font-bold font-mono text-green-400 text-right">₹{li.amount?.toLocaleString("en-IN")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {/* Totals strip */}
                    <div style={{ background:"rgba(255,255,255,0.025)", borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex justify-between px-3 py-1.5 text-[10px]">
                        <span className="text-slate-500">Subtotal</span>
                        <span className="font-mono font-semibold text-slate-300">₹{subtotal.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex justify-between px-3 py-1.5 text-[10px]">
                        <span className="text-slate-500">GST (18%)</span>
                        <span className="font-mono font-semibold text-orange-400">₹{poGst.toLocaleString("en-IN")}</span>
                      </div>
                      <div className="flex justify-between px-3 py-2.5" style={{ borderTop:"1px solid rgba(255,255,255,0.06)" }}>
                        <span className="text-[12px] font-bold text-white">Grand Total</span>
                        <span className="text-[13px] font-black font-mono text-green-400">₹{poTotal.toLocaleString("en-IN")}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              {viewPO.notes && (
                <div className="px-4 py-3 rounded-xl" style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(255,255,255,0.06)" }}>
                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-1.5">Notes / Terms</div>
                  <div className="text-[11px] text-slate-400 leading-relaxed">{viewPO.notes}</div>
                </div>
              )}

              {/* Received */}
              {viewPO.receivedDate && (
                <div className="px-4 py-3 rounded-xl" style={{ background:"rgba(34,197,94,0.05)", border:"1px solid rgba(34,197,94,0.25)" }}>
                  <div className="text-[9px] font-black text-green-400 uppercase tracking-[0.06em] mb-1">✅ Goods Received</div>
                  <div className="text-[11px] text-slate-400">Stock updated on {viewPO.receivedDate}. GRN recorded.</div>
                </div>
              )}

              {/* Activity History */}
              {viewPO.activityLog?.length > 0 && (() => {
                const iconCfg = {
                  "Created PO":     { icon: "📄", color: "#3b82f6" },
                  "Approved":       { icon: "✅", color: "#22c55e" },
                  "Rejected":       { icon: "❌", color: "#ef4444" },
                  "Order Placed":   { icon: "📋", color: "#8b5cf6" },
                  "Follow Up Done": { icon: "🔔", color: "#f97316" },
                  "Received":       { icon: "📦", color: "#22c55e" },
                };
                return (
                  <div>
                    <div className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.12em] mb-2">Activity History</div>
                    <div className="space-y-1.5">
                      {[...viewPO.activityLog].reverse().map((entry, i) => {
                        const cfg = iconCfg[entry.action] || { icon: "·", color: "#64748b" };
                        return (
                          <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
                               style={{ background:"rgba(255,255,255,0.02)", border:`1px solid ${cfg.color}20` }}>
                            <span className="text-sm flex-shrink-0 mt-0.5">{cfg.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-bold text-white">{entry.action}</div>
                              {entry.note && <div className="text-[10px] text-slate-500 mt-0.5">{entry.note}</div>}
                            </div>
                            <div className="text-[9px] text-slate-600 flex-shrink-0 mt-1">{entry.date}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* ── Footer Actions ── */}
            <div className="px-5 py-3.5 border-t border-white/[0.08] flex gap-2 flex-wrap flex-shrink-0" style={{ background:"rgba(0,0,0,0.35)" }}>
              <Btn variant="ghost" size="sm" onClick={() => setViewPO(null)}>Close</Btn>
              <div className="flex-1" />
              {["pending","review","draft"].includes(viewPO.status) && canDo("pipeline","approve") && (
                <Btn variant="green" size="sm" onClick={() => { onUpdatePO(viewPO.id, { status:"approved" }); setViewPO(null); }}>✅ Approve</Btn>
              )}
              {["pending","review","draft"].includes(viewPO.status) && canDo("pipeline","reject") && (
                <Btn variant="red" size="sm" onClick={() => { setRejectModal(viewPO.id); setViewPO(null); setRejectReason(""); setRejectErr(false); }}>❌ Reject</Btn>
              )}
              {viewPO.status === "approved" && canDo("pipeline","ordered") && (
                <button onClick={() => { setMoModal(viewPO); setViewPO(null); setEta(""); setEtaCustom(""); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                        style={{ background:"linear-gradient(135deg,#2563eb,#4f46e5)", borderColor:"rgba(99,130,255,0.5)" }}>
                  📋 Confirm Order + ETA
                </button>
              )}
              {["ordered","overdue"].includes(viewPO.status) && (() => {
                const fu = followUps.find(f => f.poId === viewPO.id);
                return fu ? (
                  <button onClick={() => { setFuModal(fu); setViewPO(null); setFuFreq(1); setFuCustom(""); }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                          style={{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)", borderColor:"rgba(167,139,250,0.5)" }}>
                    🔔 Follow-Up Done
                  </button>
                ) : null;
              })()}
              {["ordered","overdue"].includes(viewPO.status) && canDo("pipeline","receive") && (
                <button onClick={() => { handleReceive(viewPO.id); setViewPO(null); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                        style={{ background:"linear-gradient(135deg,#16a34a,#15803d)", borderColor:"rgba(34,197,94,0.5)" }}>
                  📦 Mark Received
                </button>
              )}
              {viewPO.status === "received" && isSuperAdmin && onReverseReceive && (
                <button onClick={() => { setReverseModal(viewPO.id); setReverseReason(""); setReverseErr(""); }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all"
                        style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", borderColor:"rgba(251,191,36,0.5)" }}
                        title="Super Admin only: reverts stock and PO status">
                  ↩ Reverse Receive
                </button>
              )}
              {viewPO.status === "received" && isSuperAdmin && onDeletePO && (
                <button onClick={() => { if (confirm(`Delete received PO ${viewPO.id}? This will NOT restore stock. Use "Reverse Receive" first if needed.`)) { onDeletePO(viewPO.id); setViewPO(null); } }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-red-400 border transition-all"
                        style={{ background:"rgba(239,68,68,0.1)", borderColor:"rgba(239,68,68,0.35)" }}
                        title="Super Admin only: delete test/incorrect record">
                  🗑️ Delete Record
                </button>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* ── Reverse Receive Modal (Super Admin only) ── */}
      {reverseModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(4,6,12,0.92)", backdropFilter:"blur(12px)" }}
             onClick={e => e.target===e.currentTarget && (setReverseModal(null), setReverseReason(""), setReverseErr(""))}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background:"#0d1018", border:"1px solid rgba(245,158,11,0.4)", boxShadow:"0 40px 80px rgba(0,0,0,0.9)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background:"rgba(245,158,11,0.15)" }}>↩</div>
              <div>
                <div className="text-sm font-black text-white">Reverse Receive</div>
                <div className="text-[10px] text-slate-500 mt-0.5">PO {reverseModal} — Super Admin correction</div>
              </div>
            </div>
            <div className="px-3 py-2.5 rounded-lg text-[10.5px] text-amber-300 leading-relaxed"
                 style={{ background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)" }}>
              ⚠️ This will subtract the received quantities from inventory and revert the PO status. Action will be logged in audit history.
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1.5">Reason <span className="text-red-400">*</span></div>
              <textarea value={reverseReason} onChange={e => { setReverseReason(e.target.value); setReverseErr(""); }} rows={3}
                placeholder="e.g. Received by mistake / Wrong vendor / Test entry…"
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none resize-none" />
              {reverseErr && <div className="text-[10px] text-red-400 mt-1">{reverseErr}</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={() => { setReverseModal(null); setReverseReason(""); setReverseErr(""); }}>Cancel</Btn>
              <button onClick={() => {
                if (!reverseReason.trim()) { setReverseErr("Reason is required"); return; }
                const res = onReverseReceive(reverseModal, reverseReason.trim());
                if (res?.success === false) { setReverseErr(res.error || "Reversal failed"); return; }
                setReverseModal(null); setReverseReason(""); setReverseErr("");
              }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 text-white border transition-all"
                style={{ background:"linear-gradient(135deg,#f59e0b,#d97706)", borderColor:"rgba(251,191,36,0.5)" }}>
                Reverse Receive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ── */}
      {rejectModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(4,6,12,0.92)", backdropFilter:"blur(12px)" }}
             onClick={e => e.target===e.currentTarget && (setRejectModal(null),setRejectReason(""),setRejectErr(false))}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"#0d1018", border:"1px solid rgba(239,68,68,0.4)", boxShadow:"0 40px 80px rgba(0,0,0,0.9)", animation:"slideUp 0.25s ease both" }}>
            <div className="text-sm font-black text-white">❌ Reject PO</div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-1.5">Rejection Reason <span className="text-red-400">*</span></div>
              <textarea value={rejectReason} onChange={e=>{setRejectReason(e.target.value);setRejectErr(false);}} rows={3}
                        placeholder="Enter reason for rejection..."
                        className={`w-full bg-white/[0.04] border rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none resize-none modal-input ${rejectErr?"border-red-500/60":"border-white/[0.08]"}`} />
              {rejectErr && <div className="text-[10px] text-red-400 mt-1">Reason is required</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>{setRejectModal(null);setRejectReason("");setRejectErr(false);}}>Cancel</Btn>
              <Btn variant="red" size="sm" onClick={handleReject}>Confirm Reject</Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Make Order / ETA Modal ── */}
      {moModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(4,6,12,0.92)", backdropFilter:"blur(12px)" }}
             onClick={e=>e.target===e.currentTarget&&(setMoModal(null),setEta(""),setEtaCustom(""))}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"#0d1018", border:"1px solid rgba(59,130,246,0.4)", boxShadow:"0 40px 80px rgba(0,0,0,0.9)", animation:"slideUp 0.25s ease both" }}>
            <div>
              <div className="text-sm font-black text-white">📋 Confirm Order</div>
              <div className="text-[10px] text-slate-500 mt-1">{moModal.id} · {moModal.vendor} · ₹{(moModal.amount||0).toLocaleString("en-IN")}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">ETA — Delivery in <span className="text-red-400">*</span></div>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {[1,3,5,7].map(d=>(
                  <button key={d} onClick={()=>{setEta(String(d));setEtaCustom("");}}
                          className={`py-2 rounded-lg text-xs font-bold border transition-all ${eta===String(d)?"bg-blue-500/25 text-blue-400 border-blue-500/50":"bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.08]"}`}>{d}d</button>
                ))}
              </div>
              <button onClick={()=>setEta("custom")}
                      className={`w-full py-2 rounded-lg text-xs font-bold border transition-all mb-2 ${eta==="custom"?"bg-purple-500/20 text-purple-400 border-purple-500/40":"bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.08]"}`}>
                📅 Custom Date
              </button>
              {eta==="custom" && <input type="date" value={etaCustom} onChange={e=>setEtaCustom(e.target.value)} className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white outline-none modal-input" />}
              {!eta && <div className="text-[10px] text-orange-400 mt-1">Select an ETA to confirm</div>}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>{setMoModal(null);setEta("");setEtaCustom("");}}>Cancel</Btn>
              <button onClick={handleConfirm} disabled={!eta||(eta==="custom"&&!etaCustom)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background:"linear-gradient(135deg,#2563eb,#4f46e5)", borderColor:"rgba(99,130,255,0.5)" }}>
                ✅ Confirm & Start Follow-Up
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Follow-Up Done Modal ── */}
      {fuModal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
             style={{ background:"rgba(4,6,12,0.92)", backdropFilter:"blur(12px)" }}
             onClick={e=>e.target===e.currentTarget&&setFuModal(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background:"#0d1018", border:"1px solid rgba(167,139,250,0.4)", boxShadow:"0 40px 80px rgba(0,0,0,0.9)", animation:"slideUp 0.25s ease both" }}>
            <div>
              <div className="text-sm font-black text-white">✓ Mark Follow-Up Done</div>
              <div className="text-[10px] text-slate-500 mt-1">{fuModal.poId} · {fuModal.vendor}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] mb-2">Next Follow-Up In</div>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {[1,3,5,7].map(d=>(
                  <button key={d} onClick={()=>{setFuFreq(d);setFuCustom("");}}
                          className={`py-2 rounded-lg text-xs font-bold border transition-all ${fuFreq===d&&fuFreq!=="custom"?"bg-purple-500/25 text-purple-400 border-purple-500/50":"bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.08]"}`}>{d}d</button>
                ))}
              </div>
              <button onClick={()=>setFuFreq("custom")}
                      className={`w-full py-2 rounded-lg text-xs font-bold border transition-all mb-2 ${fuFreq==="custom"?"bg-purple-500/20 text-purple-400 border-purple-500/40":"bg-white/[0.04] text-slate-400 border-white/[0.08] hover:bg-white/[0.08]"}`}>
                📅 Custom Date
              </button>
              {fuFreq==="custom" && <input type="date" value={fuCustom} onChange={e=>setFuCustom(e.target.value)} className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-white outline-none modal-input" />}
            </div>
            <div className="flex gap-2">
              <Btn variant="ghost" size="sm" onClick={()=>setFuModal(null)}>Cancel</Btn>
              <button onClick={handleFuDone} disabled={fuFreq==="custom"&&!fuCustom}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-4 py-1.5 text-white border transition-all disabled:opacity-40"
                      style={{ background:"linear-gradient(135deg,#7c3aed,#6d28d9)", borderColor:"rgba(167,139,250,0.5)" }}>
                ✓ Done — Schedule Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Low Stock Order Quantity Modal ── */}
      {qtyModal && (() => {
        const item           = qtyModal.item;
        const shortage       = Math.max(0, item.min - item.stock);
        const recommendedQty = Math.max(item.min * 2 - item.stock, item.min);
        const parsedQty      = Math.max(1, parseInt(qtyInput, 10) || 0);
        const poValue        = parsedQty * (item.lastPurchaseRate || 0);
        return (
          <div className="fixed inset-0 z-[55] flex items-center justify-center p-4"
               style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
               onClick={e => e.target === e.currentTarget && setQtyModal(null)}>
            <div className="w-full max-w-sm rounded-2xl overflow-hidden"
                 style={{ background: "#0d1018", border: "1px solid rgba(99,130,246,0.4)", boxShadow: "0 40px 80px rgba(0,0,0,0.9)", animation: "slideUp 0.25s ease both" }}>
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.08]" style={{ background: "rgba(99,130,246,0.06)" }}>
                <div className="text-sm font-black text-white">🛒 Create Purchase Order</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{item.name} · {item.code}</div>
              </div>
              {/* Stats grid */}
              <div className="px-5 pt-4 grid grid-cols-2 gap-2">
                {[
                  { label: "Current Stock", value: `${item.stock} ${item.unit}`, color: item.status === "critical" ? "#ef4444" : "#f97316" },
                  { label: "Min Stock",     value: `${item.min} ${item.unit}`,   color: "#94a3b8" },
                  { label: "Shortage",      value: `${shortage} ${item.unit}`,   color: "#f97316" },
                  { label: "Recommended",   value: `${recommendedQty} ${item.unit}`, color: "#3b82f6" },
                ].map(s => (
                  <div key={s.label} className="px-3 py-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div className="text-[9px] font-black text-slate-600 uppercase tracking-wider mb-1">{s.label}</div>
                    <div className="text-xs font-bold" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* Qty input */}
              <div className="px-5 pt-4">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Order Quantity <span className="text-red-400">*</span></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setQtyInput(v => String(Math.max(1, (parseInt(v, 10) || 0) - 1)))}
                          className="w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.08] transition-all text-lg font-bold flex items-center justify-center flex-shrink-0">−</button>
                  <input type="number" min="1" value={qtyInput}
                         onChange={e => setQtyInput(e.target.value)}
                         className="flex-1 text-center bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm font-bold text-white outline-none modal-input"
                         style={{ fontVariantNumeric: "tabular-nums" }} />
                  <button onClick={() => setQtyInput(v => String((parseInt(v, 10) || 0) + 1))}
                          className="w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-white/[0.08] transition-all text-lg font-bold flex items-center justify-center flex-shrink-0">+</button>
                </div>
                {item.lastPurchaseRate > 0 && (
                  <div className="mt-2 px-3 py-2 rounded-xl flex justify-between items-center"
                       style={{ background: "rgba(34,197,94,0.05)", border: "1px solid rgba(34,197,94,0.2)" }}>
                    <span className="text-[10px] text-slate-500">Est. PO Value</span>
                    <span className="text-xs font-bold text-green-400">₹{poValue.toLocaleString("en-IN")}</span>
                  </div>
                )}
              </div>
              {/* Footer */}
              <div className="px-5 py-4 flex gap-2">
                <Btn variant="ghost" size="sm" onClick={() => setQtyModal(null)}>Cancel</Btn>
                <button
                  disabled={parsedQty < 1}
                  onClick={() => { openCreatePO(item, parsedQty); setQtyModal(null); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 text-white border transition-all disabled:opacity-40"
                  style={{ background: "linear-gradient(135deg,#2563eb,#4f46e5)", borderColor: "rgba(99,130,255,0.5)" }}>
                  📋 Create PO →
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── INWARD PAGE ──────────────────────────────────────────────────────────────

function InwardPage({ items, handleUpdateStock, vendorList, onInwardComplete, onAddInward, appInwardLog = [], canDo = () => true }) {
  const [vendor,       setVendor]       = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [qty,          setQty]          = useState("");
  const [notes,        setNotes]        = useState("");
  const [toast,        setToast]        = useState(null);
  const [errors,       setErrors]       = useState({});
  const [submitting,   setSubmitting]   = useState(false);

  const allFlatItems = Object.entries(items).flatMap(([cat, list]) =>
    list.map((item) => ({ ...item, category: cat }))
  );
  const selectedItem = allFlatItems.find((i) => i.code === selectedCode);
  const parsedQty    = parseInt(qty, 10);
  const newStock     = selectedItem && parsedQty > 0 ? selectedItem.stock + parsedQty : null;

  const inpCls = (err) =>
    `w-full bg-white/[0.04] border ${err ? "border-red-500/60" : "border-white/[0.08]"} rounded-xl px-4 py-2.5 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "#0b0e17", color: "#f0f6ff" };

  const ILabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#93c5fd" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  const handleSubmit = async () => {
    if (submitting) return;                 // duplicate-inward guard
    const n = parseInt(qty, 10);
    const e = {};
    if (!selectedCode)             e.item = "Select an item";
    if (!n || n <= 0 || isNaN(n)) e.qty  = "Enter a valid quantity";
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      const res = await handleUpdateStock(selectedItem.category, selectedItem.code, n, "Inward");
      if (res && res.success === false) return;   // movement rejected — error toast already shown, don't log a phantom inward
      if (onInwardComplete) onInwardComplete(selectedItem.code, selectedItem.category, n);
      const entry = {
        id: Date.now(), date: fmtDate(new Date()),
        vendor: vendor || "—", item: selectedItem.name,
        code: selectedItem.code, unit: selectedItem.unit, qty: n, notes: notes || "—",
      };
      if (onAddInward) onAddInward(entry);
      setToast(entry);
      setTimeout(() => setToast(null), 3500);
      setSelectedCode(""); setQty(""); setNotes(""); setVendor(""); setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(34,197,94,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📥</span>
          <div>
            <div className="text-xs font-black text-white">+{toast.qty} {toast.unit} — {toast.item}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">From: {toast.vendor}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Inward" subtitle="Goods receipt & stock addition">
        <Btn variant="ghost" size="sm">⬇️ Export Log</Btn>
      </Topbar>

      <div className="p-6 space-y-6">
        {/* ── Entry Form ── */}
        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-6" style={{ animation: "slideUp 0.4s ease both" }}>
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-sm font-extrabold text-white">📥 New Inward Entry</h2>
            <span className="text-[10px] font-bold text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full">GRN</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Vendor */}
            <div>
              <ILabel text="Vendor" />
              <VendorSearchSelect
                vendors={vendorList}
                value={vendor}
                onChange={(name) => setVendor(name)}
                placeholder="Search vendor by name, phone or city…"
              />
            </div>

            {/* Item */}
            <div>
              <ILabel text="Select Item" req />
              <ItemSearchSelect
                items={Object.entries(items).flatMap(([cat, list]) => list.map((it) => ({ ...it, category: cat })))}
                value={selectedCode}
                onChange={setSelectedCode}
                showStock={true}
              />
              {errors.item && <div className="text-[10px] text-red-400 mt-1">{errors.item}</div>}
            </div>

            {/* Qty */}
            <div>
              <ILabel text="Quantity" req />
              <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                     placeholder="Enter quantity" className={inpCls(errors.qty)}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
              {errors.qty && <div className="text-[10px] text-red-400 mt-1">{errors.qty}</div>}
            </div>

            {/* Notes */}
            <div>
              <ILabel text="Notes / Invoice No." />
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                     placeholder="e.g. INV-2026-0421" className={inpCls(false)} />
            </div>
          </div>

          {/* Live preview */}
          {selectedItem && (() => {
            const newS       = parsedQty > 0 ? selectedItem.stock + parsedQty : selectedItem.stock;
            const newStatus  = recomputeStatus(newS, selectedItem.min);
            const statusUp   = newStatus === "safe" && selectedItem.status !== "safe";
            const fillPctNow = selectedItem.min > 0 ? Math.min(100, Math.round((selectedItem.stock / selectedItem.min) * 100)) : 0;
            const fillPctNew = selectedItem.min > 0 ? Math.min(100, Math.round((newS / selectedItem.min) * 100)) : 0;
            const newCfg     = statusConfig[newStatus];
            return (
              <div className="mt-4 rounded-xl overflow-hidden"
                   style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(34,197,94,0.2)" }}>
                {/* Status header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06]"
                     style={{ background: "rgba(34,197,94,0.04)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Stock Preview</span>
                    <span className="text-[10px] font-mono text-slate-500">· {selectedItem.code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedItem.status} />
                    {parsedQty > 0 && newStatus !== selectedItem.status && (
                      <>
                        <span className="text-slate-600 text-xs">→</span>
                        <StatusBadge status={newStatus} />
                        {statusUp && <span className="text-[10px] font-bold text-green-400">▲ Status improved!</span>}
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-0 divide-x divide-white/[0.06]">
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Current Stock</div>
                    <div className={`text-xl font-black font-mono ${statusConfig[selectedItem.status].text}`}
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      {selectedItem.stock} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                    <div className="mt-2 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${fillPctNow}%`, background: statusConfig[selectedItem.status].dot || "#3b82f6" }} />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1">Min: {selectedItem.min} {selectedItem.unit}</div>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Adding</div>
                    <div className="text-xl font-black font-mono text-green-400"
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      +{parsedQty > 0 ? parsedQty : 0} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">After Inward</div>
                    <div className={`text-xl font-black font-mono ${newCfg.text}`}
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                      {newS} <span className="text-xs text-slate-500">{selectedItem.unit}</span>
                    </div>
                    <div className="mt-2 h-1 bg-white/[0.05] rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fillPctNew}%`, background: newCfg.dot || "#3b82f6" }} />
                    </div>
                    <div className="text-[9px] text-slate-600 mt-1">{fillPctNew}% of min level</div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setSelectedCode(""); setQty(""); setNotes(""); setVendor(""); setErrors({}); }}>Clear</Btn>
            {canDo("inward","submit") && (
              <button onClick={handleSubmit} disabled={submitting}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", borderColor: "rgba(34,197,94,0.5)", boxShadow: "0 0 16px rgba(34,197,94,0.3)" }}>
                {submitting ? "⏳ Submitting…" : "📥 Submit Inward"}
              </button>
            )}
          </div>
        </div>

        {/* ── Log ── */}
        {appInwardLog.length > 0 && (() => {
          const combined = [...appInwardLog].sort((a, b) => b.id - a.id);
          return (
            <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5" style={{ animation: "slideUp 0.4s ease both" }}>
              <div className="flex items-center gap-2 mb-4">
                <SectionHeader>📋 Inward Log</SectionHeader>
                {combined.filter(e => e.fromPO).length > 0 && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                    {combined.filter(e => e.fromPO).length} auto-received
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {["Date","Vendor","Code","Item","Qty","Notes"].map((h) => (
                        <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {combined.map((entry) => (
                      <tr key={entry.id} className={`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors ${entry.fromPO ? "bg-green-500/[0.02]" : ""}`}>
                        <td className="px-4 py-2 text-[10px] text-slate-500 font-mono">{entry.date}</td>
                        <td className="px-4 py-2 text-[10px] text-slate-400">
                          {entry.vendor}
                          {entry.fromPO && <span className="ml-1.5 text-[8px] font-bold text-green-500 bg-green-500/10 border border-green-500/20 px-1 py-0.5 rounded">AUTO</span>}
                        </td>
                        <td className="px-4 py-2 text-[10px] font-mono font-bold text-blue-400">{entry.code}</td>
                        <td className="px-4 py-2 text-[10px] text-white">{entry.item}</td>
                        <td className="px-4 py-2 text-[10px] font-bold font-mono text-green-400">+{entry.qty} {entry.unit}</td>
                        <td className="px-4 py-2 text-[10px] text-slate-500">{entry.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── BOM DRAWER ───────────────────────────────────────────────────────────────

function BOMDrawer({ bomKey, bom, units, onUnitsChange, items, handleUpdateStock, onClose, onIssue, onUpdateBOM, onRenameBOM, allBomKeys = [], onAfterRename, serialNo = "" }) {
  const [search,       setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [catCollapsed, setCatCollapsed] = useState({});
  const [issueQtys,    setIssueQtys]    = useState({});
  const [checked,      setChecked]      = useState({});
  const [editMode,     setEditMode]     = useState(false);
  const [editItems,    setEditItems]    = useState(() => bom.items.map((i) => ({ ...i })));
  const [editRackCap,  setEditRackCap]  = useState(() => bom.rackCapacity ?? 0);
  const [editKey,      setEditKey]      = useState(bomKey);
  const [editLabel,    setEditLabel]    = useState(bom.label || "");
  const [renameErr,    setRenameErr]    = useState("");
  const [issuing,      setIssuing]      = useState(false);
  const [addCode,      setAddCode]      = useState("");
  const [addBaseQty,   setAddBaseQty]   = useState("1");
  const [addErr,       setAddErr]       = useState("");
  const [issueNote,    setIssueNote]    = useState("");
  const [confirmIssue, setConfirmIssue] = useState(false);

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findInv  = (code) => allFlat.find((i) => i.code === code);
  const selStyle = { background: "#0b0e17", color: "#f0f6ff" };

  const sourceItems = editMode ? editItems : bom.items;

  const enriched = sourceItems.map(({ code, qty }) => {
    const inv      = findInv(code);
    const required = qty * units;
    const available = inv?.stock ?? 0;
    const maxIssue  = Math.min(required, available);
    const userQty   = issueQtys[code];
    const issueQty  = userQty !== undefined ? Math.max(0, Math.min(userQty, available)) : maxIssue;
    const pendingQty = Math.max(0, required - issueQty);
    const overQty    = Math.max(0, issueQty - required);
    const status    = available >= required ? "green" : available > 0 ? "orange" : "red";
    return { code, baseQty: qty, required, available, issueQty, pendingQty, overQty, status,
             name: inv?.name || code, unit: inv?.unit || "—", category: inv?.category || "Other", inv };
  });

  const isItemChecked = (code) => checked[code] !== false;

  const filtered = enriched.filter(({ name, code, status }) => {
    const q = search.toLowerCase();
    return (!q || name.toLowerCase().includes(q) || code.toLowerCase().includes(q)) &&
           (filterStatus === "all" || status === filterStatus);
  });

  const categories = [...new Set(filtered.map((i) => i.category))].sort();

  const checkedE   = enriched.filter((i) => isItemChecked(i.code));
  const readyN     = enriched.filter((i) => i.status === "green").length;
  const partialN   = enriched.filter((i) => i.status === "orange").length;
  const missingN   = enriched.filter((i) => i.status === "red").length;
  const totalIssuing   = checkedE.reduce((s, i) => s + i.issueQty, 0);
  const totalPending   = checkedE.reduce((s, i) => s + i.pendingQty, 0);
  const totalOverIssue = checkedE.reduce((s, i) => s + (i.overQty || 0), 0);
  const hasOverIssue   = checkedE.some((i) => (i.overQty || 0) > 0);
  const canSubmit      = checkedE.some((i) => i.issueQty > 0);

  const SC = { green: "#22c55e", orange: "#f97316", red: "#ef4444" };
  const SB = { green: "rgba(34,197,94,0.1)", orange: "rgba(249,115,22,0.1)", red: "rgba(239,68,68,0.1)" };
  const SL = { green: "Available", orange: "Partial", red: "Missing" };

  // Panel split: Electrical → right, everything else → left
  const leftCats  = categories.filter((c) => c !== "Electrical");
  const rightCats = categories.filter((c) => c === "Electrical");

  const colHeader = (
    <div className="sticky top-0 z-10 grid gap-0 px-6 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-[0.16em]"
         style={{ gridTemplateColumns: "28px 1fr 72px 72px 80px 72px", background: "#08090e", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div /><div>Item / Code</div>
      <div className="text-right">Have</div>
      <div className="text-right">Need</div>
      <div className="text-right pr-2">Issue</div>
      <div className="text-right pr-4">Pending</div>
    </div>
  );

  const renderCategory = (cat) => {
    const catItems  = filtered.filter((i) => i.category === cat);
    if (!catItems.length) return null;
    const collapsed = catCollapsed[cat];
    const cReady    = catItems.filter((i) => i.status === "green").length;
    const cPartial  = catItems.filter((i) => i.status === "orange").length;
    const cMissing  = catItems.filter((i) => i.status === "red").length;
    return (
      <div key={cat}>
        <button onClick={() => setCatCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                className="w-full flex items-center gap-3 px-6 py-2 hover:bg-white/[0.02] transition-colors"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
          <span className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.08em] w-28 text-left">{cat}</span>
          <div className="flex gap-1.5">
            {cReady   > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(34,197,94,0.1)",  color:"#4ade80",  border:"1px solid rgba(34,197,94,0.2)"  }}>{cReady}✓</span>}
            {cPartial > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(249,115,22,0.1)", color:"#fb923c", border:"1px solid rgba(249,115,22,0.2)" }}>{cPartial}~</span>}
            {cMissing > 0 && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background:"rgba(239,68,68,0.1)",  color:"#f87171",  border:"1px solid rgba(239,68,68,0.2)"  }}>{cMissing}✗</span>}
          </div>
          <span className="ml-auto text-[10px] text-slate-600">{collapsed ? "▶" : "▼"} {catItems.length} items</span>
        </button>
        {!collapsed && catItems.map((item) => {
          const rowChecked = isItemChecked(item.code);
          const sc = SC[item.status];
          const partialFill = item.available > 0 && item.available < item.required ? (item.available / item.required) * 100 : 0;
          return (
            <div key={item.code}
                 className={`grid gap-0 items-center px-6 py-2 border-b border-white/[0.03] transition-all hover:bg-white/[0.015] ${!rowChecked ? "opacity-35" : ""}`}
                 style={{ gridTemplateColumns: "28px 1fr 72px 72px 80px 72px", background: rowChecked && item.status !== "green" ? `${sc}07` : "" }}>
              <div><input type="checkbox" checked={rowChecked} onChange={(e) => setChecked((p) => ({ ...p, [item.code]: e.target.checked }))} className="accent-blue-500 w-3.5 h-3.5" /></div>
              <div className="min-w-0 pr-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: sc }} />
                  <span className="text-[11px] font-semibold text-white truncate">{item.name}</span>
                </div>
                <div className="flex items-center gap-2 pl-3 mt-0.5">
                  <span className="text-[9px] font-mono text-slate-600">{item.code}</span>
                  {partialFill > 0 && (
                    <div className="flex-1 h-1 bg-white/[0.05] rounded-full overflow-hidden max-w-[60px]">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, partialFill)}%`, background: sc }} />
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold font-mono" style={{ color: sc, fontFamily:"'Inter',system-ui,sans-serif" }}>{item.available}</span>
                <div className="text-[9px] text-slate-600">{item.unit}</div>
              </div>
              <div className="text-right">
                <span className="text-[11px] font-bold font-mono text-slate-300" style={{ fontFamily:"'Inter',system-ui,sans-serif" }}>{item.required}</span>
                <div className="text-[9px] text-slate-600">{item.unit}</div>
              </div>
              <div className="flex justify-end pr-2">
                <input type="number" min="0" max={item.available} value={item.issueQty}
                       onChange={(e) => setIssueQtys((p) => ({ ...p, [item.code]: Math.min(item.available, Math.max(0, parseInt(e.target.value,10)||0)) }))}
                       disabled={!rowChecked}
                       className="w-[58px] bg-white/[0.04] border rounded-lg px-2 py-1 text-xs text-white outline-none text-right modal-input disabled:opacity-30 transition-colors"
                       style={{ fontFamily:"'Inter',system-ui,sans-serif", borderColor: rowChecked && item.overQty > 0 ? "rgba(251,191,36,0.55)" : rowChecked && item.issueQty < item.required ? "rgba(249,115,22,0.45)" : "rgba(255,255,255,0.08)" }} />
              </div>
              <div className="text-right pr-4">
                {item.overQty > 0
                  ? <><span className="text-[11px] font-bold font-mono" style={{color:"#fbbf24",fontFamily:"'Inter',system-ui,sans-serif"}}>+{item.overQty}</span><div className="text-[9px] font-bold" style={{color:"#d97706"}}>over</div></>
                  : item.pendingQty > 0
                    ? <><span className="text-[11px] font-bold font-mono text-orange-400" style={{fontFamily:"'Inter',system-ui,sans-serif"}}>{item.pendingQty}</span><div className="text-[9px] text-slate-600">{item.unit}</div></>
                    : <span className="text-[10px] text-green-400 font-bold">✓</span>
                }
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const doIssue = () => {
    if (issuing) return;                    // duplicate production-issue guard
    setIssuing(true);
    const issued = []; const pending = [];
    checkedE.forEach((item) => {
      if (item.issueQty > 0 && item.inv)
        handleUpdateStock(item.inv.category, item.code, -item.issueQty, `BOM: ${bomKey}`);
      if (item.issueQty > 0) issued.push({ ...item });
      if (item.pendingQty > 0) pending.push({ ...item });
    });
    onIssue({ bomKey, label: bom.label, units, issued, pending, note: issueNote, date: fmtDate(new Date()), serialNo });
    onClose();
  };

  const addItemToBOM = () => {
    const inv = findInv(addCode); const qty = parseFloat(addBaseQty);
    if (!inv)           { setAddErr("Select a valid item"); return; }
    if (!qty || qty<=0) { setAddErr("Enter valid quantity"); return; }
    if (editItems.some((i) => i.code === addCode)) { setAddErr("Item already in BOM"); return; }
    setAddErr(""); setEditItems((p) => [...p, { code: addCode, qty }]);
    setAddCode(""); setAddBaseQty("1");
  };

  const saveBOMEdit = () => {
    setRenameErr("");
    const newKey   = (editKey || "").trim().toUpperCase().replace(/\s+/g, "-");
    const newLabel = (editLabel || "").trim();
    if (!newKey)   { setRenameErr("BOM Key is required"); return; }
    if (!newLabel) { setRenameErr("Machine Model Name is required"); return; }
    if (newKey !== bomKey && allBomKeys.some((k) => k === newKey)) {
      setRenameErr("A BOM with this key already exists"); return;
    }
    // First save items + rack capacity under the existing key
    onUpdateBOM(bomKey, {
      ...bom,
      items: editItems.filter((i) => i.qty > 0),
      rackCapacity: Math.max(0, parseInt(editRackCap, 10) || 0),
    });
    // Then rename if key or label changed
    if ((newKey !== bomKey || newLabel !== bom.label) && onRenameBOM) {
      const res = onRenameBOM(bomKey, newKey, newLabel);
      if (res?.success === false) { setRenameErr(res.error || "Rename failed"); return; }
      if (newKey !== bomKey && onAfterRename) onAfterRename(newKey);
    }
    setEditMode(false);
  };

  const resetEditState = () => {
    setEditItems(bom.items.map((i) => ({ ...i })));
    setEditRackCap(bom.rackCapacity ?? 0);
    setEditKey(bomKey);
    setEditLabel(bom.label || "");
    setRenameErr("");
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col" style={{ background: "#07090e" }}>

      {/* ── Header ── */}
      <div className="flex-shrink-0" style={{ background: "linear-gradient(180deg,#0c1018,#090c14)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
               style={{ background: bom.color + "22", border: `1px solid ${bom.color}55` }}>{bomKey}</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black text-white">{bomKey} — {bom.label}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {serialNo && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(59,130,246,0.12)", color:"#93c5fd", border:"1px solid rgba(59,130,246,0.25)" }}>S/N: {serialNo}</span>
              )}
              <span className="text-[10px] text-slate-500">{enriched.length} components</span>
              {readyN > 0   && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.12)",  color: "#4ade80",  border: "1px solid rgba(34,197,94,0.22)"  }}>{readyN} ready</span>}
              {partialN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(249,115,22,0.12)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.22)" }}>{partialN} partial</span>}
              {missingN > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(239,68,68,0.12)",  color: "#f87171",  border: "1px solid rgba(239,68,68,0.22)"  }}>{missingN} missing</span>}
            </div>
          </div>

          {/* Units stepper */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span className="text-[10px] text-slate-400 mr-1">Units</span>
            <button onClick={() => onUnitsChange(Math.max(1, units - 1))} className="w-6 h-6 rounded text-sm font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all">−</button>
            <span className="text-sm font-black text-white w-8 text-center font-mono" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>{units}</span>
            <button onClick={() => onUnitsChange(units + 1)} className="w-6 h-6 rounded text-sm font-bold text-slate-400 hover:text-white hover:bg-white/10 transition-all">+</button>
          </div>

          <button onClick={() => { if (editMode) { setEditMode(false); resetEditState(); } else { resetEditState(); setEditMode(true); } }}
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${editMode ? "bg-orange-500/10 text-orange-400 border-orange-500/30" : "bg-white/[0.04] text-slate-400 border-white/[0.1] hover:text-white"}`}>
            {editMode ? "✕ Cancel" : "✏️ Edit BOM"}
          </button>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-[11px] font-bold px-3 py-1.5 rounded-lg hover:bg-white/[0.05] border border-white/[0.06] transition-all">✕ Close</button>
        </div>

        {/* Search + filter bar */}
        {!editMode && (
          <div className="flex items-center gap-2 px-6 pb-4 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs">🔍</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items, codes..."
                     className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500/30" />
            </div>
            {["all","green","orange","red"].map((f) => (
              <button key={f} onClick={() => setFilterStatus(f)}
                      className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-all"
                      style={ filterStatus === f
                        ? { background: f === "all" ? "rgba(59,130,246,0.15)" : SB[f], borderColor: f === "all" ? "rgba(59,130,246,0.4)" : SC[f] + "55", color: f === "all" ? "#60a5fa" : SC[f] }
                        : { background: "transparent", borderColor: "rgba(255,255,255,0.06)", color: "#64748b" } }>
                {f === "all" ? `All (${enriched.length})` : `${SL[f]} (${enriched.filter(i=>i.status===f).length})`}
              </button>
            ))}
            <button onClick={() => { const all = {}; enriched.forEach(i => { all[i.code] = true; }); setChecked(all); }} className="text-[10px] text-blue-400 font-bold px-2 py-1.5 hover:text-blue-300 transition-all">✓ All</button>
            <button onClick={() => setChecked({})} className="text-[10px] text-slate-500 font-bold px-2 py-1.5 hover:text-slate-300 transition-all">✗ None</button>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {editMode ? (
          /* ── Edit Mode — full width, unchanged ── */
          <div className="flex-1 overflow-y-auto"><div className="p-6 space-y-4 max-w-3xl">
            <div className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3">
              ✏️ Edit Mode — Modify items, quantities, then Save BOM to apply changes permanently.
            </div>

            {/* Rename — BOM Key + Machine Model Name */}
            <div className="rounded-xl p-4" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.22)" }}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">✏️</span>
                <div className="text-[11px] font-bold text-white">BOM Identity</div>
                <span className="text-[9px] text-purple-300 px-1.5 py-0.5 rounded-full" style={{ background: "rgba(139,92,246,0.15)" }}>Rename safe</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-medium text-purple-200 mb-1.5">BOM Key</div>
                  <input value={editKey} onChange={(e) => { setEditKey(e.target.value.toUpperCase()); setRenameErr(""); }}
                    placeholder="e.g. KM-10"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white font-mono outline-none modal-input" />
                </div>
                <div>
                  <div className="text-[10px] font-medium text-purple-200 mb-1.5">Machine Model Name</div>
                  <input value={editLabel} onChange={(e) => { setEditLabel(e.target.value); setRenameErr(""); }}
                    placeholder="e.g. Kneading Machine 10L"
                    className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white outline-none modal-input" />
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                Renaming updates Machine Tracker, Outward log and Pending entries to match. Existing audit history is preserved.
              </div>
              {renameErr && <div className="text-[10px] text-red-400 mt-2">⚠ {renameErr}</div>}
            </div>

            {/* Rack Assignment + Capacity */}
            <div className="rounded-xl p-4" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.2)" }}>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-lg">📦</span>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-[11px] font-bold text-white">Production Rack</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Rack ID: <span className="font-mono text-slate-300">{bomKey}</span> · Used by Machine Tracker → Rack View</div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Rack Capacity</label>
                  <input type="number" min="0" step="1" value={editRackCap}
                         onChange={(e) => setEditRackCap(e.target.value)}
                         placeholder="0"
                         className="w-24 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-bold text-white outline-none text-right modal-input"
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                  <span className="text-[10px] text-slate-500">slots</span>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 mt-2">
                Set to <span className="text-slate-300 font-bold">0</span> if this model doesn't use a rack. Replenishment alerts fire when Ready &lt; Capacity.
              </div>
            </div>

            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="grid gap-0 px-4 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wide"
                   style={{ gridTemplateColumns: "1fr 100px 120px 60px", background: "rgba(255,255,255,0.02)" }}>
                <div>Item</div><div className="text-center">Category</div><div className="text-center">Qty / Unit</div><div />
              </div>
              {editItems.map((ei, idx) => {
                const inv = findInv(ei.code);
                return (
                  <div key={ei.code} className={`grid gap-0 items-center px-4 py-3 hover:bg-white/[0.02] ${idx > 0 ? "border-t border-white/[0.04]" : ""}`}
                       style={{ gridTemplateColumns: "1fr 100px 120px 60px" }}>
                    <div>
                      <div className="text-[11px] font-semibold text-white">{inv?.name || ei.code}</div>
                      <div className="text-[9px] font-mono text-slate-600">{ei.code}</div>
                    </div>
                    <div className="text-[10px] text-slate-500 text-center">{inv?.category || "—"}</div>
                    <div className="flex items-center gap-1.5 justify-center">
                      <input type="number" min="0.1" step="0.1" value={ei.qty}
                             onChange={(e) => setEditItems((p) => p.map((i) => i.code === ei.code ? { ...i, qty: parseFloat(e.target.value) || 0 } : i))}
                             className="w-16 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-xs text-white outline-none text-right modal-input"
                             style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                      <span className="text-[9px] text-slate-600">{inv?.unit || ""}</span>
                    </div>
                    <div className="flex justify-center">
                      <button onClick={() => setEditItems((p) => p.filter((i) => i.code !== ei.code))}
                              className="text-red-400 hover:text-red-300 text-[10px] font-bold px-2 py-1 rounded hover:bg-red-500/10 transition-all">✕</button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add item */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)" }}>
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-3">+ Add Component</div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <ItemSearchSelect
                    items={allFlat}
                    value={addCode}
                    onChange={setAddCode}
                    excludeCodes={editItems.map((e) => e.code)}
                    placeholder="Search inventory item by name or code…"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0.1" step="0.1" value={addBaseQty} onChange={(e) => setAddBaseQty(e.target.value)}
                         placeholder="Qty" className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none modal-input"
                         style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                  <button onClick={addItemToBOM} className="px-4 py-2 rounded-lg text-xs font-bold text-white"
                          style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", boxShadow: "0 0 14px rgba(37,99,235,0.3)" }}>Add</button>
                </div>
              </div>
              {addErr && <div className="text-[10px] text-red-400 mt-2">⚠ {addErr}</div>}
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setEditMode(false); resetEditState(); }}
                      className="text-xs font-bold text-slate-400 px-5 py-2.5 rounded-xl border border-white/[0.08] hover:text-white hover:border-white/20 transition-all">Discard Changes</button>
              <button onClick={saveBOMEdit}
                      className="text-xs font-black text-white px-8 py-2.5 rounded-xl transition-all"
                      style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.3)" }}>✓ Save BOM</button>
            </div>
          </div></div>

        ) : categories.length === 0 ? (
          <div className="flex-1 py-20 text-center text-slate-600 text-sm">No items match your search or filter.</div>
        ) : (
          /* ── Issue Mode — two-panel layout ── */
          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* LEFT: Mechanical, In-House, and any other non-Electrical categories */}
            <div className="flex-1 overflow-y-auto min-w-0" style={{ borderRight: "1px solid rgba(255,255,255,0.04)" }}>
              {colHeader}
              {leftCats.length > 0 ? leftCats.map(renderCategory) : (
                <div className="py-10 text-center text-slate-600 text-xs">No items</div>
              )}
            </div>
            {/* RIGHT: Electrical */}
            {rightCats.length > 0 && (
              <div className="flex-1 overflow-y-auto min-w-0">
                {colHeader}
                {rightCats.map(renderCategory)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Sticky summary bar ── */}
      {!editMode && (
        <div className="flex-shrink-0" style={{ background: "linear-gradient(0deg,#0a0c14,#0c1018)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="px-6 pt-3">
            <input value={issueNote} onChange={(e) => setIssueNote(e.target.value)}
                   placeholder="Issue reference / note (optional)..."
                   className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg px-4 py-2 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500/30" />
          </div>
          {confirmIssue && hasOverIssue && (
            <div className="mx-6 mt-2 px-4 py-2.5 rounded-xl" style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.28)" }}>
              <div className="text-[10px] font-black mb-1.5" style={{color:"#fbbf24"}}>⚠ Over-Issue Warning — issuing more than BOM requires:</div>
              <div className="flex flex-wrap gap-3">
                {checkedE.filter((i) => i.overQty > 0).map((i) => (
                  <span key={i.code} className="text-[9px] font-bold font-mono" style={{color:"#fbbf24"}}>
                    {i.name}: +{i.overQty} {i.unit} extra
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 px-6 py-3 flex-wrap">
            {/* Pills */}
            <div className="flex items-center gap-3 flex-1 flex-wrap text-[11px]">
              <span className="text-slate-500"><span className="font-black text-white">{checkedE.length}</span> selected</span>
              <span className="text-slate-700">·</span>
              <span className="text-slate-400">Issuing <span className="font-black text-green-400">{totalIssuing}</span> units</span>
              {totalPending > 0 && (
                <><span className="text-slate-700">·</span>
                <span className="font-bold text-orange-400">⚠ {totalPending} units pending</span></>
              )}
              {hasOverIssue && (
                <><span className="text-slate-700">·</span>
                <span className="font-bold" style={{color:"#fbbf24"}}>⚠ {totalOverIssue} over-issued</span></>
              )}
              {missingN > 0 && (
                <><span className="text-slate-700">·</span>
                <span className="text-red-400 font-bold">{missingN} items fully missing</span></>
              )}
            </div>
            <button onClick={onClose} className="text-xs font-bold text-slate-500 px-4 py-2.5 rounded-xl border border-white/[0.08] hover:text-white hover:border-white/20 transition-all">Cancel</button>
            {!confirmIssue ? (
              <button onClick={() => setConfirmIssue(true)} disabled={!canSubmit}
                      className="text-xs font-black text-white px-6 py-2.5 rounded-xl border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ background: canSubmit ? `linear-gradient(135deg,${bom.color}dd,${bom.color}99)` : "#1f2937", boxShadow: canSubmit ? `0 0 18px ${bom.color}35` : "none", borderColor: `${bom.color}55` }}>
                📤 Issue Stock
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {hasOverIssue
                  ? <span className="text-[10px] font-bold" style={{color:"#fbbf24"}}>⚠ Confirm over-issue?</span>
                  : <span className="text-[10px] font-bold text-orange-400">Confirm issue?</span>
                }
                <button onClick={() => setConfirmIssue(false)} className="text-xs font-bold text-slate-500 px-3 py-2 rounded-lg border border-white/[0.08] hover:text-white transition-all">No</button>
                <button onClick={doIssue} disabled={issuing} className="text-xs font-black text-white px-5 py-2 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: hasOverIssue ? "linear-gradient(135deg,#d97706,#b45309)" : "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: hasOverIssue ? "0 0 14px rgba(217,119,6,0.4)" : "0 0 14px rgba(34,197,94,0.3)" }}>
                  {issuing ? "⏳ Issuing…" : hasOverIssue ? "⚠ Confirm Over-Issue" : "✓ Confirm Issue"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── OUTWARD PAGE ─────────────────────────────────────────────────────────────

function OutwardPage({ items, handleUpdateStock, bomDefs, onUpdateBOM, onCreateBOM, onRenameBOM, outwardLog, onAddOutward, pendingLog, onClearPending, onCreateMachine, machineLog = [], canDo = () => true }) {
  const [openBOM,       setOpenBOM]       = useState(null);
  const [activeSerial,  setActiveSerial]  = useState("");
  const [serialModal,   setSerialModal]   = useState(null); // bomKey waiting for S/N
  const [pendingSerial, setPendingSerial] = useState("");
  const [serialErr,     setSerialErr]     = useState("");
  const [bomUnits,      setBomUnits]      = useState({});
  const [manualCode,    setManualCode]    = useState("");
  const [manualQty,     setManualQty]     = useState("");
  const [manualDept,    setManualDept]    = useState("");
  const [manualNotes,   setManualNotes]   = useState("");
  const [manualError,   setManualError]   = useState("");
  const [manualBusy,    setManualBusy]    = useState(false);
  const [toast,         setToast]         = useState(null);
  // Create BOM modal state
  const [showCreate,    setShowCreate]    = useState(false);
  const [createForm,    setCreateForm]    = useState({ key: "", label: "", rackCapacity: "0" });
  const [createItems,   setCreateItems]   = useState([]); // [{ code, qty }]
  const [createAddCode, setCreateAddCode] = useState("");
  const [createAddQty,  setCreateAddQty]  = useState("1");
  const [createErr,     setCreateErr]     = useState("");

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findItem = (code) => allFlat.find((i) => i.code === code);
  const findCat  = (code) => findItem(code)?.category;

  const showToast = (text, sub) => { setToast({ text, sub }); setTimeout(() => setToast(null), 3500); };

  const inpCls  = `w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input`;
  const selStyle = { background: "#0b0e17", color: "#f0f6ff" };

  const OLabel = ({ text, req }) => (
    <div className="text-[11px] font-medium tracking-tight mb-1.5"
         style={{ color: "#93c5fd" }}>
      {text}{req && <span className="text-red-400 ml-0.5">*</span>}
    </div>
  );

  // Current rack occupancy for a model = machines still waiting at the "BOM Issued" stage.
  const rackReadyCount = (key) => machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued").length;

  const confirmSerial = () => {
    const sn = pendingSerial.trim();
    if (!sn) { setSerialErr("Serial number is required to proceed."); return; }
    const key = serialModal;
    const capacity = Number(bomDefs?.[key]?.rackCapacity) || 0;
    const ready    = rackReadyCount(key);
    // Capacity rule: a configured rack (capacity > 0) cannot overflow.
    if (capacity > 0 && ready >= capacity) {
      setSerialErr("Rack capacity reached. Start production or increase rack capacity.");
      return;
    }
    // Block duplicate serials sitting on the rack for this model.
    if (machineLog.some((m) => m.bomKey === key && m.stage === "BOM Issued" && (m.serialNo || "").toLowerCase() === sn.toLowerCase())) {
      setSerialErr(`Serial "${sn}" is already on the rack for ${key}.`);
      return;
    }
    setActiveSerial(sn);
    setOpenBOM(serialModal);
    setSerialModal(null);
    setSerialErr("");
  };

  const handleBOMIssue = (data) => {
    const id  = Date.now();
    const entry = {
      id, type: "bom", date: data.date,
      ref: data.bomKey, label: data.label, units: data.units,
      note: data.note || "—", items: data.issued,
      serialNo: data.serialNo,
    };
    onAddOutward(entry, data.pending);
    if (data.serialNo && onCreateMachine) {
      onCreateMachine(data.bomKey, data.label, data.serialNo, data.date, id);
    }
    showToast(`${data.bomKey} × ${data.units} issued`, data.serialNo ? `S/N: ${data.serialNo}` : data.label);
    setActiveSerial("");
  };

  const handleManualSubmit = async () => {
    if (manualBusy) return;                 // duplicate production-issue guard
    const n   = parseInt(manualQty, 10);
    const inv = findItem(manualCode);
    if (!inv || !n || n <= 0) { setManualError("Select an item and enter a valid quantity."); return; }
    if (inv.stock < n)        { setManualError(`Insufficient stock. Available: ${inv.stock} ${inv.unit}.`); return; }
    setManualError("");
    setManualBusy(true);
    try {
      const res = await handleUpdateStock(findCat(manualCode), manualCode, -n, "Manual Out");
      if (res && res.success === false) return;   // movement rejected — don't log a phantom outward
      const entry = {
        id: Date.now(), type: "manual", date: fmtDate(new Date()),
        ref: "MANUAL", label: "Manual Outward",
        note: manualNotes || "—", dept: manualDept || "—",
        items: [{ code: manualCode, name: inv.name, unit: inv.unit, issueQty: n, pendingQty: 0 }],
      };
      onAddOutward(entry, []);
      showToast(`Issued: ${n} ${inv.unit} of ${inv.name}`, manualDept || "Manual");
      setManualCode(""); setManualQty(""); setManualDept(""); setManualNotes("");
    } finally {
      setManualBusy(false);
    }
  };

  const boms = Object.entries(bomDefs || {});

  // ── Create BOM helpers ──
  const openCreateBOM = () => {
    setCreateForm({ key: "", label: "", rackCapacity: "0" });
    setCreateItems([]);
    setCreateAddCode("");
    setCreateAddQty("1");
    setCreateErr("");
    setShowCreate(true);
  };
  const addCreateItem = () => {
    const qty = parseFloat(createAddQty);
    if (!createAddCode) { setCreateErr("Select a component to add"); return; }
    if (!qty || qty <= 0) { setCreateErr("Enter a valid quantity"); return; }
    if (createItems.some((i) => i.code === createAddCode)) { setCreateErr("Component already added"); return; }
    setCreateItems((p) => [...p, { code: createAddCode, qty }]);
    setCreateAddCode(""); setCreateAddQty("1"); setCreateErr("");
  };
  const removeCreateItem = (code) => setCreateItems((p) => p.filter((i) => i.code !== code));
  const submitCreateBOM = () => {
    if (!createForm.key.trim()) { setCreateErr("BOM Key is required"); return; }
    if (!createForm.label.trim()) { setCreateErr("Machine Model Name is required"); return; }
    if (createItems.length === 0) { setCreateErr("Add at least one component"); return; }
    const res = onCreateBOM(createForm.key.trim().toUpperCase().replace(/\s+/g, "-"), {
      label: createForm.label,
      items: createItems,
      rackCapacity: createForm.rackCapacity,
    });
    if (res?.success === false) { setCreateErr(res.error); return; }
    showToast(`BOM Created: ${createForm.key.trim().toUpperCase()}`, createForm.label);
    setShowCreate(false);
  };

  return (
    <div className="flex-1 overflow-y-auto">

      {/* Serial Number Modal */}
      {serialModal && bomDefs?.[serialModal] && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}>
          <div className="bg-[#0c1018] rounded-2xl w-full max-w-md mx-4 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)", animation: "slideUp 0.25s ease both" }}>
            <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                     style={{ background: bomDefs[serialModal].color + "22", border: `1px solid ${bomDefs[serialModal].color}55` }}>
                  {serialModal}
                </div>
                <div>
                  <div className="text-sm font-bold text-white">{serialModal} — {bomDefs[serialModal].label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Enter serial to issue to rack · Rack {rackReadyCount(serialModal)}{(Number(bomDefs[serialModal].rackCapacity) || 0) > 0 ? ` / ${Number(bomDefs[serialModal].rackCapacity)}` : ""} ready
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <div className="text-[11px] font-medium text-blue-300 mb-2">Serial Number <span className="text-red-400">*</span></div>
                <input
                  autoFocus
                  value={pendingSerial}
                  onChange={(e) => { setPendingSerial(e.target.value); setSerialErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && confirmSerial()}
                  placeholder="e.g. SHT-KM10-2024-001"
                  className="w-full bg-white/[0.04] border rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                  style={{ borderColor: serialErr ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)", fontFamily: "'Inter',system-ui,sans-serif" }}
                />
                {serialErr && <div className="text-[11px] text-red-400 mt-1.5">{serialErr}</div>}
                <div className="text-[10px] text-slate-600 mt-1.5">This serial number will track the machine through all production stages.</div>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setSerialModal(null); setPendingSerial(""); setSerialErr(""); }}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-slate-400 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all">
                  Cancel
                </button>
                <button onClick={confirmSerial}
                        className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                        style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", boxShadow: "0 0 20px rgba(37,99,235,0.3)" }}>
                  Proceed to Issue →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BOMDrawer overlay */}
      {openBOM && bomDefs?.[openBOM] && (
        <BOMDrawer
          bomKey={openBOM}
          bom={bomDefs[openBOM]}
          units={bomUnits[openBOM] || 1}
          onUnitsChange={(n) => setBomUnits((p) => ({ ...p, [openBOM]: n }))}
          items={items}
          handleUpdateStock={handleUpdateStock}
          onClose={() => { setOpenBOM(null); setActiveSerial(""); }}
          onIssue={handleBOMIssue}
          onUpdateBOM={onUpdateBOM}
          onRenameBOM={onRenameBOM}
          allBomKeys={Object.keys(bomDefs || {})}
          onAfterRename={(newKey) => setOpenBOM(newKey)}
          serialNo={activeSerial}
        />
      )}

      {/* Create BOM Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }}
             onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="bg-[#0c1018] rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col"
               style={{ border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)", maxHeight: "90vh", animation: "slideUp 0.25s ease both" }}>
            <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base" style={{ background: "rgba(59,130,246,0.15)" }}>📋</div>
                <div>
                  <div className="text-sm font-black text-white">Create New BOM</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Define a new machine model with components and rack capacity</div>
                </div>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <OLabel text="BOM Key" req />
                  <input value={createForm.key} onChange={(e) => { setCreateForm((f) => ({ ...f, key: e.target.value.toUpperCase() })); setCreateErr(""); }}
                    placeholder="e.g. MIX-100" className={inpCls + " font-mono"} />
                  <div className="text-[10px] text-slate-600 mt-1">Unique short code. Used as Rack ID and machine prefix.</div>
                </div>
                <div>
                  <OLabel text="Machine Model Name" req />
                  <input value={createForm.label} onChange={(e) => { setCreateForm((f) => ({ ...f, label: e.target.value })); setCreateErr(""); }}
                    placeholder="e.g. Industrial Mixer 100kg" className={inpCls} />
                </div>
                <div>
                  <OLabel text="Rack Capacity" />
                  <input type="number" min="0" step="1" value={createForm.rackCapacity}
                    onChange={(e) => setCreateForm((f) => ({ ...f, rackCapacity: e.target.value }))}
                    placeholder="0" className={inpCls + " text-right"} />
                  <div className="text-[10px] text-slate-600 mt-1">Slots on the production rack. 0 = no rack tracking.</div>
                </div>
              </div>

              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-3">Components ({createItems.length})</div>
                {createItems.length === 0 ? (
                  <div className="text-[11px] text-slate-600 italic py-3 text-center">No components added yet. Use the row below to add.</div>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {createItems.map((ci) => {
                      const inv = findItem(ci.code);
                      return (
                        <div key={ci.code} className="grid items-center gap-2 px-3 py-2 rounded-lg"
                             style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", gridTemplateColumns: "1fr 120px 100px 40px" }}>
                          <div>
                            <div className="text-[11px] font-semibold text-white">{inv?.name || ci.code}</div>
                            <div className="text-[9px] font-mono text-slate-600">{ci.code}</div>
                          </div>
                          <div className="text-[10px] text-slate-500 text-center">{inv?.category || "—"}</div>
                          <div className="flex items-center gap-1.5 justify-end">
                            <input type="number" min="0.1" step="0.1" value={ci.qty}
                              onChange={(e) => setCreateItems((p) => p.map((i) => i.code === ci.code ? { ...i, qty: parseFloat(e.target.value) || 0 } : i))}
                              className="w-16 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-xs text-white text-right outline-none modal-input"
                              style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                            <span className="text-[9px] text-slate-600">{inv?.unit || ""}</span>
                          </div>
                          <button onClick={() => removeCreateItem(ci.code)}
                            className="text-red-400 hover:text-red-300 text-[10px] font-bold px-2 py-1 rounded hover:bg-red-500/10 transition-all">✕</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-2" style={{ borderTop: "1px dashed rgba(255,255,255,0.08)" }}>
                  <div className="flex-1 min-w-[200px] mt-2">
                    <ItemSearchSelect
                      items={allFlat}
                      value={createAddCode}
                      onChange={setCreateAddCode}
                      excludeCodes={createItems.map((c) => c.code)}
                      placeholder="Search component by name or code…"
                    />
                  </div>
                  <input type="number" min="0.1" step="0.1" value={createAddQty}
                    onChange={(e) => setCreateAddQty(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCreateItem()}
                    placeholder="Qty"
                    className="w-20 bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none mt-2 modal-input text-right"
                    style={{ fontFamily: "'Inter',system-ui,sans-serif" }} />
                  <button onClick={addCreateItem}
                    className="px-4 py-2 rounded-lg text-xs font-bold text-white mt-2"
                    style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>+ Add</button>
                </div>
              </div>

              {createErr && (
                <div className="px-3 py-2 rounded-lg text-[11px] text-red-300"
                     style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  ⚠ {createErr}
                </div>
              )}
            </div>

            <div className="px-6 py-4 flex gap-2 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.3)" }}>
              <button onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
              <button onClick={submitCreateBOM}
                className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all"
                style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.35)" }}>
                ✓ Create BOM
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(249,115,22,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">📤</span>
          <div>
            <div className="text-xs font-black text-white">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Outward" subtitle="BOM dispatch & material issue" />

      <div className="p-6 space-y-6">

        {/* ── BOM Cards ── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-extrabold text-white">📤 BOM Outward</h2>
            <span className="text-[10px] font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">{boms.length} BOMs</span>
            <div className="flex-1" />
            {canDo("outward","editBOM") && onCreateBOM && (
              <button onClick={openCreateBOM}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white transition-all"
                style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", boxShadow: "0 0 14px rgba(37,99,235,0.3)" }}>
                + New BOM
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {boms.map(([bomKey, bom]) => {
              const units     = bomUnits[bomKey] || 1;
              const feasibleN = bom.items.filter(({ code, qty }) => { const inv = findItem(code); return inv && inv.stock >= qty * units; }).length;
              const allFeas   = feasibleN === bom.items.length;
              return (
                <div key={bomKey} onClick={() => canDo("outward","bom") && (setSerialModal(bomKey), setPendingSerial(""), setSerialErr(""))}
                     className={`bg-[#0e1117] rounded-xl overflow-hidden transition-all duration-200 group ${canDo("outward","bom") ? "cursor-pointer hover:bg-[#111620]" : "opacity-60 cursor-not-allowed"}`}
                     style={{ border: "1px solid rgba(255,255,255,0.07)" }}
                     onMouseEnter={(e) => { e.currentTarget.style.borderColor = bom.color + "55"; e.currentTarget.style.boxShadow = `0 0 24px ${bom.color}12`; }}
                     onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)"; e.currentTarget.style.boxShadow = "none"; }}>
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                           style={{ background: bom.color + "22", border: `1px solid ${bom.color}50` }}>{bomKey}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-white">{bomKey}</div>
                        <div className="text-[10px] text-slate-500">{bom.label}</div>
                      </div>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: allFeas ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)", color: allFeas ? "#4ade80" : "#f87171", border: `1px solid ${allFeas ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}` }}>
                        {feasibleN}/{bom.items.length} ready
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-3">
                      {bom.items.slice(0, 4).map(({ code, qty }) => {
                        const inv = findItem(code); const ok = inv && inv.stock >= qty * units;
                        return (
                          <span key={code} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: ok ? "#4ade80" : "#f87171", border: `1px solid ${ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                            {code} {inv ? `(${inv.stock})` : ""}
                          </span>
                        );
                      })}
                      {bom.items.length > 4 && <span className="text-[9px] text-slate-600">+{bom.items.length - 4} more</span>}
                    </div>
                    <div className="mt-3 pt-3 border-t border-white/[0.05] flex items-center justify-between">
                      <span className="text-[10px] text-slate-600">{bom.items.length} components</span>
                      <span className="text-[10px] font-bold text-blue-400 group-hover:text-blue-300 transition-colors">Open BOM →</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Pending Stock banner ── */}
        {pendingLog && pendingLog.length > 0 && (
          <div className="flex items-center gap-4 px-5 py-3.5 rounded-xl"
               style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.22)" }}>
            <span className="text-xl flex-shrink-0">⏳</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-orange-300">{pendingLog.length} item{pendingLog.length !== 1 ? "s" : ""} moved to Pending Stock</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Partially-issued BOM materials are tracked in the Pending Stock module.</div>
            </div>
            <button onClick={onClearPending}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-400 transition-colors flex-shrink-0">
              Clear
            </button>
          </div>
        )}

        {/* ── Manual Outward ── */}
        <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-sm font-extrabold text-white">✋ Manual Outward</h2>
            <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">Ad-hoc Issue</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <OLabel text="Select Item" req />
              <ItemSearchSelect
                items={Object.entries(items).flatMap(([cat, list]) => list.map((it) => ({ ...it, category: cat })))}
                value={manualCode}
                onChange={setManualCode}
                showStock={true}
                placeholder="Search inventory item by name or code…"
              />
            </div>
            <div>
              <OLabel text="Quantity" req />
              <input type="number" min="1" value={manualQty} onChange={(e) => setManualQty(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                     placeholder="Enter quantity" className={inpCls}
                     style={{ fontVariantNumeric: "tabular-nums", fontFamily: "'Inter',system-ui,sans-serif" }} />
            </div>
            <div>
              <OLabel text="Department / Machine" />
              <input value={manualDept} onChange={(e) => setManualDept(e.target.value)} placeholder="e.g. Production, M-04" className={inpCls} />
            </div>
            <div>
              <OLabel text="Notes" />
              <input value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="e.g. Breakdown repair" className={inpCls} />
            </div>
          </div>

          {manualCode && (() => {
            const inv = findItem(manualCode); const n = parseInt(manualQty, 10);
            if (!inv) return null;
            const newS = n > 0 ? Math.max(0, inv.stock - n) : null;
            const sufficient = !n || inv.stock >= n;
            return (
              <div className="mt-4 p-4 rounded-xl grid grid-cols-3 gap-3"
                   style={{ background: sufficient ? "rgba(255,255,255,0.02)" : "rgba(239,68,68,0.04)", border: sufficient ? "1px solid rgba(255,255,255,0.07)" : "1px solid rgba(239,68,68,0.3)" }}>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Current</div>
                  <div className={`text-xl font-black font-mono ${statusConfig[inv.status].text}`} style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    {inv.stock} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Issuing</div>
                  <div className="text-xl font-black font-mono text-orange-400" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    −{n > 0 ? n : 0} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.06em] mb-1">Remaining</div>
                  <div className={`text-xl font-black font-mono ${sufficient ? "text-white" : "text-red-400"}`} style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                    {newS !== null ? newS : inv.stock} <span className="text-xs text-slate-500">{inv.unit}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {manualError && (
            <div className="mt-3 p-3 rounded-xl text-[10px] text-red-400 font-bold"
                 style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.3)" }}>
              ⚠ {manualError}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="ghost" size="sm" onClick={() => { setManualCode(""); setManualQty(""); setManualDept(""); setManualNotes(""); setManualError(""); }}>Clear</Btn>
            {canDo("outward","manual") && (
              <button onClick={handleManualSubmit} disabled={manualBusy}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold text-white border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: "linear-gradient(135deg,#ea580c,#c2410c)", borderColor: "rgba(249,115,22,0.5)", boxShadow: "0 0 16px rgba(249,115,22,0.3)" }}>
                {manualBusy ? "⏳ Issuing…" : "📤 Issue Stock"}
              </button>
            )}
          </div>
        </div>

        {/* ── Outward History ── */}
        {outwardLog && outwardLog.length > 0 && (
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl p-5">
            <SectionHeader>📋 Outward History</SectionHeader>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="border-b border-white/[0.06]">
                  {["Date","Type","Ref","Details","Qty","Note"].map((h) => (
                    <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {outwardLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2 text-[10px] text-slate-500 font-mono">{entry.date}</td>
                      <td className="px-4 py-2">
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: entry.type === "bom" ? "rgba(249,115,22,0.1)" : "rgba(59,130,246,0.1)", color: entry.type === "bom" ? "#fb923c" : "#60a5fa", border: `1px solid ${entry.type === "bom" ? "rgba(249,115,22,0.2)" : "rgba(59,130,246,0.2)"}` }}>
                          {entry.type === "bom" ? "BOM" : "Manual"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-[10px] font-bold font-mono text-white">{entry.ref}</td>
                      <td className="px-4 py-2 text-[10px] text-slate-400">
                        {entry.type === "bom" ? `${entry.label} × ${entry.units}` : entry.items?.[0]?.name || "—"}
                      </td>
                      <td className="px-4 py-2 text-[10px] font-bold font-mono text-orange-400">
                        {entry.items ? `${entry.items.reduce((s, i) => s + (i.issueQty || 0), 0)} units` : "—"}
                      </td>
                      <td className="px-4 py-2 text-[10px] text-slate-500">{entry.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─── MACHINE TRACKER PAGE ────────────────────────────────────────────────────

const STAGE_COLORS = {
  "BOM Issued": "#3b82f6",
  "Assembly":   "#8b5cf6",
  "Mechanical": "#f97316",
  "Electrical": "#eab308",
  "Trial":      "#06b6d4",
  "Ready":      "#22c55e",
};

function MachinePage({ machineLog, onUpdateStage, onNavigate = () => {}, canDo = () => true, bomDefs = {}, onStartProduction }) {
  const [filter,   setFilter]   = useState("active");
  const [expanded, setExpanded] = useState(null);
  const [stageMap, setStageMap] = useState({});
  const [toast,    setToast]    = useState(null);
  const [startProd, setStartProd] = useState(null); // rack object { key, label, ready, capacity }
  const [startSel,  setStartSel]  = useState(() => new Set()); // selected rack-machine ids
  const [startErr,  setStartErr]  = useState("");

  const showToast = (text, sub) => { setToast({ text, sub }); setTimeout(() => setToast(null), 3000); };

  // Machine Tracker shows ONLY machines that have STARTED production (left the rack).
  // Rack machines sit at stage "BOM Issued" and appear solely in the Production Rack View.
  const started   = machineLog.filter((m) => m.stage !== "BOM Issued");
  const active    = started.filter((m) => m.status !== "completed");
  const completed = started.filter((m) => m.status === "completed");
  const filtered  = filter === "active" ? active : filter === "completed" ? completed : started;

  const stageIdx = (s) => MACHINE_STAGES.indexOf(s);

  // ─── Production Rack view (computed from existing data) ────────────────────
  // Rack Ready Qty = count of machines for this bomKey still at "BOM Issued" stage.
  // BOMs without machines or capacity still get a card (per "Each machine model must have a Rack Card").
  const rackData = (() => {
    const allKeys = new Set([
      ...Object.keys(bomDefs || {}),
      ...machineLog.map((m) => m.bomKey).filter(Boolean),
    ]);
    return [...allKeys].sort().map((key) => {
      const def      = bomDefs[key] || {};
      const ready    = machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued").length;
      const capacity = Number(def.rackCapacity) || 0;
      const empty    = Math.max(0, capacity - ready);
      let state;
      if (capacity > 0 && ready >= capacity)        state = "full";
      else if (ready > 0)                           state = "partial";
      else                                          state = "empty";
      return {
        key, label: def.label || key,
        capacity, ready, empty, state,
        configured: capacity > 0,
      };
    });
  })();
  const replenishAlerts = rackData.filter((r) => r.configured && r.ready < r.capacity);

  // Rack machines (serial-wise, oldest first) waiting to start for a model.
  const rackMachinesFor = (key) =>
    machineLog.filter((m) => m.bomKey === key && m.stage === "BOM Issued")
              .sort((a, b) => (a.createdDate || "").localeCompare(b.createdDate || ""));

  const openStartProd = (rack) => {
    if (rack.ready === 0) return;
    setStartProd(rack);
    setStartSel(new Set());
    setStartErr("");
  };
  const toggleStartSel = (id) => setStartSel((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const confirmStartProd = () => {
    if (!startProd || !onStartProduction) return;
    const ids = [...startSel];
    if (ids.length === 0) { setStartErr("Select at least one machine (serial) to start."); return; }
    const res = onStartProduction(ids);
    if (res?.success === false) { setStartErr(res.error || "Failed to start production"); return; }
    showToast(`${startProd.key} — ${res.count} machine(s) into production`, (res.serials || []).join(", ") || "Assembly stage active");
    setStartProd(null); setStartErr("");
  };

  const handleStageUpdate = (machine) => {
    const newStage = stageMap[machine.id];
    if (!newStage || newStage === machine.stage) return;
    onUpdateStage(machine.id, newStage);
    showToast(`${machine.bomKey} — ${machine.serialNo}`, `Stage: ${machine.stage} → ${newStage}`);
    setStageMap((p) => ({ ...p, [machine.id]: "" }));
  };

  return (
    <div className="flex-1 overflow-y-auto">

      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: "1px solid rgba(34,197,94,0.45)", boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">🔧</span>
          <div>
            <div className="text-xs font-bold text-white">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      <Topbar title="Machine Tracker" subtitle="Production build tracking — BOM issue through completion" />

      <div className="p-6 space-y-5">

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-5 rounded-xl" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)" }}>
            <div className="text-[9px] font-bold text-blue-500 uppercase tracking-[0.08em] mb-1">Total Machines</div>
            <div className="text-4xl font-black text-blue-400 mb-1">{started.length}</div>
            <div className="text-[10px] text-slate-500">started from rack</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}>
            <div className="text-[9px] font-bold text-orange-500 uppercase tracking-[0.08em] mb-1">Active Builds</div>
            <div className="text-4xl font-black text-orange-400 mb-1">{active.length}</div>
            <div className="text-[10px] text-slate-500">in production</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="text-[9px] font-bold text-green-500 uppercase tracking-[0.08em] mb-1">Completed</div>
            <div className="text-4xl font-black text-green-400 mb-1">{completed.length}</div>
            <div className="text-[10px] text-slate-500">ready for delivery</div>
          </div>
        </div>

        {/* ── Production Rack View ── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-black text-white">Production Rack View</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Ready-to-start machines waiting on the rack for each model</div>
            </div>
            <div className="text-[10px] text-slate-500">
              <span className="text-emerald-400">●</span> Full &nbsp;
              <span className="text-amber-400">●</span> Partial &nbsp;
              <span className="text-red-400">●</span> Empty
            </div>
          </div>

          {/* Replenishment alerts */}
          {replenishAlerts.length > 0 && (
            <div className="mb-3 rounded-xl p-3.5" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)" }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">⚠️</span>
                <div className="text-[11px] font-bold text-amber-300">Rack Requires Replenishment</div>
                <span className="text-[9px] font-semibold text-amber-400 px-1.5 py-0.5 rounded-full" style={{ background: "rgba(245,158,11,0.18)" }}>{replenishAlerts.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {replenishAlerts.map((r) => (
                  <div key={r.key} className="px-3 py-2 rounded-lg text-[10.5px]" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(245,158,11,0.18)" }}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{r.key}</span>
                      <span className="text-amber-400 font-bold">{r.empty} empty slot{r.empty !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="text-slate-500 truncate mt-0.5">{r.label}</div>
                    <div className="text-slate-600 text-[9.5px] mt-0.5">Ready {r.ready} / Capacity {r.capacity}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rackData.length === 0 ? (
            <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl py-10 text-center">
              <div className="text-3xl mb-2">📦</div>
              <div className="text-xs font-bold text-white mb-1">No Machine Models Defined</div>
              <div className="text-[10px] text-slate-500">Create a BOM definition from <button onClick={() => onNavigate("outward")} className="text-blue-400 underline hover:text-blue-300">Outward</button> to start tracking racks.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {rackData.map((r) => {
                const STATE = {
                  full:    { color: "#22c55e", bg: "rgba(34,197,94,0.08)",  border: "rgba(34,197,94,0.3)",  label: "Full",    icon: "✓" },
                  partial: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)", label: "Partial", icon: "◐" },
                  empty:   { color: "#ef4444", bg: "rgba(239,68,68,0.06)",  border: "rgba(239,68,68,0.22)", label: "Empty",   icon: "○" },
                }[r.state];
                const pct = r.capacity > 0 ? Math.min(100, Math.round((r.ready / r.capacity) * 100)) : 0;
                return (
                  <button
                    key={r.key}
                    onClick={() => openStartProd(r)}
                    disabled={r.ready === 0}
                    className="text-left rounded-xl p-4 transition-all relative"
                    style={{
                      background: STATE.bg,
                      border: `1px solid ${STATE.border}`,
                      cursor: r.ready > 0 ? "pointer" : "default",
                      opacity: r.ready > 0 ? 1 : 0.78,
                    }}
                    onMouseEnter={(e) => { if (r.ready > 0) e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
                  >
                    <div className="flex items-start justify-between mb-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black text-white">{r.key}</div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">{r.label}</div>
                      </div>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                            style={{ background: STATE.color + "22", color: STATE.color, border: `1px solid ${STATE.color}40` }}>
                        {STATE.icon} {STATE.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 mb-2.5">
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Ready</div>
                        <div className="text-lg font-black" style={{ color: STATE.color }}>{r.ready}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Capacity</div>
                        <div className="text-lg font-black text-slate-300">{r.configured ? r.capacity : "—"}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-slate-600 uppercase tracking-wide">Empty</div>
                        <div className="text-lg font-black text-slate-400">{r.configured ? r.empty : "—"}</div>
                      </div>
                    </div>

                    {r.configured && (
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                        <div className="h-full transition-all" style={{ width: `${pct}%`, background: STATE.color }} />
                      </div>
                    )}
                    {!r.configured && (
                      <div className="text-[9px] text-slate-600 italic">Capacity not set — edit BOM to assign</div>
                    )}
                    {r.ready > 0 && (
                      <div className="mt-2 text-[10px] font-bold text-blue-400">▶ Click to start production</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Filter tabs ── */}
        <div className="flex items-center gap-2">
          {[["active","Active Builds"], ["completed","Completed"], ["all","All Machines"]].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all ${filter === key ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "text-slate-500 border-white/[0.08] hover:text-slate-300"}`}>
              {label} ({key === "active" ? active.length : key === "completed" ? completed.length : started.length})
            </button>
          ))}
        </div>

        {/* ── Empty state ── */}
        {filtered.length === 0 && (
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl py-20 text-center">
            <div className="text-5xl mb-4">🔧</div>
            <div className="text-sm font-bold text-white mb-2">No Machines Tracked</div>
            {filter === "completed" ? (
              <div className="text-[11px] text-slate-500">No completed machines yet.</div>
            ) : (
              <div className="text-[11px] text-slate-500">
                Issue a BOM from Outward to add a machine to the rack, then use the Production Rack View above to start a build.{" "}
                <button onClick={() => onNavigate("outward")}
                        className="text-blue-400 underline hover:text-blue-300 transition-colors">
                  Go to Outward →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Machine cards ── */}
        <div className="space-y-4">
          {filtered.map((machine) => {
            const curIdx   = stageIdx(machine.stage);
            const isComplete = machine.status === "completed";
            const isExpanded = expanded === machine.id;
            const selStage   = stageMap[machine.id] || "";
            const futureStages = MACHINE_STAGES.filter((_, i) => i > curIdx);
            const stageColor = STAGE_COLORS[machine.stage] || "#3b82f6";
            const pct = isComplete ? 100 : Math.round((curIdx / (MACHINE_STAGES.length - 1)) * 100);

            return (
              <div key={machine.id} className="bg-[#0e1117] rounded-xl overflow-hidden transition-all"
                   style={{ border: `1px solid ${isComplete ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.07)"}` }}>

                {/* ── Card header ── */}
                <div className="px-5 py-4">
                  <div className="flex items-start gap-4 flex-wrap">

                    {/* Machine identity */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                           style={{ background: stageColor + "1a", border: `1px solid ${stageColor}45` }}>
                        {machine.bomKey}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{machine.bomLabel}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] font-mono text-blue-400 font-bold">S/N: {machine.serialNo}</span>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: stageColor + "18", color: stageColor, border: `1px solid ${stageColor}35` }}>
                            {machine.stage}
                          </span>
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: "rgba(255,255,255,0.05)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)" }}>
                            {curIdx + 1}/{MACHINE_STAGES.length} — {pct}%
                          </span>
                          {isComplete && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(34,197,94,0.12)", color:"#4ade80", border:"1px solid rgba(34,197,94,0.25)" }}>
                              ✓ Completed
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-600 mt-0.5">Started {machine.createdDate}{machine.completedDate ? ` · Completed ${machine.completedDate}` : ""}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="w-28 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                            <div className="h-full rounded-full transition-all duration-500"
                                 style={{ width: `${pct}%`, background: isComplete ? "#22c55e" : stageColor }} />
                          </div>
                          <span className="text-[9px] font-mono font-bold" style={{ color: isComplete ? "#4ade80" : stageColor }}>{pct}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Progress timeline */}
                    <div className="flex-1 min-w-[260px]">
                      <div className="flex items-center">
                        {MACHINE_STAGES.map((stage, idx) => {
                          const done    = idx <= curIdx;
                          const current = idx === curIdx;
                          const sc      = STAGE_COLORS[stage];
                          return (
                            <div key={stage} className="flex items-center flex-1 last:flex-none">
                              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black transition-all"
                                     style={{
                                       background: done ? sc + "22" : "rgba(255,255,255,0.04)",
                                       border: `2px solid ${done ? sc : "rgba(255,255,255,0.08)"}`,
                                       color: done ? sc : "rgba(255,255,255,0.2)",
                                       boxShadow: current ? `0 0 10px ${sc}55` : "none",
                                     }}>
                                  {done ? "✓" : idx + 1}
                                </div>
                                <div className="text-[7px] font-bold text-center leading-tight whitespace-nowrap"
                                     style={{ color: done ? sc : "rgba(255,255,255,0.2)", maxWidth: 40 }}>
                                  {stage === "BOM Issued" ? "Issued" : stage}
                                </div>
                              </div>
                              {idx < MACHINE_STAGES.length - 1 && (
                                <div className="flex-1 h-0.5 mx-1 rounded-full transition-all"
                                     style={{ background: idx < curIdx ? (STAGE_COLORS[MACHINE_STAGES[idx + 1]] + "55") : "rgba(255,255,255,0.06)" }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {!isComplete && futureStages.length > 0 && canDo("machines","updateStage") && (
                        <>
                          <select value={selStage}
                                  onChange={(e) => setStageMap((p) => ({ ...p, [machine.id]: e.target.value }))}
                                  className="bg-white/[0.04] border border-white/[0.1] rounded-lg px-2 py-1.5 text-[11px] text-slate-300 outline-none"
                                  style={{ background: "#0b0e17" }}>
                            <option value="">Update Stage</option>
                            {futureStages.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                          <button onClick={() => handleStageUpdate(machine)}
                                  disabled={!selStage}
                                  className="text-[11px] font-bold px-3 py-1.5 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                  style={{ background: selStage ? "linear-gradient(135deg,#2563eb,#1d4ed8)" : "transparent", borderColor: selStage ? "rgba(37,99,235,0.4)" : "rgba(255,255,255,0.08)", color: selStage ? "white" : "rgba(255,255,255,0.3)" }}>
                            Update
                          </button>
                        </>
                      )}
                      <button onClick={() => setExpanded(isExpanded ? null : machine.id)}
                              className="text-[10px] font-bold text-slate-500 hover:text-slate-200 px-2 py-1.5 rounded-lg border border-white/[0.07] hover:border-white/20 transition-all">
                        {isExpanded ? "Hide" : "History"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── Stage History (expandable) ── */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">Stage History</div>
                    <div className="relative pl-5">
                      <div className="absolute left-2 top-0 bottom-0 w-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                      {[...machine.history].reverse().map((h, i, arr) => {
                        const sc = STAGE_COLORS[h.stage] || "#3b82f6";
                        return (
                          <div key={i} className="relative mb-3 last:mb-0">
                            <div className="absolute -left-[13px] top-1 w-2.5 h-2.5 rounded-full flex-shrink-0"
                                 style={{ background: sc + "22", border: `1.5px solid ${sc}`, boxShadow: i === 0 ? `0 0 8px ${sc}55` : "none" }} />
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-[10px] font-bold text-white">{h.stage}</span>
                              {i === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: sc+"18", color: sc, border: `1px solid ${sc}30` }}>Current</span>}
                              <span className="text-[9px] text-slate-600 font-mono ml-auto">{h.date}</span>
                            </div>
                            {h.note && <div className="text-[10px] text-slate-500 mt-0.5">{h.note}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* ── Start Production Modal ── */}
      {startProd && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
             style={{ background: "rgba(4,6,12,0.92)", backdropFilter: "blur(12px)" }}
             onClick={(e) => e.target === e.currentTarget && setStartProd(null)}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4"
               style={{ background: "#0d1018", border: "1px solid rgba(34,197,94,0.4)", boxShadow: "0 40px 80px rgba(0,0,0,0.9)" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ background: "rgba(34,197,94,0.15)" }}>▶</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-black text-white">Start Production</div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">{startProd.key} — {startProd.label}</div>
              </div>
              <button onClick={() => setStartProd(null)} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl text-center" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.22)" }}>
                <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide">Available on Rack</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">{startProd.ready}</div>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Rack Capacity</div>
                <div className="text-2xl font-black text-slate-300 mt-1">{startProd.configured ? startProd.capacity : "—"}</div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1.5">Select Machine(s) to Start</label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {rackMachinesFor(startProd.key).map((m) => {
                  const sel = startSel.has(m.id);
                  return (
                    <button key={m.id} onClick={() => { toggleStartSel(m.id); setStartErr(""); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all"
                            style={{ background: sel ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${sel ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.08)"}` }}>
                      <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-[10px] font-black"
                            style={{ background: sel ? "#16a34a" : "transparent", border: `1.5px solid ${sel ? "#16a34a" : "rgba(255,255,255,0.25)"}`, color: "#fff" }}>
                        {sel ? "✓" : ""}
                      </span>
                      <span className="text-[12px] font-mono font-bold text-white flex-1 truncate">{m.serialNo || "(no serial)"}</span>
                      <span className="text-[9px] text-slate-500 flex-shrink-0">Issued {m.createdDate}</span>
                    </button>
                  );
                })}
              </div>
              <div className="text-[10px] text-slate-500 mt-1.5">
                {startSel.size} selected · will move from rack → Assembly stage.
              </div>
              {startErr && <div className="text-[10px] text-red-400 mt-1">{startErr}</div>}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStartProd(null)}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
              <button onClick={confirmStartProd}
                className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition-all"
                style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.35)" }}>
                ▶ Start Production
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PENDING PAGE ────────────────────────────────────────────────────────────

function PendingPage({ pendingLog, onClearPending, onFulfillPending, onFulfillGroup, items, bomDefs, machineLog = [], handleUpdateStock, onNavigate = () => {}, canDo = () => true }) {
  const [viewBOM,  setViewBOM]  = useState(null);
  const [toast,    setToast]    = useState(null);

  const allFlat  = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const findItem = (code) => allFlat.find((i) => i.code === code);

  const showToast = (text, sub, type = "success") => {
    setToast({ text, sub, type });
    setTimeout(() => setToast(null), 3200);
  };

  // Enrich with live stock
  const enriched = pendingLog.map((p) => {
    const inv       = findItem(p.code);
    const liveStock = inv?.stock ?? 0;
    const canIssue  = Math.min(p.pendingQty, liveStock);
    const avail     = canIssue >= p.pendingQty ? "full" : canIssue > 0 ? "partial" : "none";
    return { ...p, liveStock, canIssue, avail, unit: p.unit || inv?.unit || "—", category: inv?.category || p.category || "Other" };
  });

  // Group by issueId, carry serialNo from the entry
  const groupMap = {};
  enriched.forEach((e) => {
    const key = String(e.issueId ?? `${e.bomKey}-${e.date}`);
    if (!groupMap[key]) {
      groupMap[key] = {
        key, bomKey: e.bomKey, bomLabel: e.bomLabel || e.bomKey,
        serialNo: e.serialNo || "", date: e.date,
        issueId: e.issueId, items: [],
      };
    }
    groupMap[key].items.push(e);
  });
  const groups = Object.values(groupMap);

  // Machine Tracker lookup by issueId for stage info
  const machineByIssue = Object.fromEntries(
    machineLog.filter((m) => m.issueId).map((m) => [String(m.issueId), m])
  );

  const totalPending = enriched.reduce((s, e) => s + e.pendingQty, 0);
  const availN       = enriched.filter((e) => e.canIssue > 0).length;

  const getGroupStatus = (g) => {
    if (g.items.every((e) => e.avail === "none")) return "waiting";
    if (g.items.every((e) => e.avail === "full"))  return "ready";
    return "partial";
  };

  const handleGiveMaterial = (entry) => {
    if (entry.canIssue <= 0) return;
    handleUpdateStock(entry.category, entry.code, -entry.canIssue, `Fulfill: ${entry.bomKey}`);
    onFulfillPending(entry, entry.canIssue);
    const rem = entry.pendingQty - entry.canIssue;
    showToast(
      `Issued ${entry.canIssue} ${entry.unit} — ${entry.name}`,
      rem > 0 ? `${rem} ${entry.unit} still pending` : "Fully fulfilled"
    );
  };

  const handleGiveAllForGroup = (group) => {
    const available = group.items.filter((e) => e.canIssue > 0);
    if (available.length === 0) return;
    if (onFulfillGroup && group.issueId) {
      onFulfillGroup(group.issueId, available);
    } else {
      available.forEach((e) => {
        handleUpdateStock(e.category, e.code, -e.canIssue, `Fulfill: ${e.bomKey}`);
        onFulfillPending(e, e.canIssue);
      });
    }
    showToast(`Issued ${available.length} item${available.length > 1 ? "s" : ""} for ${group.bomKey}`,
              group.serialNo ? `S/N: ${group.serialNo}` : group.bomLabel);
  };

  const handleFulfillAll = () => groups.forEach((g) => handleGiveAllForGroup(g));

  const AC = { full: "#22c55e", partial: "#f97316", none: "#ef4444" };
  const AL = { full: "Ready",   partial: "Partial Stock", none: "Waiting" };

  // BOM View Modal
  const BOMModal = viewBOM && bomDefs?.[viewBOM] ? (() => {
    const bom = bomDefs[viewBOM];
    const bomItems = bom.items.map(({ code, qty }) => {
      const inv = findItem(code); const ok = inv && inv.stock >= qty;
      return { code, qty, inv, ok };
    });
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
        <div className="bg-[#0c1018] rounded-2xl w-full max-w-lg mx-4 overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.85)", animation: "slideUp 0.25s ease both" }}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                   style={{ background: bom.color + "22", border: `1px solid ${bom.color}55` }}>{viewBOM}</div>
              <div>
                <div className="text-sm font-bold text-white">{viewBOM} — {bom.label}</div>
                <div className="text-[11px] text-slate-500">{bom.items.length} components</div>
              </div>
            </div>
            <button onClick={() => setViewBOM(null)} className="text-slate-500 hover:text-white text-base transition-colors">✕</button>
          </div>
          <div className="p-5 max-h-[65vh] overflow-y-auto space-y-2">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-3">Components — live stock</div>
            {bomItems.map(({ code, qty, inv, ok }) => (
              <div key={code} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                   style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.15)"}` }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold text-white truncate">{inv?.name || code}</div>
                  <div className="text-[9px] font-mono text-slate-500 mt-0.5">{code} · {qty} {inv?.unit || "—"} / unit</div>
                </div>
                <div className="text-right flex-shrink-0 mr-2">
                  <div className="text-[11px] font-bold font-mono tabular-nums" style={{ color: ok ? "#4ade80" : "#f87171" }}>{inv?.stock ?? 0} {inv?.unit || ""}</div>
                  <div className="text-[9px] text-slate-600">in stock</div>
                </div>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: ok ? "#4ade80" : "#f87171", border: `1px solid ${ok ? "rgba(34,197,94,0.22)" : "rgba(239,68,68,0.22)"}` }}>
                  {ok ? "OK" : "Low"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  })() : null;

  return (
    <div className="flex-1 overflow-y-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-5 py-3.5 rounded-2xl"
             style={{ background: "linear-gradient(135deg,#0d1018,#0a0c14)", border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.45)" : "rgba(34,197,94,0.45)"}`, boxShadow: "0 20px 60px rgba(0,0,0,0.75)", animation: "slideUp 0.3s ease both" }}>
          <span className="text-lg">{toast.type === "error" ? "⚠️" : "✅"}</span>
          <div>
            <div className="text-xs font-bold text-white">{toast.text}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{toast.sub}</div>
          </div>
          <button onClick={() => setToast(null)} className="ml-2 text-slate-600 hover:text-slate-300 text-xs">✕</button>
        </div>
      )}

      {BOMModal}

      <Topbar title="Pending Stock" subtitle="BOM shortfall tracking — linked with Machine Tracker and Inventory" />

      <div className="p-6 space-y-5">

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-5 rounded-xl" style={{ background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)" }}>
            <div className="text-[9px] font-bold text-orange-500 uppercase tracking-[0.08em] mb-1">Pending Machines</div>
            <div className="text-4xl font-black text-orange-400 mb-1">{groups.length}</div>
            <div className="text-[10px] text-slate-500">builds with shortfalls</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <div className="text-[9px] font-bold text-red-500 uppercase tracking-[0.08em] mb-1">Missing Items</div>
            <div className="text-4xl font-black text-red-400 mb-1">{enriched.length}</div>
            <div className="text-[10px] text-slate-500">{totalPending} total units pending</div>
          </div>
          <div className="p-5 rounded-xl" style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <div className="text-[9px] font-bold text-green-500 uppercase tracking-[0.08em] mb-1">Can Issue Now</div>
            <div className="text-4xl font-black text-green-400 mb-1">{availN}</div>
            <div className="text-[10px] text-slate-500">items with stock available</div>
          </div>
        </div>

        {groups.length === 0 ? (
          <div className="bg-[#0e1117] border border-white/[0.07] rounded-xl py-20 text-center" style={{ animation: "fadeIn 0.4s ease both" }}>
            <div className="text-5xl mb-4">✅</div>
            <div className="text-sm font-bold text-white mb-2">No Pending Materials</div>
            <div className="text-[11px] text-slate-500">All BOM issues are fully fulfilled. Issue a BOM from Outward to track shortfalls here.</div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-500">
                <span className="font-bold text-white">{groups.length}</span> machine{groups.length !== 1 ? "s" : ""} waiting ·{" "}
                <span className="font-bold text-orange-400">{enriched.length} items</span> pending
              </div>
              <div className="flex items-center gap-2">
                {availN > 0 && canDo("pending","fulfill") && (
                  <button onClick={handleFulfillAll}
                          className="text-[11px] font-bold text-white px-4 py-1.5 rounded-lg transition-all"
                          style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", boxShadow: "0 0 14px rgba(34,197,94,0.25)" }}>
                    ✓ Issue All Available ({availN})
                  </button>
                )}
                {canDo("pending","clear") && (
                  <button onClick={onClearPending}
                          className="text-[10px] font-bold text-slate-500 hover:text-red-400 transition-colors px-2 py-1.5">
                    Clear All
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {groups.map((group) => {
                const gStatus   = getGroupStatus(group);
                const gCanN     = group.items.filter((e) => e.canIssue > 0).length;
                const gSC       = gStatus === "ready" ? "#22c55e" : gStatus === "partial" ? "#f97316" : "#ef4444";
                const gLabel    = gStatus === "ready" ? "All Ready" : gStatus === "partial" ? "Partially Available" : "Awaiting Stock";
                const machine   = machineByIssue[String(group.issueId)] || null;
                const stageColor = machine ? (STAGE_COLORS[machine.stage] || "#3b82f6") : "#3b82f6";
                const bom        = bomDefs?.[group.bomKey];

                return (
                  <div key={group.key} className="bg-[#0e1117] border border-white/[0.07] rounded-xl overflow-hidden"
                       style={{ animation: "slideUp 0.3s ease both" }}>

                    {/* Group header */}
                    <div className="px-5 py-4" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* BOM badge */}
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-[11px] font-black text-white flex-shrink-0"
                             style={{ background: (bom?.color || "#f97316") + "22", border: `1px solid ${(bom?.color || "#f97316")}50` }}>
                          {group.bomKey}
                        </div>

                        {/* Machine identity */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-white">{group.bomLabel}</span>
                            {group.serialNo && (
                              <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full"
                                    style={{ background: "rgba(59,130,246,0.12)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" }}>
                                S/N: {group.serialNo}
                              </span>
                            )}
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                  style={{ background: gSC + "18", color: gSC, border: `1px solid ${gSC}35` }}>
                              {gLabel}
                            </span>
                            {machine && (
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                                    style={{ background: stageColor + "18", color: stageColor, border: `1px solid ${stageColor}35` }}>
                                🔧 {machine.stage}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            Issued {group.date} · {group.items.length} item{group.items.length !== 1 ? "s" : ""} pending
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {gCanN > 0 && canDo("pending","fulfill") && (
                            <button onClick={() => handleGiveAllForGroup(group)}
                                    className="text-[10px] font-bold text-white px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap"
                                    style={{ background: "linear-gradient(135deg,#16a34a,#15803d)", borderColor: "rgba(34,197,94,0.3)" }}>
                              Give All ({gCanN})
                            </button>
                          )}
                          <button onClick={() => setViewBOM(group.bomKey)}
                                  className="text-[10px] font-bold text-blue-400 px-3 py-1.5 rounded-lg border border-blue-500/20 hover:bg-blue-500/[0.08] transition-all whitespace-nowrap">
                            View BOM
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-white/[0.05]">
                            {["Code", "Missing Item", "Required", "Available", "Pending Qty", "Status", "Action"].map((h) => (
                              <th key={h} className="text-left text-[10px] font-bold text-slate-600 uppercase tracking-wide px-4 py-2.5">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((entry, idx) => (
                            <tr key={idx} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors">
                              <td className="px-4 py-3 text-[10px] font-mono font-bold text-blue-400 whitespace-nowrap">{entry.code}</td>
                              <td className="px-4 py-3">
                                <div className="text-xs font-semibold text-white">{entry.name}</div>
                                <div className="text-[9px] text-slate-600 mt-0.5 font-mono">{entry.category}</div>
                              </td>
                              <td className="px-4 py-3 text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                                {entry.required} <span className="text-slate-600">{entry.unit}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] font-bold font-mono tabular-nums whitespace-nowrap" style={{ color: AC[entry.avail] }}>
                                  {entry.liveStock} <span style={{ color: AC[entry.avail] + "99", fontWeight: 400 }}>{entry.unit}</span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-[10px] font-bold font-mono tabular-nums text-orange-400 whitespace-nowrap">
                                {entry.pendingQty} <span className="text-orange-400/60 font-normal">{entry.unit}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                                      style={{ background: AC[entry.avail] + "18", color: AC[entry.avail], border: `1px solid ${AC[entry.avail]}35` }}>
                                  {AL[entry.avail]}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                {entry.avail !== "none" && canDo("pending","fulfill") ? (
                                  <button onClick={() => handleGiveMaterial(entry)}
                                          className="text-[10px] font-bold text-white px-3 py-1.5 rounded-lg border whitespace-nowrap transition-all"
                                          style={{ background: entry.avail === "full" ? "linear-gradient(135deg,#16a34a,#15803d)" : "linear-gradient(135deg,#d97706,#b45309)", borderColor: entry.avail === "full" ? "rgba(34,197,94,0.3)" : "rgba(217,119,6,0.3)", boxShadow: entry.avail === "full" ? "0 0 10px rgba(34,197,94,0.18)" : "0 0 10px rgba(217,119,6,0.15)" }}>
                                    {entry.avail === "full" ? "✓ Give Material" : `Issue ${entry.canIssue} ${entry.unit}`}
                                  </button>
                                ) : entry.avail === "none" ? (
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] text-slate-600 font-bold">Awaiting Inward</span>
                                    {canDo("pipeline","create") && (
                                      <button onClick={() => onNavigate("pipeline")}
                                              className="text-[10px] text-blue-400 underline hover:text-blue-300 transition-colors whitespace-nowrap">
                                        → Pipeline
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-bold">No Permission</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── HISTORY & REPORTS ────────────────────────────────────────────────────────

const AUDIT_META = {
  po_created:        { label: "PO Created",        icon: "📋", color: "#3b82f6", module: "Purchase"   },
  po_approved:       { label: "PO Approved",        icon: "✅", color: "#22c55e", module: "Purchase"   },
  po_rejected:       { label: "PO Rejected",        icon: "❌", color: "#ef4444", module: "Purchase"   },
  po_ordered:        { label: "Order Placed",        icon: "🚚", color: "#6366f1", module: "Purchase"   },
  po_received:       { label: "PO Received",         icon: "📥", color: "#10b981", module: "Purchase"   },
  po_deleted:        { label: "PO Deleted",          icon: "🗑️", color: "#64748b", module: "Purchase"   },
  inward_manual:     { label: "Manual Inward",       icon: "📥", color: "#10b981", module: "Inward"     },
  outward_bom:       { label: "BOM Issued",          icon: "📤", color: "#f59e0b", module: "Outward"    },
  outward_manual:    { label: "Manual Outward",      icon: "📤", color: "#fb923c", module: "Outward"    },
  stock_adjust:      { label: "Stock Adjusted",      icon: "🔢", color: "#8b5cf6", module: "Inventory"  },
  inventory_add:     { label: "Item Added",          icon: "➕", color: "#22c55e", module: "Inventory"  },
  inventory_edit:    { label: "Item Edited",         icon: "✏️", color: "#3b82f6", module: "Inventory"  },
  inventory_delete:  { label: "Item Deleted",        icon: "🗑️", color: "#ef4444", module: "Inventory"  },
  inventory_archive: { label: "Item Archived",        icon: "📦", color: "#64748b", module: "Inventory"  },
  bom_updated:       { label: "BOM Updated",         icon: "⚙️", color: "#f59e0b", module: "BOM"        },
  pending_fulfilled: { label: "Pending Fulfilled",   icon: "✅", color: "#22c55e", module: "Pending"    },
  pending_cleared:   { label: "Pending Cleared",     icon: "🧹", color: "#64748b", module: "Pending"    },
  machine_created:   { label: "Machine Created",     icon: "🏭", color: "#3b82f6", module: "Machine"    },
  machine_stage:     { label: "Stage Updated",       icon: "🔄", color: "#6366f1", module: "Machine"    },
  machine_completed: { label: "Completed",           icon: "🏆", color: "#22c55e", module: "Machine"    },
  vendor_add:        { label: "Vendor Added",        icon: "➕", color: "#22c55e", module: "Vendor"     },
  vendor_edit:       { label: "Vendor Updated",      icon: "✏️", color: "#3b82f6", module: "Vendor"     },
  vendor_delete:     { label: "Vendor Deleted",      icon: "🗑️", color: "#ef4444", module: "Vendor"     },
  role_changed:      { label: "Role Changed",        icon: "👤", color: "#8b5cf6", module: "Settings"   },
};

function hrExportCSV(rows, cols, filename) {
  const hdr  = cols.map((c) => `"${c.label}"`).join(",");
  const body = rows.map((r) => cols.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([hdr + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename + ".csv"; a.click();
  URL.revokeObjectURL(url);
}
function hrExportExcel(rows, cols, filename) {
  const thStyle = `style="background:#0f172a;color:#fff;padding:8px 12px;border:1px solid #1e293b;font-size:12px;text-align:left"`;
  const tdStyle = `style="padding:7px 12px;border:1px solid #e2e8f0;font-size:12px"`;
  const hdr  = `<tr>${cols.map((c) => `<th ${thStyle}>${c.label}</th>`).join("")}</tr>`;
  const body = rows.map((r) => `<tr>${cols.map((c) => `<td ${tdStyle}>${r[c.key] ?? ""}</td>`).join("")}</tr>`).join("");
  const html = `<html><head><meta charset="utf-8"/></head><body><table border="1">${hdr}${body}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename + ".xls"; a.click();
  URL.revokeObjectURL(url);
}
function hrExportPDF(title, rows, cols) {
  const hdr  = cols.map((c) => `<th>${c.label}</th>`).join("");
  const body = rows.map((r, i) => `<tr style="background:${i%2===0?"#f8fafc":"#fff"}">${cols.map((c) => `<td>${r[c.key] ?? ""}</td>`).join("")}</tr>`).join("");
  const w = window.open("", "_blank");
  w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    *{box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1e293b;margin:24px}
    h2{font-size:18px;font-weight:700;margin-bottom:4px;color:#0f172a}
    .meta{font-size:10px;color:#94a3b8;margin-bottom:16px}
    table{border-collapse:collapse;width:100%;margin-top:8px}
    th{background:#0f172a;color:#fff;padding:9px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:.04em}
    td{padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:11px;vertical-align:top}
    .print-btn{margin-bottom:14px;padding:7px 20px;background:#0f172a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px}
    @media print{.print-btn{display:none}body{margin:10px}}</style></head><body>
    <h2>${title}</h2><div class="meta">Exported: ${new Date().toLocaleString("en-IN")} · ${rows.length} records</div>
    <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    <table><thead><tr>${hdr}</tr></thead><tbody>${body}</tbody></table>
  </body></html>`);
  w.document.close();
}

function HRFilterBar({ search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo, vendorFilter, setVendorFilter, vendorList, itemFilter, setItemFilter, allItems, machineFilter, setMachineFilter, machineLog, serialFilter, setSerialFilter, showVendor=true, showItem=true, showMachine=false, showSerial=false, onReset }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-3" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Global search…"
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500/40 w-52" />
      </div>
      <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
        className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="From date" />
      <span className="text-slate-600 text-xs">→</span>
      <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
        className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="To date" />
      {showVendor && (
        <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Vendors</option>
          {vendorList.map((v) => <option key={v.id||v.name} value={v.name}>{v.name}</option>)}
        </select>
      )}
      {showItem && (
        <select value={itemFilter} onChange={(e) => setItemFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Items</option>
          {allItems.map((i) => <option key={i.code} value={i.code}>{i.name} ({i.code})</option>)}
        </select>
      )}
      {showMachine && (
        <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Machines</option>
          {[...new Set(machineLog.map((m) => m.bomKey))].map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
      {showSerial && (
        <input value={serialFilter} onChange={(e) => setSerialFilter(e.target.value)} placeholder="Serial No…"
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40 w-32" />
      )}
      {(search||dateFrom||dateTo||vendorFilter||itemFilter||machineFilter||serialFilter) && (
        <button onClick={onReset} className="text-[10px] font-bold text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.14] transition-all">✕ Reset</button>
      )}
    </div>
  );
}

function HRExportBar({ onCSV, onExcel, onPDF }) {
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={onCSV}   className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.2] transition-all">CSV</button>
      <button onClick={onExcel} className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.2] transition-all">Excel</button>
      <button onClick={onPDF}   className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/[0.08] text-slate-400 hover:text-white hover:border-white/[0.2] transition-all">PDF</button>
    </div>
  );
}

const HR_TABS = [
  { id: "activity",   label: "Activity Log",      icon: "📋" },
  { id: "purchase",   label: "Purchase History",  icon: "🛒" },
  { id: "machine",    label: "Machine History",   icon: "🔧" },
  { id: "inventory",  label: "Inventory Movement",icon: "📦" },
  { id: "stock",      label: "Current Stock",     icon: "📊" },
  { id: "lowstock",   label: "Low Stock",         icon: "🔴" },
  { id: "vendor",     label: "Vendor History",    icon: "🏭" },
  { id: "pending",    label: "Pending History",   icon: "⏳" },
  { id: "reports",    label: "Reports Dashboard", icon: "📊" },
];

function parseHRDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function inDateRange(dateStr, from, to) {
  if (!from && !to) return true;
  const d = parseHRDate(dateStr);
  if (!d) return true;
  const [y,mo,da] = dateStr.split("T")[0] ? dateStr.split("T")[0].split("-") : [null,null,null];
  const iso = d.toISOString().slice(0,10);
  if (from && iso < from) return false;
  if (to   && iso > to)   return false;
  return true;
}
function fmtTs(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
}

function HistoryPage({ auditLog, pos, inwardLog, outwardLog, pendingLog, machineLog, items, vendorList, bomDefs }) {
  const [tab,           setTab]           = useState("activity");
  const [search,        setSearch]        = useState("");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [vendorFilter,  setVendorFilter]  = useState("");
  const [itemFilter,    setItemFilter]    = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [serialFilter,  setSerialFilter]  = useState("");

  const allItems = Object.values(items).flat();
  const q = search.toLowerCase();

  const resetFilters = () => { setSearch(""); setDateFrom(""); setDateTo(""); setVendorFilter(""); setItemFilter(""); setMachineFilter(""); setSerialFilter(""); };

  const matchDate = (dateStr) => {
    if (!dateFrom && !dateTo) return true;
    if (!dateStr) return false;
    // dateStr is like "5 May 2025" (en-IN locale) or ISO
    // Try to parse it
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const iso = d.toISOString().slice(0, 10);
    if (dateFrom && iso < dateFrom) return false;
    if (dateTo   && iso > dateTo)   return false;
    return true;
  };

  // ── ACTIVITY LOG ──
  const activityRows = auditLog.filter((a) => {
    if (!matchDate(a.ts)) return false;
    if (vendorFilter && a.vendor !== vendorFilter) return false;
    if (itemFilter   && a.itemCode !== itemFilter)  return false;
    if (q && !`${a.action}${a.ref}${a.vendor}${a.itemCode}${a.module}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const activityCols = [
    { key: "date",   label: "Date" },
    { key: "module", label: "Module" },
    { key: "type_label", label: "Action Type" },
    { key: "action", label: "Description" },
    { key: "ref",    label: "Reference" },
    { key: "vendor", label: "Vendor" },
    { key: "itemCode", label: "Item Code" },
    { key: "qty_fmt",  label: "Qty" },
    { key: "amount_fmt", label: "Amount" },
  ];
  const activityExport = activityRows.map((a) => ({ ...a, type_label: AUDIT_META[a.type]?.label || a.type, qty_fmt: a.qty || "", amount_fmt: a.amount ? `₹${a.amount}` : "" }));

  // ── PURCHASE HISTORY ──
  const purchaseRows = pos.filter((p) => {
    if (!matchDate(p.date)) return false;
    if (vendorFilter && p.vendor !== vendorFilter) return false;
    if (q && !`${p.id}${p.vendor}${(p.lineItems||[]).map(l=>l.name+l.code).join("")}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const purchaseCols = [
    { key: "id",          label: "PO #" },
    { key: "vendor",      label: "Vendor" },
    { key: "date",        label: "Order Date" },
    { key: "orderedDate", label: "Ordered Date" },
    { key: "receivedDate",label: "Received Date" },
    { key: "status",      label: "Status" },
    { key: "itemCount",   label: "Items" },
    { key: "totalQty",    label: "Total Qty" },
    { key: "amount_fmt",  label: "Amount" },
  ];
  const purchaseExport = purchaseRows.map((p) => ({
    ...p,
    itemCount:  (p.lineItems||[]).length,
    totalQty:   (p.lineItems||[]).reduce((s,l)=>s+(l.qty||0),0),
    amount_fmt: `₹${(p.amount||0).toLocaleString("en-IN")}`,
  }));

  // ── MACHINE HISTORY ──
  const machineRows = machineLog.filter((m) => {
    if (!matchDate(m.createdDate)) return false;
    if (machineFilter && m.bomKey !== machineFilter) return false;
    if (serialFilter  && !m.serialNo.toLowerCase().includes(serialFilter.toLowerCase())) return false;
    if (q && !`${m.bomKey}${m.bomLabel}${m.serialNo}${m.stage}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const machineCols = [
    { key: "bomKey",        label: "Machine" },
    { key: "bomLabel",      label: "Model" },
    { key: "serialNo",      label: "Serial No" },
    { key: "stage",         label: "Current Stage" },
    { key: "status",        label: "Status" },
    { key: "createdDate",   label: "Created Date" },
    { key: "completedDate", label: "Ready Date" },
    { key: "stageCount",    label: "Stage Steps" },
  ];
  const machineExport = machineRows.map((m) => ({ ...m, stageCount: (m.history||[]).length, completedDate: m.completedDate || "—" }));

  // ── INVENTORY MOVEMENT ──
  const inwardMapped  = inwardLog.map((e)  => ({ ...e, mvType: e.fromPO ? "PO Inward" : "Manual Inward", direction: "+", refCol: e.fromPO || "Manual", dateRaw: e.date }));
  const outwardMapped = outwardLog.map((e) => ({ ...e, mvType: e.type === "bom" ? "BOM Issue" : "Manual Outward", direction: "−", refCol: e.ref, dateRaw: e.date,
    code: (e.items||[])[0]?.code || "", name: (e.items||[])[0]?.name || e.label, qty: e.type==="bom" ? (e.units||0) : ((e.items||[])[0]?.issueQty||0) }));
  const invRows = [...inwardMapped, ...outwardMapped]
    .filter((r) => {
      if (!matchDate(r.dateRaw)) return false;
      if (vendorFilter && r.vendor !== vendorFilter) return false;
      if (itemFilter   && r.code  !== itemFilter)    return false;
      if (q && !`${r.mvType}${r.code||""}${r.item||r.name||""}${r.refCol}${r.vendor||""}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a,b) => new Date(b.dateRaw||0) - new Date(a.dateRaw||0));
  const invCols = [
    { key: "dateRaw",  label: "Date" },
    { key: "mvType",   label: "Type" },
    { key: "direction",label: "In/Out" },
    { key: "code",     label: "Item Code" },
    { key: "itemName", label: "Item" },
    { key: "qty",      label: "Qty" },
    { key: "unit",     label: "Unit" },
    { key: "vendor",   label: "Vendor" },
    { key: "refCol",   label: "Reference" },
  ];
  const invExport = invRows.map((r) => ({ ...r, itemName: r.item || r.name || "" }));

  // ── CURRENT STOCK REPORT ── (live snapshot of every item)
  const stockFlat = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const stockReportRows = stockFlat.filter((i) => {
    if (itemFilter && i.code !== itemFilter) return false;
    if (q && !`${i.code}${i.name}${i.category}${i.location || ""}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  const stockReportCols = [
    { key: "code",        label: "Item Code" },
    { key: "name",        label: "Item" },
    { key: "category",    label: "Category" },
    { key: "stock_fmt",   label: "On Hand" },
    { key: "reserved_fmt",label: "Reserved" },
    { key: "available_fmt",label: "Available" },
    { key: "min",         label: "Min" },
    { key: "status_label",label: "Status" },
    { key: "value_fmt",   label: "Stock Value" },
  ];
  const stockReportExport = stockReportRows.map((i) => ({
    ...i,
    stock_fmt:     `${i.stock} ${i.unit || ""}`.trim(),
    reserved_fmt:  `${i.reservedStock ?? 0} ${i.unit || ""}`.trim(),
    available_fmt: `${i.availableStock ?? i.stock} ${i.unit || ""}`.trim(),
    status_label:  i.status === "critical" ? "Critical" : i.status === "warning" ? "Low" : "Safe",
    value_fmt:     i.lastPurchaseRate ? `₹${(i.stock * i.lastPurchaseRate).toLocaleString("en-IN")}` : "—",
  }));

  // ── LOW STOCK REPORT ── (status critical/warning OR available ≤ reorder level)
  const lowStockRows = stockReportRows.filter((i) =>
    i.status === "critical" || i.status === "warning" ||
    (i.reorderLevel > 0 && (i.availableStock ?? i.stock) <= i.reorderLevel)
  ).sort((a, b) => {
    const order = { critical: 0, warning: 1, safe: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3) || (a.stock - a.min) - (b.stock - b.min);
  });
  const lowStockCols = [
    { key: "code",        label: "Item Code" },
    { key: "name",        label: "Item" },
    { key: "category",    label: "Category" },
    { key: "stock_fmt",   label: "On Hand" },
    { key: "available_fmt",label: "Available" },
    { key: "min",         label: "Min" },
    { key: "reorderLevel",label: "Reorder Lvl" },
    { key: "shortage_fmt",label: "Shortage" },
    { key: "status_label",label: "Status" },
    { key: "vendor",      label: "Preferred Vendor" },
  ];
  const lowStockExport = lowStockRows.map((i) => {
    const shortage = Math.max(0, i.min - i.stock);
    const v = (i.vendorLinks || []).find((x) => x.role === "Preferred") || (i.vendorLinks || [])[0];
    return {
      ...i,
      stock_fmt:     `${i.stock} ${i.unit || ""}`.trim(),
      available_fmt: `${i.availableStock ?? i.stock} ${i.unit || ""}`.trim(),
      shortage_fmt:  shortage > 0 ? `${shortage} ${i.unit || ""}`.trim() : "—",
      status_label:  i.status === "critical" ? "Critical" : i.status === "warning" ? "Low" : "At reorder",
      vendor:        v?.vendorName || i.vendor || "—",
    };
  });

  // ── VENDOR HISTORY ──
  const vendorMap = {};
  pos.forEach((p) => {
    if (!vendorMap[p.vendor]) vendorMap[p.vendor] = { vendor: p.vendor, orders: 0, value: 0, received: 0, itemNames: new Set() };
    vendorMap[p.vendor].orders++;
    vendorMap[p.vendor].value += p.amount || 0;
    if (p.status === "received") vendorMap[p.vendor].received++;
    (p.lineItems||[]).forEach((l) => vendorMap[p.vendor].itemNames.add(l.name));
  });
  const vendorRows = Object.values(vendorMap)
    .filter((v) => {
      if (vendorFilter && v.vendor !== vendorFilter) return false;
      if (q && !v.vendor.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a,b) => b.value - a.value);
  const vendorCols = [
    { key: "vendor",     label: "Vendor" },
    { key: "orders",     label: "Total Orders" },
    { key: "received",   label: "Received" },
    { key: "delivRate",  label: "Delivery Rate" },
    { key: "value_fmt",  label: "Purchase Value" },
    { key: "itemList",   label: "Items Purchased" },
  ];
  const vendorExport = vendorRows.map((v) => ({ ...v, delivRate: v.orders ? `${Math.round((v.received/v.orders)*100)}%` : "—", value_fmt: `₹${v.value.toLocaleString("en-IN")}`, itemList: [...v.itemNames].join("; ") }));

  // ── PENDING HISTORY ──
  const pendingFulfilled = auditLog.filter((a) => a.type === "pending_fulfilled");
  const pendingCols = [
    { key: "code",    label: "Item Code" },
    { key: "name",    label: "Item Name" },
    { key: "bomKey",  label: "BOM / Machine" },
    { key: "serialNo",label: "Serial No" },
    { key: "pendingQty", label: "Pending Qty" },
    { key: "date",    label: "Issued Date" },
    { key: "status",  label: "Status" },
  ];
  const pendingCurrentRows = pendingLog.filter((p) => {
    if (!matchDate(p.date)) return false;
    if (itemFilter && p.code !== itemFilter) return false;
    if (q && !`${p.code}${p.name||""}${p.bomKey}${p.serialNo||""}`.toLowerCase().includes(q)) return false;
    return true;
  }).map((p) => ({ ...p, name: p.name || p.code, status: "Pending" }));
  const pendingFulfilledRows = pendingFulfilled.filter((a) => {
    if (itemFilter && a.itemCode !== itemFilter) return false;
    if (q && !`${a.itemCode}${a.itemName}${a.ref}${a.serialNo}`.toLowerCase().includes(q)) return false;
    return true;
  }).map((a) => ({ code: a.itemCode, name: a.itemName, bomKey: a.ref, serialNo: a.serialNo, pendingQty: a.qty, date: a.date, status: "Fulfilled" }));
  const pendingAllRows = [...pendingCurrentRows, ...pendingFulfilledRows];
  const pendingExport  = pendingAllRows;

  // ── REPORTS: computed ──
  const monthlyPurchase = (() => {
    const map = {};
    pos.forEach((p) => {
      if (!p.date) return;
      const d = new Date(p.date);
      if (isNaN(d)) return;
      const key = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      map[key] = (map[key] || 0) + (p.amount || 0);
    });
    return Object.entries(map).map(([month, amount]) => ({ month, amount }));
  })();
  const vendorPurchase = vendorRows.slice(0, 8).map((v) => ({ name: v.vendor.length > 14 ? v.vendor.slice(0,13)+"…" : v.vendor, value: v.value }));
  const machineStatus = (() => {
    const c = { completed: 0, active: 0 };
    machineLog.forEach((m) => { c[m.status] = (c[m.status] || 0) + 1; });
    return [{ name: "Active", value: c.active || 0, fill: "#3b82f6" }, { name: "Completed", value: c.completed || 0, fill: "#22c55e" }];
  })();
  const stageBreakdown = (() => {
    const c = {};
    machineLog.filter((m) => m.status !== "completed").forEach((m) => { c[m.stage] = (c[m.stage] || 0) + 1; });
    return Object.entries(c).map(([stage, count]) => ({ stage, count }));
  })();
  const invConsumption = (() => {
    const map = {};
    outwardLog.forEach((e) => {
      (e.items || []).forEach((it) => {
        map[it.code] = { code: it.code, name: it.name, qty: (map[it.code]?.qty || 0) + (it.issueQty || 0) };
      });
    });
    return Object.values(map).sort((a,b) => b.qty - a.qty).slice(0, 10);
  })();
  const inwardByMonth = (() => {
    const map = {};
    inwardLog.forEach((e) => {
      if (!e.date) return;
      const d = new Date(e.date);
      if (isNaN(d)) return;
      const key = d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
      map[key] = (map[key] || 0) + (e.qty || 0);
    });
    return Object.entries(map).map(([month, qty]) => ({ month, qty }));
  })();

  const CARD_STYLE = { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12 };

  return (
    <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
      <Topbar title="History & Reports" subtitle="Permanent audit trail — all ERP activity" />

      {/* ── Tabs ── */}
      <div className="flex-shrink-0 flex items-center gap-1 px-6 pt-4 pb-0 flex-wrap" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {HR_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold rounded-t-lg transition-all relative"
            style={tab===t.id ? { color:"#60a5fa", background:"rgba(59,130,246,0.1)", borderBottom:"2px solid #3b82f6" } : { color:"#475569" }}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── Filters (not on Reports tab) ── */}
      {tab !== "reports" && (
        <HRFilterBar
          search={search} setSearch={setSearch}
          dateFrom={dateFrom} setDateFrom={setDateFrom}
          dateTo={dateTo} setDateTo={setDateTo}
          vendorFilter={vendorFilter} setVendorFilter={setVendorFilter} vendorList={vendorList}
          itemFilter={itemFilter} setItemFilter={setItemFilter} allItems={allItems}
          machineFilter={machineFilter} setMachineFilter={setMachineFilter} machineLog={machineLog}
          serialFilter={serialFilter} setSerialFilter={setSerialFilter}
          showVendor={["activity","purchase","inventory","vendor"].includes(tab)}
          showItem={["activity","inventory","pending"].includes(tab)}
          showMachine={tab==="machine"}
          showSerial={tab==="machine"}
          onReset={resetFilters}
        />
      )}

      {/* ── Tab Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ─── ACTIVITY LOG ─── */}
        {tab === "activity" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Activity Log</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{activityRows.length} records — every ERP action is permanently logged here</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(activityExport,activityCols,"activity-log")} onExcel={()=>hrExportExcel(activityExport,activityCols,"activity-log")} onPDF={()=>hrExportPDF("Activity Log",activityExport,activityCols)} />
            </div>
            {activityRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No activity recorded yet. Start using the ERP to see entries here.</div>
            ) : (
              <div className="space-y-1">
                {activityRows.map((a) => {
                  const meta = AUDIT_META[a.type] || { label: a.type, icon: "•", color: "#64748b" };
                  return (
                    <div key={a.id} className="flex items-start gap-3 px-4 py-3 rounded-xl hover:bg-white/[0.025] transition-all" style={CARD_STYLE}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 mt-0.5"
                           style={{ background: meta.color + "18", border: `1px solid ${meta.color}30` }}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: meta.color + "18", color: meta.color }}>{meta.label}</span>
                          <span className="text-xs font-medium text-white">{a.action}</span>
                          {a.ref && <span className="text-[10px] text-slate-500 font-mono">{a.ref}</span>}
                        </div>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          {a.vendor    && <span className="text-[10px] text-slate-500">Vendor: <span className="text-slate-400">{a.vendor}</span></span>}
                          {a.itemCode  && <span className="text-[10px] text-slate-500">Item: <span className="text-slate-400">{a.itemCode}</span></span>}
                          {a.qty !== 0 && a.qty && <span className="text-[10px] text-slate-500">Qty: <span className="text-slate-400">{a.qty}</span></span>}
                          {a.amount > 0 && <span className="text-[10px] text-slate-500">₹<span className="text-slate-400">{a.amount.toLocaleString("en-IN")}</span></span>}
                          <span className="text-[10px] text-slate-600">{fmtTs(a.ts)}</span>
                        </div>
                      </div>
                      <div className="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: "rgba(255,255,255,0.04)", color: "#64748b" }}>{a.module}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── PURCHASE HISTORY ─── */}
        {tab === "purchase" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Purchase History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{purchaseRows.length} purchase orders</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(purchaseExport,purchaseCols,"purchase-history")} onExcel={()=>hrExportExcel(purchaseExport,purchaseCols,"purchase-history")} onPDF={()=>hrExportPDF("Purchase History",purchaseExport,purchaseCols)} />
            </div>
            {purchaseRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No purchase orders match the current filters.</div>
            ) : (
              <div className="space-y-3">
                {purchaseRows.map((p) => {
                  const STATUS_COLOR = { pending:"#f59e0b", approved:"#3b82f6", ordered:"#6366f1", received:"#22c55e", rejected:"#ef4444", overdue:"#f97316" };
                  const sc = STATUS_COLOR[p.status] || "#64748b";
                  const totalAmt = (p.amount||0).toLocaleString("en-IN");
                  return (
                    <div key={p.id} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: sc+"18", border:`1px solid ${sc}30` }}>🛒</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{p.id}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background:sc+"18", color:sc }}>{p.status}</span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{p.vendor}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 flex-wrap text-right">
                          <div><div className="text-[10px] text-slate-500">Items</div><div className="text-xs font-bold text-white">{(p.lineItems||[]).length}</div></div>
                          <div><div className="text-[10px] text-slate-500">Total Qty</div><div className="text-xs font-bold text-white">{(p.lineItems||[]).reduce((s,l)=>s+(l.qty||0),0)}</div></div>
                          <div><div className="text-[10px] text-slate-500">Amount</div><div className="text-sm font-black" style={{color:sc}}>₹{totalAmt}</div></div>
                        </div>
                      </div>
                      {/* Line items */}
                      <div className="mt-3 pt-3 border-t border-white/[0.05] grid gap-1">
                        {(p.lineItems||[]).map((li, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400"><span className="text-slate-600 font-mono mr-2">{li.code}</span>{li.name}</span>
                            <span className="text-slate-300">{li.qty} {li.unit} @ ₹{li.rate}</span>
                          </div>
                        ))}
                      </div>
                      {/* Timeline */}
                      {(p.activityLog||[]).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/[0.05] flex flex-wrap gap-x-4 gap-y-1">
                          {(p.activityLog||[]).map((al, i) => (
                            <span key={i} className="text-[10px] text-slate-500">{al.action}: <span className="text-slate-400">{al.date}</span>{al.note ? ` · ${al.note}` : ""}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── MACHINE HISTORY ─── */}
        {tab === "machine" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Machine History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{machineRows.length} machines tracked</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(machineExport,machineCols,"machine-history")} onExcel={()=>hrExportExcel(machineExport,machineCols,"machine-history")} onPDF={()=>hrExportPDF("Machine History",machineExport,machineCols)} />
            </div>
            {machineRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No machine records match current filters.</div>
            ) : (
              <div className="space-y-3">
                {machineRows.map((m) => {
                  const isComplete = m.status === "completed";
                  const STAGE_C = { "BOM Issued":"#3b82f6","Assembly":"#6366f1","Mechanical":"#8b5cf6","Electrical":"#f59e0b","Trial":"#fb923c","Ready":"#22c55e" };
                  const stageColor = STAGE_C[m.stage] || "#64748b";
                  return (
                    <div key={m.id} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background:stageColor+"18", border:`1px solid ${stageColor}30` }}>🔧</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black text-white">{m.bomKey}</span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:stageColor+"18", color:stageColor }}>{m.stage}</span>
                              {isComplete && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(34,197,94,0.12)", color:"#4ade80" }}>✓ Completed</span>}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">{m.bomLabel} {m.serialNo && <span className="text-slate-500 font-mono ml-2">S/N: {m.serialNo}</span>}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-5 text-right flex-wrap">
                          <div><div className="text-[10px] text-slate-500">Created</div><div className="text-[11px] font-bold text-white">{m.createdDate}</div></div>
                          {isComplete && <div><div className="text-[10px] text-slate-500">Completed</div><div className="text-[11px] font-bold" style={{color:"#4ade80"}}>{m.completedDate}</div></div>}
                          <div><div className="text-[10px] text-slate-500">Steps</div><div className="text-[11px] font-bold text-white">{(m.history||[]).length}</div></div>
                        </div>
                      </div>
                      {/* Stage timeline */}
                      <div className="mt-3 pt-3 border-t border-white/[0.05]">
                        <div className="text-[10px] text-slate-600 mb-2 uppercase tracking-wider">Stage Timeline</div>
                        <div className="flex flex-wrap gap-2">
                          {(m.history||[]).map((h, i) => {
                            const sc = STAGE_C[h.stage] || "#64748b";
                            return (
                              <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background:sc+"12", border:`1px solid ${sc}25` }}>
                                <span className="text-[10px] font-bold" style={{color:sc}}>{h.stage}</span>
                                <span className="text-[9px] text-slate-500">{h.date}</span>
                                {h.note && <span className="text-[9px] text-slate-600">· {h.note}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── INVENTORY MOVEMENT ─── */}
        {tab === "inventory" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Inventory Movement History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{invRows.length} movements — inward, outward, BOM issues</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(invExport,invCols,"inventory-movement")} onExcel={()=>hrExportExcel(invExport,invCols,"inventory-movement")} onPDF={()=>hrExportPDF("Inventory Movement",invExport,invCols)} />
            </div>
            {invRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No inventory movements recorded yet.</div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border:"1px solid rgba(255,255,255,0.06)" }}>
                <div className="grid text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5"
                     style={{ gridTemplateColumns:"90px 130px 50px 90px 1fr 70px 60px 120px 120px", background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <div>Date</div><div>Type</div><div>Dir</div><div>Code</div><div>Item</div><div className="text-right">Qty</div><div>Unit</div><div>Vendor</div><div>Reference</div>
                </div>
                {invRows.map((r, i) => {
                  const isIn = r.direction === "+";
                  return (
                    <div key={i} className="grid items-center px-4 py-2.5 text-xs hover:bg-white/[0.025] transition-all"
                         style={{ gridTemplateColumns:"90px 130px 50px 90px 1fr 70px 60px 120px 120px", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                      <div className="text-slate-500 text-[10px]">{r.dateRaw}</div>
                      <div><span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background:isIn?"rgba(16,185,129,0.12)":"rgba(245,158,11,0.12)", color:isIn?"#34d399":"#fbbf24" }}>{r.mvType}</span></div>
                      <div className="font-black text-base" style={{color:isIn?"#34d399":"#f87171"}}>{r.direction}</div>
                      <div className="text-slate-400 font-mono text-[10px]">{r.code}</div>
                      <div className="text-slate-300 truncate">{r.item || r.name || r.label || "—"}</div>
                      <div className="text-right font-bold text-white">{r.qty}</div>
                      <div className="text-slate-500">{r.unit}</div>
                      <div className="text-slate-400 truncate text-[10px]">{r.vendor || "—"}</div>
                      <div className="text-slate-500 truncate text-[10px]">{r.refCol}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── CURRENT STOCK REPORT ─── */}
        {tab === "stock" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Current Stock Report</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{stockReportRows.length} items — live on-hand / reserved / available</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(stockReportExport,stockReportCols,"current-stock")} onExcel={()=>hrExportExcel(stockReportExport,stockReportCols,"current-stock")} onPDF={()=>hrExportPDF("Current Stock Report",stockReportExport,stockReportCols)} />
            </div>
            {stockReportRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No items match the current filters.</div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={{ border:"1px solid rgba(255,255,255,0.06)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background:"rgba(255,255,255,0.03)" }}>
                      {stockReportCols.map((c) => (
                        <th key={c.key} className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stockReportExport.map((r, i) => (
                      <tr key={r.code || i} className="hover:bg-white/[0.025] transition-all" style={{ borderTop:"1px solid rgba(255,255,255,0.04)" }}>
                        {stockReportCols.map((c) => (
                          <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key==="code"?"font-mono text-slate-400 text-[10px]":"text-slate-300"}`}>
                            {c.key === "status_label"
                              ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: r.status==="critical"?"rgba(239,68,68,0.15)":r.status==="warning"?"rgba(245,158,11,0.15)":"rgba(34,197,94,0.12)", color: r.status==="critical"?"#f87171":r.status==="warning"?"#fbbf24":"#4ade80" }}>{r[c.key]}</span>
                              : (r[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── LOW STOCK REPORT ─── */}
        {tab === "lowstock" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Low Stock Report</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{lowStockRows.length} items at/below minimum or reorder level — order soon</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(lowStockExport,lowStockCols,"low-stock")} onExcel={()=>hrExportExcel(lowStockExport,lowStockCols,"low-stock")} onPDF={()=>hrExportPDF("Low Stock Report",lowStockExport,lowStockCols)} />
            </div>
            {lowStockRows.length === 0 ? (
              <div className="text-center py-20 text-green-400 text-sm">✅ All stock levels are healthy.</div>
            ) : (
              <div className="rounded-xl overflow-x-auto" style={{ border:"1px solid rgba(255,255,255,0.06)" }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ background:"rgba(255,255,255,0.03)" }}>
                      {lowStockCols.map((c) => (
                        <th key={c.key} className="text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockExport.map((r, i) => (
                      <tr key={r.code || i} className="hover:bg-white/[0.025] transition-all" style={{ borderTop:"1px solid rgba(255,255,255,0.04)" }}>
                        {lowStockCols.map((c) => (
                          <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.key==="code"?"font-mono text-slate-400 text-[10px]":"text-slate-300"}`}>
                            {c.key === "status_label"
                              ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: r.status==="critical"?"rgba(239,68,68,0.15)":r.status==="warning"?"rgba(245,158,11,0.15)":"rgba(251,146,60,0.15)", color: r.status==="critical"?"#f87171":r.status==="warning"?"#fbbf24":"#fb923c" }}>{r[c.key]}</span>
                              : (r[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ─── VENDOR HISTORY ─── */}
        {tab === "vendor" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Vendor History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{vendorRows.length} vendors — purchase value and delivery performance</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(vendorExport,vendorCols,"vendor-history")} onExcel={()=>hrExportExcel(vendorExport,vendorCols,"vendor-history")} onPDF={()=>hrExportPDF("Vendor History",vendorExport,vendorCols)} />
            </div>
            {vendorRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No vendor data available.</div>
            ) : (
              <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                {vendorRows.map((v) => {
                  const delivRate = v.orders ? Math.round((v.received / v.orders) * 100) : 0;
                  const vd = vendorList.find((x) => x.name === v.vendor) || {};
                  return (
                    <div key={v.vendor} className="rounded-xl p-4" style={CARD_STYLE}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-white">{v.vendor}</div>
                          {vd.phone && <div className="text-[10px] text-slate-500 mt-0.5">📞 {vd.phone}</div>}
                          {vd.email && <div className="text-[10px] text-slate-500">✉ {vd.email}</div>}
                          {vd.category && <div className="text-[10px] text-slate-600 mt-1">{vd.category}</div>}
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-black text-white">₹{v.value.toLocaleString("en-IN")}</div>
                          <div className="text-[10px] text-slate-500">Total Value</div>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-3">
                        <div className="rounded-lg p-2 text-center" style={{ background:"rgba(59,130,246,0.08)" }}>
                          <div className="text-sm font-black text-blue-400">{v.orders}</div>
                          <div className="text-[9px] text-slate-500">Orders</div>
                        </div>
                        <div className="rounded-lg p-2 text-center" style={{ background:"rgba(34,197,94,0.08)" }}>
                          <div className="text-sm font-black text-green-400">{v.received}</div>
                          <div className="text-[9px] text-slate-500">Received</div>
                        </div>
                        <div className="rounded-lg p-2 text-center" style={{ background: delivRate >= 80 ? "rgba(34,197,94,0.08)" : delivRate >= 50 ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)" }}>
                          <div className="text-sm font-black" style={{ color: delivRate >= 80 ? "#4ade80" : delivRate >= 50 ? "#fbbf24" : "#f87171" }}>{delivRate}%</div>
                          <div className="text-[9px] text-slate-500">Delivery</div>
                        </div>
                      </div>
                      {/* Delivery bar */}
                      <div className="mt-3">
                        <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background:"rgba(255,255,255,0.06)" }}>
                          <div className="h-full rounded-full transition-all" style={{ width:`${delivRate}%`, background: delivRate>=80?"#22c55e":delivRate>=50?"#f59e0b":"#ef4444" }} />
                        </div>
                      </div>
                      {v.itemNames.size > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/[0.05]">
                          <div className="text-[9px] text-slate-600 mb-1.5 uppercase tracking-wider">Items Purchased</div>
                          <div className="flex flex-wrap gap-1">
                            {[...v.itemNames].slice(0,6).map((n,i) => (
                              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background:"rgba(255,255,255,0.05)", color:"#94a3b8" }}>{n}</span>
                            ))}
                            {v.itemNames.size > 6 && <span className="text-[9px] text-slate-600">+{v.itemNames.size-6} more</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── PENDING HISTORY ─── */}
        {tab === "pending" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-bold text-white">Pending Material History</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{pendingCurrentRows.length} pending · {pendingFulfilledRows.length} fulfilled</div>
              </div>
              <HRExportBar onCSV={()=>hrExportCSV(pendingExport,pendingCols,"pending-history")} onExcel={()=>hrExportExcel(pendingExport,pendingCols,"pending-history")} onPDF={()=>hrExportPDF("Pending History",pendingExport,pendingCols)} />
            </div>
            {pendingAllRows.length === 0 ? (
              <div className="text-center py-20 text-slate-600 text-sm">No pending material records.</div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border:"1px solid rgba(255,255,255,0.06)" }}>
                <div className="grid text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5"
                     style={{ gridTemplateColumns:"90px 1fr 130px 110px 80px 80px", background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                  <div>Code</div><div>Item Name</div><div>BOM / Machine</div><div>Serial No</div><div className="text-right">Qty</div><div className="text-center">Status</div>
                </div>
                {pendingAllRows.map((p, i) => (
                  <div key={i} className="grid items-center px-4 py-2.5 text-xs hover:bg-white/[0.025] transition-all"
                       style={{ gridTemplateColumns:"90px 1fr 130px 110px 80px 80px", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                    <div className="text-slate-400 font-mono text-[10px]">{p.code}</div>
                    <div className="text-slate-300">{p.name}</div>
                    <div className="text-slate-500 text-[10px]">{p.bomKey}</div>
                    <div className="text-slate-500 font-mono text-[10px]">{p.serialNo || "—"}</div>
                    <div className="text-right font-bold text-white">{p.pendingQty}</div>
                    <div className="text-center">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={p.status==="Fulfilled"?{background:"rgba(34,197,94,0.12)",color:"#4ade80"}:{background:"rgba(249,115,22,0.12)",color:"#fb923c"}}>{p.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── REPORTS DASHBOARD ─── */}
        {tab === "reports" && (
          <div className="space-y-6">
            {/* KPI summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label:"Total PO Value",  value:`₹${pos.reduce((s,p)=>s+(p.amount||0),0).toLocaleString("en-IN")}`, icon:"💰", color:"#3b82f6" },
                { label:"Total POs",       value:pos.length,                                                           icon:"📋", color:"#6366f1" },
                { label:"Machines Tracked",value:machineLog.length,                                                    icon:"🔧", color:"#22c55e" },
                { label:"Inward Entries",  value:inwardLog.length,                                                     icon:"📥", color:"#10b981" },
              ].map((k) => (
                <div key={k.label} className="rounded-xl p-4" style={CARD_STYLE}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{k.icon}</span>
                    <span className="text-[10px] text-slate-500">{k.label}</span>
                  </div>
                  <div className="text-xl font-black" style={{color:k.color}}>{k.value}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Monthly Purchase */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-3">Monthly Purchase Value (₹)</div>
                {monthlyPurchase.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No data</div> : (
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={monthlyPurchase} margin={{top:4,right:4,left:0,bottom:4}}>
                      <defs><linearGradient id="hrPG" x1="0" y1="0" x2="0" y2="1"><stop offset="10%" stopColor="#3b82f6" stopOpacity={0.25}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="month" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"#0d1018",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11}} />
                      <Area type="monotone" dataKey="amount" stroke="#3b82f6" strokeWidth={2} fill="url(#hrPG)" name="Amount ₹" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Vendor Wise Purchase */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-3">Vendor-wise Purchase Value (₹)</div>
                {vendorPurchase.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No data</div> : (
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={vendorPurchase} margin={{top:4,right:4,left:0,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" tick={{fill:"#475569",fontSize:8}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"#0d1018",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11}} />
                      <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]} name="Amount ₹" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Machine Production */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-1">Machine Production Report</div>
                <div className="text-[10px] text-slate-500 mb-3">{machineLog.filter(m=>m.status==="completed").length} completed · {machineLog.filter(m=>m.status!=="completed").length} active</div>
                {machineLog.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No machines tracked yet</div> : (
                  <div className="space-y-2">
                    {machineStatus.map((s) => (
                      <div key={s.name} className="flex items-center gap-3">
                        <div className="w-20 text-[10px] text-slate-400">{s.name}</div>
                        <div className="flex-1 h-5 rounded-full overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                          <div className="h-full rounded-full flex items-center pl-2 transition-all" style={{width:`${machineLog.length ? (s.value/machineLog.length*100) : 0}%`, background:s.fill, minWidth:s.value>0?24:0}}>
                            {s.value > 0 && <span className="text-[9px] font-black text-white">{s.value}</span>}
                          </div>
                        </div>
                        <div className="text-xs font-bold text-white w-6 text-right">{s.value}</div>
                      </div>
                    ))}
                    {stageBreakdown.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-white/[0.05]">
                        <div className="text-[9px] text-slate-600 mb-2 uppercase tracking-wider">Active by Stage</div>
                        <div className="flex flex-wrap gap-2">
                          {stageBreakdown.map((s) => {
                            const STAGE_C={"BOM Issued":"#3b82f6","Assembly":"#6366f1","Mechanical":"#8b5cf6","Electrical":"#f59e0b","Trial":"#fb923c","Ready":"#22c55e"};
                            const c = STAGE_C[s.stage]||"#64748b";
                            return <span key={s.stage} className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{background:c+"18",color:c}}>{s.stage}: {s.count}</span>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Inventory Consumption */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-3">Top 10 — Inventory Consumption (Outward)</div>
                {invConsumption.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No outward records yet</div> : (
                  <div className="space-y-1.5">
                    {invConsumption.map((it, i) => {
                      const max = invConsumption[0].qty;
                      return (
                        <div key={it.code} className="flex items-center gap-2">
                          <div className="text-[9px] text-slate-600 w-3">{i+1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] text-slate-300 truncate">{it.name} <span className="text-slate-600 font-mono">{it.code}</span></div>
                            <div className="h-1 rounded-full mt-0.5 overflow-hidden" style={{background:"rgba(255,255,255,0.05)"}}>
                              <div className="h-full rounded-full" style={{width:`${(it.qty/max)*100}%`, background:`hsl(${220-i*20},70%,55%)`}} />
                            </div>
                          </div>
                          <div className="text-[10px] font-bold text-white w-8 text-right">{it.qty}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inward Report */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-3">Inward Report — Monthly Volume</div>
                {inwardByMonth.length === 0 ? <div className="text-center text-slate-600 py-8 text-xs">No inward data</div> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={inwardByMonth} margin={{top:4,right:4,left:0,bottom:4}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="month" tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <YAxis tick={{fill:"#475569",fontSize:9}} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{background:"#0d1018",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,fontSize:11}} />
                      <Bar dataKey="qty" fill="#10b981" radius={[4,4,0,0]} name="Qty" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Pending Material Report */}
              <div className="rounded-xl p-4" style={CARD_STYLE}>
                <div className="text-xs font-bold text-white mb-3">Pending Material Report</div>
                <div className="flex items-center gap-4 mb-3">
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(249,115,22,0.08)"}}>
                    <div className="text-lg font-black text-orange-400">{pendingLog.length}</div>
                    <div className="text-[9px] text-slate-500">Open Pending</div>
                  </div>
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(34,197,94,0.08)"}}>
                    <div className="text-lg font-black text-green-400">{pendingFulfilled.length}</div>
                    <div className="text-[9px] text-slate-500">Fulfilled</div>
                  </div>
                  <div className="rounded-lg px-3 py-2 text-center" style={{background:"rgba(59,130,246,0.08)"}}>
                    <div className="text-lg font-black text-blue-400">{[...new Set(pendingLog.map(p=>p.issueId).filter(Boolean))].length}</div>
                    <div className="text-[9px] text-slate-500">Machines Pending</div>
                  </div>
                </div>
                {pendingLog.length > 0 && (
                  <div className="space-y-1">
                    {pendingLog.slice(0,6).map((p,i) => (
                      <div key={i} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400 truncate">{p.name || p.code}</span>
                        <span className="text-orange-400 font-bold ml-2 flex-shrink-0">×{p.pendingQty}</span>
                      </div>
                    ))}
                    {pendingLog.length > 6 && <div className="text-[9px] text-slate-600">+{pendingLog.length-6} more</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Outward Report table */}
            <div className="rounded-xl p-4" style={CARD_STYLE}>
              <div className="text-xs font-bold text-white mb-3">Outward Report — Recent BOM Issues & Manual</div>
              {outwardLog.length === 0 ? <div className="text-center text-slate-600 py-6 text-xs">No outward entries</div> : (
                <div className="space-y-1.5">
                  {outwardLog.slice(0,10).map((e,i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-white/[0.04] text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={e.type==="bom"?{background:"rgba(245,158,11,0.12)",color:"#fbbf24"}:{background:"rgba(251,146,60,0.12)",color:"#fb923c"}}>{e.type==="bom"?"BOM":"Manual"}</span>
                        <span className="text-slate-300">{e.ref}</span>
                        {e.serialNo && <span className="text-slate-500 font-mono text-[10px]">S/N:{e.serialNo}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <span className="text-slate-500 text-[10px]">{(e.items||[]).length} items</span>
                        <span className="text-slate-400 text-[10px]">{e.date}</span>
                      </div>
                    </div>
                  ))}
                  {outwardLog.length > 10 && <div className="text-[10px] text-slate-600 pt-1">+{outwardLog.length-10} more entries</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ROLES & PERMISSIONS ─────────────────────────────────────────────────────

const ROLE_CONFIG = {
  Admin: {
    label: "Admin", icon: "👑", color: "#6366f1", badge: "Full Access",
    pages: ["dashboard","inventory","inward","outward","pending","pipeline","machines","vendors","analytics","ai","history","settings"],
    actions: {
      inventory: { add: true,  edit: true,  delete: true,  adjust: true  },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: true  },
      outward:   { bom: true,  manual: true,  editBOM: true  },
      machines:  { updateStage: true  },
      vendors:   { add: true,  edit: true,  delete: true  },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
    },
  },
  "Purchase Manager": {
    label: "Purchase Manager", icon: "🛒", color: "#3b82f6", badge: "Purchase",
    pages: ["dashboard","inventory","inward","pipeline","vendors","history","analytics"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: false },
      outward:   { bom: false, manual: false, editBOM: false },
      machines:  { updateStage: false },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: false, clear: false },
    },
  },
  "Store Manager": {
    label: "Store Manager", icon: "📦", color: "#22c55e", badge: "Store",
    pages: ["dashboard","inventory","inward","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: true  },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: true,  editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
    },
  },
  Production: {
    label: "Production", icon: "🔧", color: "#f59e0b", badge: "Production",
    pages: ["dashboard","inventory","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: false, editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: false },
      pending:   { fulfill: true,  clear: false },
    },
  },
};

// ─── EMPTY STATE ─────────────────────────────────────────────────────────────

function EmptyState({ icon = "📭", title = "Nothing here yet", desc = "", action = null }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center select-none">
      <div className="text-5xl mb-4" style={{ opacity: 0.3 }}>{icon}</div>
      <div className="text-sm font-bold text-slate-400 mb-1.5">{title}</div>
      {desc && <div className="text-xs text-slate-600 max-w-xs leading-relaxed">{desc}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ─── LOADING SPINNER ─────────────────────────────────────────────────────────

function Spinner({ size = 20, color = "#3b82f6" }) {
  return (
    <div className="animate-spin" style={{ width: size, height: size, borderRadius: "50%", border: `2px solid rgba(255,255,255,0.08)`, borderTopColor: color }} />
  );
}

// ─── GLOBAL SEARCH ────────────────────────────────────────────────────────────

function GlobalSearch({ items, pos, vendorList, machineLog, onClose, onNavigate }) {
  const [q,         setQ]         = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => { setActiveIdx(-1); }, [q]);

  const allItems = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const lq = q.trim().toLowerCase();

  const SC    = { critical: "#ef4444", warning: "#f59e0b", safe: "#22c55e" };
  const SLbl  = { critical: "Critical", warning: "Low Stock", safe: "In Stock" };
  const SBg   = { critical: "#ef444420", warning: "#f59e0b20", safe: "#22c55e20" };
  const LIMIT = 5;

  const matchedItems = lq.length < 2 ? [] : allItems.filter((i) =>
    i.name.toLowerCase().includes(lq) ||
    i.code.toLowerCase().includes(lq) ||
    (i.category || "").toLowerCase().includes(lq) ||
    (i.location || "").toLowerCase().includes(lq) ||
    (i.status || "").toLowerCase().includes(lq)
  );
  const matchedPOs = lq.length < 2 ? [] : pos.filter((p) =>
    p.id.toLowerCase().includes(lq) ||
    p.vendor.toLowerCase().includes(lq) ||
    (p.status || "").toLowerCase().includes(lq) ||
    (p.lineItems || []).some((l) => l.name.toLowerCase().includes(lq) || (l.code || "").toLowerCase().includes(lq))
  );
  const matchedVendors = lq.length < 2 ? [] : vendorList.filter((v) =>
    v.name.toLowerCase().includes(lq) ||
    (v.category || "").toLowerCase().includes(lq) ||
    (v.phone || "").includes(lq) ||
    (v.contactPerson || "").toLowerCase().includes(lq) ||
    (v.email || "").toLowerCase().includes(lq)
  );
  const matchedMachines = lq.length < 2 ? [] : machineLog.filter((m) =>
    m.bomKey.toLowerCase().includes(lq) ||
    (m.bomLabel || "").toLowerCase().includes(lq) ||
    (m.serialNo || "").toLowerCase().includes(lq) ||
    (m.stage || "").toLowerCase().includes(lq) ||
    (m.status || "").toLowerCase().includes(lq)
  );

  const CATS = [
    {
      type: "item", label: "Items & Inventory", color: "#22c55e",
      total: matchedItems.length,
      rows: matchedItems.slice(0, LIMIT).map((i) => ({
        nav: "inventory", icon: "📦", color: SC[i.status] || "#64748b",
        label: i.name,
        badge: { text: SLbl[i.status] || i.status, bg: SBg[i.status] || "#64748b20", color: SC[i.status] || "#64748b" },
        sub: [i.code, i.category, `${i.stock} ${i.unit}`, i.location].filter(Boolean).join("  ·  "),
      })),
    },
    {
      type: "po", label: "Purchase Orders", color: "#3b82f6",
      total: matchedPOs.length,
      rows: matchedPOs.slice(0, LIMIT).map((p) => {
        const stClr = { pending:"#f59e0b", approved:"#3b82f6", ordered:"#8b5cf6", received:"#22c55e", rejected:"#ef4444" }[p.status] || "#64748b";
        return {
          nav: "pipeline", icon: "🛒", color: "#3b82f6",
          label: p.id,
          badge: { text: p.status, bg: stClr + "20", color: stClr },
          sub: `${p.vendor}  ·  ₹${(p.amount || 0).toLocaleString("en-IN")}  ·  ${p.date || ""}`,
        };
      }),
    },
    {
      type: "vendor", label: "Vendors", color: "#6366f1",
      total: matchedVendors.length,
      rows: matchedVendors.slice(0, LIMIT).map((v) => ({
        nav: "vendors", icon: "🏭", color: "#6366f1",
        label: v.name,
        badge: v.category ? { text: v.category, bg: "#6366f120", color: "#6366f1" } : null,
        sub: [v.contactPerson, v.phone, v.email].filter(Boolean).join("  ·  ") || "No contact info",
      })),
    },
    {
      type: "machine", label: "Machines & Serial Numbers", color: "#8b5cf6",
      total: matchedMachines.length,
      rows: matchedMachines.slice(0, LIMIT).map((m) => {
        const stClr = { "In Progress":"#f59e0b", "Completed":"#22c55e", "Pending":"#64748b", "On Hold":"#ef4444" }[m.status] || "#64748b";
        return {
          nav: "machines", icon: "🔧", color: "#8b5cf6",
          label: m.serialNo ? `${m.bomKey} — S/N: ${m.serialNo}` : m.bomKey,
          badge: { text: m.status, bg: stClr + "20", color: stClr },
          sub: `${m.bomLabel || m.bomKey}  ·  Stage: ${m.stage}`,
        };
      }),
    },
  ].filter((c) => c.total > 0);

  const flatRows    = CATS.flatMap((c) => c.rows);
  const totalResults = matchedItems.length + matchedPOs.length + matchedVendors.length + matchedMachines.length;

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((p) => Math.min(p + 1, flatRows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((p) => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && activeIdx >= 0 && flatRows[activeIdx]) { onNavigate(flatRows[activeIdx].nav); onClose(); }
  };

  useEffect(() => {
    if (activeIdx < 0 || !listRef.current) return;
    listRef.current.querySelector(`[data-idx="${activeIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  let flatIdx = 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh]"
         style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
         onClick={onClose}>
      <div className="w-full max-w-xl mx-4 overflow-hidden"
           style={{ background: "#0c1018", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, boxShadow: "0 32px 80px rgba(0,0,0,0.9)" }}
           onClick={(e) => e.stopPropagation()}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <span className="text-slate-500 text-base flex-shrink-0">🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search items, POs, vendors, machines, serial numbers…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none" />
          {q ? <button onClick={() => setQ("")} className="text-slate-600 hover:text-slate-400 text-xs transition-colors">✕</button> : null}
          <kbd className="text-[10px] text-slate-600 flex-shrink-0" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 5, padding: "2px 6px" }}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: "58vh" }}>
          {lq.length < 2 ? (
            <div className="px-5 py-10 text-center">
              <div className="text-slate-600 text-xs mb-4">Search across the entire ERP system</div>
              <div className="flex flex-wrap justify-center gap-2">
                {["Items","Purchase Orders","Vendors","Machines","Serial Numbers"].map((t) => (
                  <span key={t} className="text-[10px] px-2.5 py-1 rounded-full text-slate-500" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>{t}</span>
                ))}
              </div>
            </div>
          ) : CATS.length === 0 ? (
            <EmptyState icon="🔍" title={`No results for "${q}"`} desc="Try a different keyword, item code, PO number, or vendor name." />
          ) : (
            <div className="p-2">
              {CATS.map((cat) => {
                const showAll = cat.total > LIMIT;
                return (
                  <div key={cat.type} className="mb-3">
                    {/* Group header */}
                    <div className="flex items-center justify-between px-3 py-1.5">
                      <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-[0.1em]">{cat.label}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: cat.color + "18", color: cat.color }}>{cat.total}</span>
                    </div>
                    {cat.rows.map((r) => {
                      const myIdx   = flatIdx++;
                      const isActive = myIdx === activeIdx;
                      return (
                        <button key={myIdx} data-idx={myIdx}
                          onClick={() => { onNavigate(r.nav); onClose(); }}
                          onMouseEnter={() => setActiveIdx(myIdx)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
                          style={{ background: isActive ? "rgba(255,255,255,0.07)" : "" }}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                               style={{ background: r.color + "18", border: `1px solid ${r.color}28` }}>{r.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-semibold text-white truncate">{r.label}</span>
                              {r.badge && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 capitalize"
                                      style={{ background: r.badge.bg, color: r.badge.color, border: `1px solid ${r.badge.color}30` }}>
                                  {r.badge.text}
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate mt-0.5">{r.sub}</div>
                          </div>
                          <span className="text-[10px] flex-shrink-0 transition-colors" style={{ color: isActive ? "#94a3b8" : "transparent" }}>↵</span>
                        </button>
                      );
                    })}
                    {showAll && (
                      <button onClick={() => { onNavigate(cat.rows[0]?.nav); onClose(); }}
                        className="w-full text-left px-3 py-1.5 text-[10px] transition-opacity"
                        style={{ color: cat.color }}
                        onMouseEnter={(e) => e.currentTarget.style.opacity = "0.65"}
                        onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}>
                        Show all {cat.total} {cat.label.toLowerCase()} →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="flex items-center gap-3 text-[10px] text-slate-700">
            <span>↑↓ Navigate</span><span>↵ Select</span><span>ESC Close</span>
          </div>
          {lq.length >= 2 && (
            <span className="text-[10px] text-slate-700">{totalResults} result{totalResults !== 1 ? "s" : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── NOTIFICATION PANEL ───────────────────────────────────────────────────────

function NotificationPanel({ notifications, dismissed, onClose, onNavigate, onDismiss, onDismissAll }) {
  const TYPE_CFG = {
    critical:      { label: "Critical Stock",     icon: "🔴", color: "#ef4444", nav: "inventory" },
    warning:       { label: "Low Stock Alert",    icon: "🟠", color: "#f59e0b", nav: "inventory" },
    approval:      { label: "Approval Pending",   icon: "📋", color: "#3b82f6", nav: "pipeline" },
    followup:      { label: "Follow-Up Due",      icon: "📞", color: "#8b5cf6", nav: "pipeline" },
    pending_alert: { label: "Pending Materials",  icon: "⏳", color: "#f97316", nav: "pending" },
    machine_ready: { label: "Machine Ready",      icon: "🏆", color: "#22c55e", nav: "machines" },
  };
  const active = notifications.filter((n) => !dismissed.has(n.id));
  const byType = {};
  active.forEach((n) => { (byType[n.type] = byType[n.type] || []).push(n); });

  return (
    <div className="fixed inset-0 z-[90]" onClick={onClose}>
      <div className="absolute right-4 top-16 w-[360px] overflow-hidden"
           style={{ background: "#0c1018", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.8)" }}
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              Notifications
              {active.length > 0 && <span className="text-[10px] font-black text-white px-1.5 py-0.5 rounded-full" style={{ background: "#ef4444", minWidth: 18, textAlign: "center" }}>{active.length}</span>}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Live alerts from ERP data</div>
          </div>
          {active.length > 0 && (
            <button onClick={onDismissAll} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-white/[0.05]">Clear all</button>
          )}
        </div>

        {/* Notifications list */}
        <div className="overflow-y-auto" style={{ maxHeight: "70vh" }}>
          {active.length === 0 ? (
            <EmptyState icon="✅" title="All clear" desc="No active alerts at this time." />
          ) : (
            <div className="p-2">
              {Object.entries(byType).map(([type, items]) => {
                const cfg = TYPE_CFG[type] || { label: type, icon: "•", color: "#64748b", nav: "dashboard" };
                return (
                  <div key={type} className="mb-1">
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: cfg.color }}>
                      {cfg.icon} {cfg.label} ({items.length})
                    </div>
                    {items.slice(0, 4).map((n) => (
                      <div key={n.id} className="flex items-start gap-2 px-3 py-2.5 rounded-lg group transition-all"
                           onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                           onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                        <button className="flex-1 text-left" onClick={() => { onNavigate(cfg.nav); onClose(); }}>
                          <div className="text-[11px] font-semibold text-white leading-snug">{n.title}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{n.desc}</div>
                        </button>
                        <button onClick={() => onDismiss(n.id)}
                          className="text-[10px] text-slate-700 hover:text-slate-400 transition-colors flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                    {items.length > 4 && <div className="px-3 pb-1 text-[10px] text-slate-600">+{items.length - 4} more</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer tip */}
        <div className="px-4 py-2.5 text-[10px] text-slate-700" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          Alerts update automatically from live ERP data
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const { currentUser, canDo: authCanDo, canView, isLoading: authLoading } = useAuth();

  // Boot mode. In Supabase mode the DB is the single source of truth — state starts EMPTY
  // and is filled by the on-mount hydration, so no demo/stale data is ever shown.
  // Demo seed data loads ONLY when explicitly allowed (VITE_ALLOW_DEMO=true) and Supabase is off.
  const SUPA      = isSupabaseEnabled();
  const SEED_DEMO = ALLOW_DEMO && !SUPA;

  const [activePage,    setActivePage]    = useState("dashboard");
  const [collapsed,     setCollapsed]     = useState(false);
  const [showSearch,    setShowSearch]    = useState(false);
  const [showNotifs,    setShowNotifs]    = useState(false);
  const [dismissedIds,  setDismissedIds]  = useState(() => new Set());

  const [items, setItems] = useState(() => {
    // Supabase mode → start empty; the on-mount hydration is the source of truth (no demo flash).
    if (SUPA) return {};
    try {
      const s = localStorage.getItem("erp_items");
      if (s) {
        // Recompute status on load so the stock<=min business rule applies to data
        // saved under the older stock<min rule. Pure status refresh, no stock change.
        const parsed = JSON.parse(s);
        // Only iterate if the shape matches { category: [items] }; otherwise pass-through
        // to preserve the user's data even if it's in an unexpected shape.
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const refreshed = {};
          for (const [cat, list] of Object.entries(parsed)) {
            refreshed[cat] = Array.isArray(list)
              ? list.map((it) => ({ ...it, status: recomputeStatus(it.stock, it.min) }))
              : list;
          }
          return refreshed;
        }
        return parsed;
      }
    } catch {}
    if (!SEED_DEMO) return {};                 // demo disabled → empty, never fake data
    const out = {};
    for (const [cat, list] of Object.entries(inventoryData)) {
      out[cat] = list.map((item) => ({ ...item, history: buildInitialHistory(item.trend) }));
    }
    return out;
  });

  const [pos,        setPos]        = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_pos");        if (s) return JSON.parse(s); } catch {} return SEED_DEMO ? initialPOs : []; });
  const [vendorList, setVendorList] = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_vendors");    if (s) return JSON.parse(s); } catch {} return SEED_DEMO ? vendors : []; });
  const [bomDefs,    setBomDefs]    = useState(() => { if (SUPA) return {}; try { const s = localStorage.getItem("erp_bomdefs");    if (s) return JSON.parse(s); } catch {} return SEED_DEMO ? bomDefinitions : {}; });
  const [outwardLog, setOutwardLog] = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_outward");   if (s) return JSON.parse(s); } catch {} return []; });
  const [inwardLog,  setInwardLog]  = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_inward");    if (s) return JSON.parse(s); } catch {} return []; });
  const [pendingLog, setPendingLog] = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_pending");   if (s) return JSON.parse(s); } catch {} return []; });
  const [followUps,  setFollowUps]  = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_followups"); if (s) return JSON.parse(s); } catch {} return SEED_DEMO ? initialFollowUps : []; });
  const [machineLog, setMachineLog] = useState(() => { if (SUPA) return []; try { const s = localStorage.getItem("erp_machines");  if (s) return JSON.parse(s); } catch {} return []; });
  const [auditLog,   setAuditLog]   = useState(() => getAuditLog());
  const [settings,   setSettings]   = useState(() => { try { const s = localStorage.getItem("erp_settings"); if (s) return { ...SETTINGS_DEFAULTS, ...JSON.parse(s) }; } catch {} return { ...SETTINGS_DEFAULTS }; });

  // Save settings + propagate to all pages (now async — Supabase upsert when enabled)
  const handleSaveSettings = async (newSettings) => {
    console.info("[App] handleSaveSettings called");
    setSettings(newSettings);                            // optimistic UI
    const res = await saveSettings(newSettings);        // logs internally
    if (!res.success && typeof console !== "undefined") {
      console.warn("[App] handleSaveSettings: Supabase save failed —", res.error);
    }
  };

  // Realtime — re-fetch authoritative state on any row change. Handlers are stabilized with
  // useCallback so the channel subscribes ONCE, not on every render. items reconciliation is
  // debounced so a multi-line PO receive (which fires items + stock_movements + inward events
  // back-to-back) coalesces into a single refetch. This is also the rollback path: any failed
  // movement calls reconcileItems() to discard the optimistic UI and pull DB truth.
  const reconcileTimer = useRef(null);
  const reconcileItems = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => {
      fetchItems().then((i) => { if (i) setItems(i); });
    }, 150);
  }, []);
  // Surfaced when a stock movement is rejected (e.g. insufficient stock / concurrent edit).
  // The optimistic UI is reverted by reconcileItems(); this tells the operator why.
  const [stockError, setStockError] = useState(null);
  const stockErrTimer = useRef(null);
  const flashStockError = useCallback((msg) => {
    setStockError(msg);
    if (stockErrTimer.current) clearTimeout(stockErrTimer.current);
    stockErrTimer.current = setTimeout(() => setStockError(null), 6000);
  }, []);
  // In-flight PO-receive guard — blocks duplicate movement writes from rapid double-clicks
  // before the optimistic status flip to "received" has rendered.
  const receivingRef = useRef(new Set());
  const rtPos     = useCallback(() => { fetchPOs().then((p) => p && setPos(p)); }, []);
  const rtInward  = useCallback(() => { fetchInward().then((x) => x && setInwardLog(x)); }, []);
  const rtOutward = useCallback(() => { fetchOutward().then((x) => x && setOutwardLog(x)); }, []);
  const rtMach    = useCallback(() => { fetchMachines().then((m) => m && setMachineLog(m)); }, []);
  const rtPending = useCallback(() => { fetchPending().then((p) => p && setPendingLog(p)); }, []);
  useRealtimeTables({
    onItemsChange:     reconcileItems,
    onMovementsChange: reconcileItems,   // a ledger movement means stock changed → reconcile
    onPosChange:       rtPos,
    onInwardChange:    rtInward,
    onOutwardChange:   rtOutward,
    onMachinesChange:  rtMach,
    onPendingChange:   rtPending,
    // onAuditChange omitted — AuditHistoryPage re-fetches itself via subscribeAudit
  });

  // Hydrate all tables from Supabase on mount when Supabase enabled
  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    (async () => {
      console.info("[App] hydrating Supabase state on mount");
      const [s, v, i, b, p, inw, out, pend, fu, mac] = await Promise.all([
        loadSettings(), listVendors(), fetchItems(), fetchBOMs(),
        fetchPOs(), fetchInward(), fetchOutward(),
        fetchPending(), fetchFollowUps(), fetchMachines(),
      ]);
      if (cancelled) return;
      if (s) setSettings((prev) => ({ ...prev, ...s }));
      if (v) setVendorList(v);
      if (i && Object.keys(i).length >= 0) setItems(i);
      if (b && Object.keys(b).length >= 0) setBomDefs(b);
      if (p) setPos(p);
      if (inw)  setInwardLog(inw);
      if (out)  setOutwardLog(out);
      if (pend) setPendingLog(pend);
      if (fu)   setFollowUps(fu);
      if (mac)  setMachineLog(mac);
      console.info("[App] hydrated", {
        vendors: v?.length, items: Object.values(i || {}).reduce((s, l) => s + (l?.length || 0), 0),
        boms: Object.keys(b || {}).length, pos: p?.length,
        inward: inw?.length, outward: out?.length, pending: pend?.length,
        followups: fu?.length, machines: mac?.length,
      });
    })();
    return () => { cancelled = true; };
  }, []);


  // Persist all mutable state to localStorage so data survives page refresh
  // Legacy auto-persist — only fires in LOCAL mode. In Supabase mode each store handles its own cache.
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_items",     JSON.stringify(items));      } catch {} }, [items]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_pos",       JSON.stringify(pos));        } catch {} }, [pos]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_vendors",   JSON.stringify(vendorList)); } catch {} }, [vendorList]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_bomdefs",   JSON.stringify(bomDefs));    } catch {} }, [bomDefs]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_outward",   JSON.stringify(outwardLog)); } catch {} }, [outwardLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_inward",    JSON.stringify(inwardLog));  } catch {} }, [inwardLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_pending",   JSON.stringify(pendingLog)); } catch {} }, [pendingLog]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_followups", JSON.stringify(followUps));  } catch {} }, [followUps]);
  useEffect(() => { if (isSupabaseEnabled()) return; try { localStorage.setItem("erp_machines",  JSON.stringify(machineLog)); } catch {} }, [machineLog]);
  // auditLog is persisted by auditStore; just subscribe to keep state in sync
  useEffect(() => subscribeAudit((next) => setAuditLog(next)), []);

  // ── Ctrl+K global search ──
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowSearch((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auth gate — after all hooks
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400 text-xs" style={{ background: "#080a0f", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
        <div className="text-center">
          <div className="w-8 h-8 mx-auto mb-3 rounded-full animate-spin" style={{ border: "2px solid rgba(255,255,255,0.08)", borderTopColor: "#3b82f6" }} />
          <div>Restoring session…</div>
        </div>
      </div>
    );
  }
  if (!currentUser) return <LoginPage />;

  // ── Computed notifications (live, derived from existing state) ──
  const allItemsForNotif = Object.entries(items).flatMap(([cat, list]) => list.map((i) => ({ ...i, category: cat })));
  const notifications = [
    ...allItemsForNotif.filter((i) => i.status === "critical").map((i) => ({
      id: `critical-${i.code}`, type: "critical",
      title: `Critical: ${i.name}`,
      desc:  `Only ${i.stock} ${i.unit} remaining — minimum is ${i.min} ${i.unit}`,
    })),
    ...allItemsForNotif.filter((i) => i.status === "warning").map((i) => ({
      id: `warning-${i.code}`, type: "warning",
      title: `Low Stock: ${i.name}`,
      desc:  `${i.stock} ${i.unit} left, below minimum of ${i.min} ${i.unit}`,
    })),
    ...pos.filter((p) => p.status === "pending").map((p) => ({
      id: `approval-${p.id}`, type: "approval",
      title: `PO Approval Needed: ${p.id}`,
      desc:  `${p.vendor} · ₹${(p.amount || 0).toLocaleString("en-IN")} · ${(p.lineItems || []).length} item(s)`,
    })),
    ...followUps.map((f) => ({
      id: `followup-${f.id}`, type: "followup",
      title: `Follow-Up Due: ${f.poId}`,
      desc:  `${f.vendor} · Next: ${f.nextFollowUp}`,
    })),
    ...(pendingLog.length > 0 ? [{
      id: "pending_alert-all", type: "pending_alert",
      title: `${pendingLog.length} Pending Material${pendingLog.length > 1 ? "s" : ""} Awaiting`,
      desc:  `${[...new Set(pendingLog.map((p) => p.bomKey))].slice(0, 3).join(", ")}${pendingLog.length > 3 ? "…" : ""}`,
    }] : []),
    ...machineLog.filter((m) => m.status === "completed" && m.stage === "Ready").slice(0, 3).map((m) => ({
      id: `machine_ready-${m.id}`, type: "machine_ready",
      title: `Machine Ready: ${m.bomKey}`,
      desc:  `${m.bomLabel || ""}${m.serialNo ? " · S/N: " + m.serialNo : ""} · Completed ${m.completedDate || ""}`,
    })),
  ];
  const activeNotifs = notifications.filter((n) => !dismissedIds.has(n.id));

  const dismissNotif    = (id) => setDismissedIds((prev) => new Set([...prev, id]));
  const dismissAllNotifs = ()  => setDismissedIds((prev) => new Set([...prev, ...notifications.map((n) => n.id)]));

  const logAudit = (entry) => { appendAuditWithUser(entry); };

  const handleUpdateStock = async (category, code, delta, eventType = null) => {
    const dateStr = fmtDate(new Date());
    const event   = eventType || (delta > 0 ? "Restock" : "Usage");
    const before  = items[category]?.find((i) => i.code === code);
    // Optimistic local update (immediate UI)
    setItems((prev) => ({
      ...prev,
      [category]: prev[category].map((i) => {
        if (i.code !== code) return i;
        const newStock    = Math.max(0, i.stock + delta);
        const actualDelta = newStock - i.stock;
        return {
          ...i,
          stock:   newStock,
          status:  recomputeStatus(newStock, i.min),
          trend:   [...i.trend.slice(1), newStock],
          history: [{ date: dateStr, event, change: actualDelta, qty: newStock }, ...(i.history || [])],
        };
      }),
    }));
    // Persist to Supabase (no-op when local mode)
    if (isSupabaseEnabled()) {
      const res = await updateStockAndHistory(category, code, delta, event);
      if (!res.success) {
        console.warn("[App] handleUpdateStock: Supabase persist failed —", res.error);
        flashStockError(`${before?.name || code}: ${res.error || "movement rejected"}`);
        reconcileItems();   // revert optimistic UI to DB truth
        return { success: false, error: res.error };
      }
    }
    // Only log when called as a standalone manual adjust (no eventType from a calling flow).
    // BOM/Inward/Outward/Receive flows pass an eventType and log their own audit entries.
    if (!eventType && before) {
      const newStock = Math.max(0, before.stock + delta);
      logAudit({
        type: "stock_adjust", module: "Inventory",
        action: `Stock Adjusted: ${before.name} ${before.stock} → ${newStock} (${delta > 0 ? "+" : ""}${delta})`,
        ref: code, itemCode: code, itemName: before.name,
        qty: delta,
        oldValue: { stock: before.stock },
        newValue: { stock: newStock },
        details: { category, event },
      });
    }
    return { success: true };
  };

  // ── PO handlers ──
  const handleCreatePO = (data) => {
    const maxNum = pos.reduce((mx, p) => {
      const n = parseInt(p.id.replace("PO-", ""), 10);
      return isNaN(n) ? mx : Math.max(mx, n);
    }, 0);
    const dateStr = fmtDate(new Date());
    const newId   = `PO-${maxNum + 1}`;
    const count   = (data.lineItems || []).length;
    const newPO   = {
      ...data,
      id: newId, date: dateStr, receivedDate: null,
      status: data.status || "pending",
      activityLog: [
        { action: "Created PO", date: dateStr, note: `${count} item${count !== 1 ? "s" : ""} · ₹${(data.amount || 0).toLocaleString("en-IN")}` },
      ],
    };
    setPos((prev) => [newPO, ...prev]);
    if (isSupabaseEnabled()) poCreate(newPO).then((r) => { if (!r.success) console.warn("[App] PO create Supabase failed:", r.error); });
    logAudit({ type: "po_created", module: "Purchase", action: `PO Created: ${newId}`, ref: newId, vendor: data.vendor, amount: data.amount || 0, details: { items: count, status: "pending" } });
  };

  const handleUpdatePO = (id, updates) => {
    const dateStr = fmtDate(new Date());
    const po = pos.find((p) => p.id === id);
    let supabaseUpdates = { ...updates };
    setPos((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const log    = p.activityLog || [];
      const newLog = [...log];
      if (updates.status === "approved" && p.status !== "approved")
        newLog.push({ action: "Approved", date: dateStr });
      if (updates.status === "rejected" && p.status !== "rejected")
        newLog.push({ action: "Rejected", date: dateStr, note: updates.rejectReason || "No reason given" });
      supabaseUpdates.activityLog = newLog;
      return { ...p, ...updates, activityLog: newLog };
    }));
    if (isSupabaseEnabled()) poUpdate(id, supabaseUpdates).then((r) => { if (!r.success) console.warn("[App] PO update Supabase failed:", r.error); });
    if (updates.status === "approved" && po?.status !== "approved")
      logAudit({ type: "po_approved", module: "Purchase", action: `PO Approved: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0 });
    else if (updates.status === "rejected" && po?.status !== "rejected")
      logAudit({ type: "po_rejected", module: "Purchase", action: `PO Rejected: ${id}`, ref: id, vendor: po?.vendor, amount: po?.amount || 0, details: { reason: updates.rejectReason } });
    else if (po) {
      // Generic edit (priority, notes, line items, etc.) — log diff of changed fields only
      const ignored = new Set(["activityLog"]);
      const changed = {};
      const oldSnap = {};
      Object.keys(updates).forEach((k) => {
        if (ignored.has(k)) return;
        if (JSON.stringify(po[k]) !== JSON.stringify(updates[k])) {
          changed[k] = updates[k];
          oldSnap[k] = po[k];
        }
      });
      if (Object.keys(changed).length > 0) {
        logAudit({
          type: "po_edited", module: "Purchase",
          action: `PO Edited: ${id} (${Object.keys(changed).join(", ")})`,
          ref: id, vendor: po.vendor, amount: po.amount || 0,
          oldValue: oldSnap, newValue: changed,
        });
      }
    }
  };

  const handleReceivePO = (id) => {
    const po = pos.find((p) => p.id === id);
    if (!po) return;
    // Duplicate-write guard: already received, or a receive for this PO is already in flight.
    if (po.status === "received") { console.warn("[App] handleReceivePO: PO already received, ignoring", id); return; }
    if (receivingRef.current.has(id)) { console.warn("[App] handleReceivePO: receive already in flight, ignoring", id); return; }
    receivingRef.current.add(id);
    setTimeout(() => receivingRef.current.delete(id), 2000);  // self-heal so a later reverse→re-receive works
    const dateStr = fmtDate(new Date());

    // Pre-compute how much of each received line item can fulfill pending entries
    const lineDeductions = {}; // code -> { deduct, fMap }
    (po.lineItems || []).forEach((li) => {
      const pending = pendingLog.filter((p) => p.code === li.code && p.pendingQty > 0);
      if (pending.length === 0) return;
      let rem = li.qty;
      const fMap = new Map();
      for (const p of pending) {
        if (rem <= 0) break;
        const can = Math.min(p.pendingQty, rem);
        rem -= can;
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        fMap.set(key, can);
      }
      if (fMap.size > 0) lineDeductions[li.code] = { deduct: li.qty - rem, fMap };
    });

    // Update inventory: net of received qty minus auto-fulfilled pending qty
    setItems((prev) => {
      const next = { ...prev };
      po.lineItems.forEach((li) => {
        if (!next[li.category]) return;
        const deduct = lineDeductions[li.code]?.deduct || 0;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock    = Math.max(0, item.stock + li.qty - deduct);
          const actualDelta = newStock - item.stock;
          return {
            ...item,
            stock:            newStock,
            status:           recomputeStatus(newStock, item.min),
            trend:            [...item.trend.slice(1), newStock],
            lastPurchaseRate: li.rate || item.lastPurchaseRate,
            history: [{ date: dateStr, event: `PO: ${id}`, change: actualDelta, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item stock change to Supabase (net of auto-fulfilled pending)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) => {
        const deduct = lineDeductions[li.code]?.deduct || 0;
        const netDelta = li.qty - deduct;
        return updateStockAndHistory(li.category, li.code, netDelta, `PO: ${id}`);
      })).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReceivePO: some Supabase updates failed", failed);
          flashStockError(`PO ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Batch-update pendingLog for all auto-fulfilled items
    if (Object.keys(lineDeductions).length > 0) {
      const newPendingLog = pendingLog.reduce((acc, p) => {
        const ld = lineDeductions[p.code];
        if (!ld) { acc.push(p); return acc; }
        const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
        const can = ld.fMap.get(key) || 0;
        if (can) {
          const rem = p.pendingQty - can;
          if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
        } else { acc.push(p); }
        return acc;
      }, []);
      setPendingLog(newPendingLog);
      // Mirror to Supabase: for each pending row touched, decide update vs delete
      if (isSupabaseEnabled()) {
        pendingLog.forEach((p) => {
          const ld = lineDeductions[p.code];
          if (!ld) return;
          const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
          const can = ld.fMap.get(key) || 0;
          if (!can || !p.id) return;
          const rem = p.pendingQty - can;
          if (rem > 0) {
            pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can })
              .then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending update Supabase failed", r.error); });
          } else {
            pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] handleReceivePO: pending delete Supabase failed", r.error); });
          }
        });
      }
      // Notify Machine Tracker for any issueIds that are now fully cleared
      const affectedIds = [...new Set(
        [...Object.values(lineDeductions)].flatMap(({ fMap }) =>
          [...fMap.keys()].map((key) => {
            const p = pendingLog.find((p) => (p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`) === key);
            return p?.issueId;
          }).filter(Boolean)
        )
      )];
      affectedIds.forEach((issueId) => notifyMachineComplete(issueId, newPendingLog.filter((p) => p.issueId === issueId)));
    }

    const newLog = [...(po.activityLog || []), { action: "Received", date: dateStr, note: "Stock updated automatically" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: "received", receivedDate: dateStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: "received", receivedDate: dateStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO receive Supabase failed:", r.error); });
    setFollowUps((prev) => prev.filter((f) => f.poId !== id));
    if (isSupabaseEnabled()) deleteFollowUpsByPO(id).then((r) => { if (!r.success) console.warn("[App] FollowUp delete Supabase failed:", r.error); });
    logAudit({ type: "po_received", module: "Purchase", action: `PO Received: ${id}`, ref: id, vendor: po.vendor, amount: po.amount || 0, details: { items: (po.lineItems || []).length } });
    const inwardEntries = (po.lineItems || []).map((li, i) => ({
      id:     Date.now() + i,
      date:   dateStr,
      vendor: po.vendor,
      item:   li.name,
      code:   li.code,
      unit:   li.unit,
      qty:    li.qty,
      notes:  `Auto-received via ${id}`,
      fromPO: id,
    }));
    setInwardLog((prev) => [...inwardEntries, ...prev]);
    if (isSupabaseEnabled()) bulkCreateInward(inwardEntries).then((r) => { if (!r.success) console.warn("[App] Inward bulk Supabase failed:", r.error); });
  };

  const handleDeletePO = (id) => {
    const po = pos.find((p) => p.id === id);
    const isSuperAdmin = currentUser?.role === "super_admin";
    const wasReceived  = po?.status === "received";
    setPos((prev) => prev.filter((p) => p.id !== id));
    if (isSupabaseEnabled()) poDelete(id).then((r) => { if (!r.success) console.warn("[App] PO delete Supabase failed:", r.error); });
    logAudit({
      type: wasReceived ? "po_deleted_received" : "po_deleted",
      module: "Purchase",
      action: wasReceived
        ? `PO Deleted (was received) by ${isSuperAdmin ? "Super Admin" : "Admin"}: ${id}`
        : `PO Deleted: ${id}`,
      ref: id, vendor: po?.vendor, amount: po?.amount || 0,
      oldValue: po ? { status: po.status, amount: po.amount, items: (po.lineItems||[]).length } : null,
      newValue: null,
    });
  };

  // ── Super Admin corrections ──
  const handleReverseReceive = (id, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can reverse received POs" };
    const po = pos.find((p) => p.id === id);
    if (!po || po.status !== "received") return { success: false, error: "PO is not in 'received' state" };

    const dateStr = fmtDate(new Date());

    // Subtract back the qty added when receiving (optimistic local update)
    setItems((prev) => {
      const next = { ...prev };
      (po.lineItems || []).forEach((li) => {
        if (!next[li.category]) return;
        next[li.category] = next[li.category].map((item) => {
          if (item.code !== li.code) return item;
          const newStock = Math.max(0, item.stock - li.qty);
          return {
            ...item,
            stock:  newStock,
            status: recomputeStatus(newStock, item.min),
            trend:  [...item.trend.slice(1), newStock],
            history: [{ date: dateStr, event: `PO Receive Reversed: ${id}`, change: -li.qty, qty: newStock }, ...(item.history || [])],
          };
        });
      });
      return next;
    });

    // Persist each line-item reversal to Supabase (with item_history rows)
    if (isSupabaseEnabled()) {
      Promise.all((po.lineItems || []).map((li) =>
        updateStockAndHistory(li.category, li.code, -li.qty, `PO Receive Reversed: ${id}`)
      )).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) {
          console.warn("[App] handleReverseReceive: some Supabase updates failed", failed);
          flashStockError(`Reverse ${id}: ${failed.length} line item(s) failed — ${failed[0]?.error || "movement rejected"}`);
          reconcileItems();
        }
      });
    }

    // Revert PO status to "ordered" (or "pending" if no orderedDate)
    const revertStatus = po.orderedDate ? "ordered" : "pending";
    const newLog = [...(po.activityLog || []), { action: "Receive Reversed", date: dateStr, note: reason || "Reversed by Super Admin" }];
    setPos((prev) => prev.map((p) => p.id !== id ? p : { ...p, status: revertStatus, receivedDate: null, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(id, { status: revertStatus, receivedDate: null, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO reverse Supabase failed:", r.error); });

    // Remove inward entries linked to this PO
    setInwardLog((prev) => prev.filter((e) => e.fromPO !== id));
    if (isSupabaseEnabled()) deleteInwardByPO(id).then((r) => { if (!r.success) console.warn("[App] Inward delete Supabase failed:", r.error); });

    logAudit({
      type: "po_receive_reversed", module: "Purchase",
      action: `Receive Reversed: ${id}${reason ? ` — ${reason}` : ""}`,
      ref: id, vendor: po.vendor, amount: po.amount || 0,
      oldValue: { status: "received", receivedDate: po.receivedDate },
      newValue: { status: revertStatus, receivedDate: null },
      details: { reason, lineItems: (po.lineItems || []).length },
    });
    return { success: true };
  };

  const handleInventoryCorrection = async (category, code, newStock, reason = "") => {
    if (currentUser?.role !== "super_admin") return { success: false, error: "Only Super Admin can perform inventory corrections" };
    const item = items[category]?.find((i) => i.code === code);
    if (!item) return { success: false, error: "Item not found" };
    const oldStock = item.stock;
    const delta    = newStock - oldStock;
    const dateStr  = fmtDate(new Date());
    if (isSupabaseEnabled()) {
      const res = await updateStockAndHistory(category, code, delta, `Correction: ${reason || "Super Admin adjustment"}`);
      if (!res.success) { console.warn("[App] handleInventoryCorrection: Supabase failed —", res.error); return { success: false, error: res.error }; }
    }
    setItems((prev) => ({
      ...prev,
      [category]: prev[category].map((it) => it.code !== code ? it : {
        ...it,
        stock:  Math.max(0, newStock),
        status: recomputeStatus(Math.max(0, newStock), it.min),
        trend:  [...it.trend.slice(1), Math.max(0, newStock)],
        history: [{ date: dateStr, event: `Correction: ${reason || "Super Admin adjustment"}`, change: delta, qty: Math.max(0, newStock) }, ...(it.history || [])],
      }),
    }));
    logAudit({
      type: "inventory_correction", module: "Inventory",
      action: `Stock Correction: ${item.name} ${oldStock} → ${newStock}${reason ? ` (${reason})` : ""}`,
      ref: code, itemCode: code, itemName: item.name,
      qty: delta,
      oldValue: { stock: oldStock },
      newValue: { stock: newStock },
      details: { reason, category, delta },
    });
    return { success: true };
  };

  // ── Pipeline / follow-up handlers ──
  const handleConfirmOrder = (poId, etaStr) => {
    const po = pos.find((p) => p.id === poId);
    if (!po) return;
    const dateStr  = fmtDate(new Date());
    const nextDate = new Date(); nextDate.setDate(nextDate.getDate() + 1);
    const newLog   = [...(po.activityLog || []), { action: "Order Placed", date: dateStr, note: `ETA: ${etaStr}` }];
    setPos((prev) => prev.map((p) => p.id !== poId ? p : { ...p, status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }));
    if (isSupabaseEnabled()) poUpdate(poId, { status: "ordered", orderedDate: dateStr, eta: etaStr, activityLog: newLog }).then((r) => { if (!r.success) console.warn("[App] PO confirm Supabase failed:", r.error); });
    logAudit({ type: "po_ordered", module: "Purchase", action: `Order Placed: ${poId}`, ref: poId, vendor: po.vendor, amount: po.amount || 0, details: { eta: etaStr } });
    const newFU = {
      id: Date.now(),
      poId,
      vendor:       po.vendor,
      itemNames:    (po.lineItems || []).map((li) => li.name),
      eta:          etaStr,
      confirmedDate: dateStr,
      nextFollowUp:  fmtDate(nextDate),
      lastFollowUp:  null,
      frequency:     1,
    };
    setFollowUps((prev) => [...prev, newFU]);
    if (isSupabaseEnabled()) followupCreate(newFU).then((r) => { if (!r.success) console.warn("[App] FollowUp create Supabase failed:", r.error); });
  };

  const handleFollowUpDone = (id, freq, nextDateStr) => {
    const dateStr = fmtDate(new Date());
    const fu      = followUps.find((f) => f.id === id);
    if (fu) {
      setPos((prev) => prev.map((p) => {
        if (p.id !== fu.poId) return p;
        const log = p.activityLog || [];
        return { ...p, activityLog: [...log, { action: "Follow Up Done", date: dateStr, note: `Next: ${nextDateStr}` }] };
      }));
      logAudit({
        type: "followup_done", module: "Purchase",
        action: `Follow-Up: ${fu.poId} — Next: ${nextDateStr}`,
        ref: fu.poId, vendor: fu.vendor,
        oldValue: { lastFollowUp: fu.lastFollowUp, nextFollowUp: fu.nextFollowUp, frequency: fu.frequency },
        newValue: { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq },
      });
    }
    setFollowUps((prev) => prev.map((f) =>
      f.id !== id ? f : { ...f, lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }
    ));
    if (isSupabaseEnabled()) followupUpdate(id, { lastFollowUp: dateStr, nextFollowUp: nextDateStr, frequency: freq }).then((r) => { if (!r.success) console.warn("[App] FollowUp update Supabase failed:", r.error); });
  };

  const handleInwardComplete = (code, category, inwardQty) => {
    // Auto-fulfill pending entries for this item with the newly received stock
    if (category && inwardQty > 0) {
      const pendingForCode = pendingLog.filter((p) => p.code === code && p.pendingQty > 0);
      if (pendingForCode.length > 0) {
        let remaining = inwardQty;
        let totalToDeduct = 0;
        const fulfillments = [];
        for (const p of pendingForCode) {
          if (remaining <= 0) break;
          const canFulfill = Math.min(p.pendingQty, remaining);
          remaining -= canFulfill;
          totalToDeduct += canFulfill;
          fulfillments.push({ entry: p, canFulfill });
        }
        if (totalToDeduct > 0) {
          handleUpdateStock(category, code, -totalToDeduct, "Auto-fulfill pending");
          // Batch all fulfillments in one setPendingLog to avoid stale-closure overwrites
          const fulfillMap = new Map(fulfillments.map(({ entry, canFulfill }) => {
            const key = entry.issueId ? `${entry.issueId}::${entry.code}` : `${entry.code}::${entry.bomKey}::${entry.date}`;
            return [key, canFulfill];
          }));
          const newPendingLog = pendingLog.reduce((acc, p) => {
            const key = p.issueId ? `${p.issueId}::${p.code}` : `${p.code}::${p.bomKey}::${p.date}`;
            const can = fulfillMap.get(key);
            if (can) {
              const rem = p.pendingQty - can;
              if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
            } else { acc.push(p); }
            return acc;
          }, []);
          setPendingLog(newPendingLog);
          // Mirror to Supabase: for each fulfilled entry, update or delete
          if (isSupabaseEnabled()) {
            fulfillments.forEach(({ entry, canFulfill }) => {
              if (!entry.id) return;
              const rem = entry.pendingQty - canFulfill;
              if (rem > 0) {
                pendingUpdate(entry.id, { pendingQty: rem, issueQty: (entry.issueQty || 0) + canFulfill })
                  .then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending update Supabase failed", r.error); });
              } else {
                pendingDelete(entry.id).then((r) => { if (!r.success) console.warn("[App] handleInwardComplete: pending delete Supabase failed", r.error); });
              }
            });
          }
          // notify Machine Tracker for each issueId that is now fully cleared
          const affectedIds = [...new Set(fulfillments.map((f) => f.entry.issueId).filter(Boolean))];
          affectedIds.forEach((id) => {
            notifyMachineComplete(id, newPendingLog.filter((p) => p.issueId === id));
          });
        }
      }
    }
  };

  // ── Item handlers ── (routed through itemsStore: Supabase when enabled, localStorage otherwise)
  const handleCreateItemRow = async (category, newItem) => {
    console.log("%c[App] handleCreateItemRow CALLED", "color:#10b981;font-weight:bold", { code: newItem.code, category });
    let res;
    try {
      res = await itemCreate(category, newItem);
      console.log("%c[App] handleCreateItemRow → itemCreate returned:", "color:#10b981", res);
    } catch (thrown) {
      console.error("%c[App] handleCreateItemRow → itemCreate THREW:", "color:#ef4444;font-weight:bold", thrown);
      return { success: false, error: `itemCreate threw: ${thrown?.message || thrown}` };
    }
    if (!res.success) { console.warn("[App] item create failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: [...(prev[category] || []), res.item] }));
    return { success: true, item: res.item };
  };
  const handleUpdateItemRow = async (origCode, origCategory, updatedItem, newCategory) => {
    console.info("[App] handleUpdateItemRow", { origCode, origCategory, newCode: updatedItem.code, newCategory });
    const res = await itemUpdate(origCode, origCategory, updatedItem, newCategory);
    if (!res.success) { console.warn("[App] item update failed:", res.error); return { success: false, error: res.error }; }
    const target = newCategory || origCategory;
    setItems((prev) => {
      const next = { ...prev };
      next[origCategory] = (prev[origCategory] || []).filter((i) => i.code !== origCode);
      next[target] = [...(next[target] || []), { ...res.item, history: updatedItem.history || [] }];
      return next;
    });
    return { success: true, item: res.item };
  };
  const handleDeleteItemRow = async (category, code) => {
    console.info("[App] handleDeleteItemRow", { code, category });
    const res = await itemDelete(category, code);
    if (!res.success) { console.warn("[App] item delete failed:", res.error); return { success: false, error: res.error }; }
    setItems((prev) => ({ ...prev, [category]: (prev[category] || []).filter((i) => i.code !== code) }));
    return { success: true };
  };

  // ── Vendor handlers ── (routed through vendorsStore: Supabase when enabled, localStorage otherwise)
  const handleAddVendor = async (v) => {
    const res = await createVendor(v);
    if (!res.success) { console.warn("[App] handleAddVendor failed:", res.error); return; }
    setVendorList((prev) => [...prev, res.vendor]);
    logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Added: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };
  const handleEditVendor = async (upd) => {
    const res = await updateVendor(upd);
    if (!res.success) { console.warn("[App] handleEditVendor failed:", res.error); return; }
    setVendorList((prev) => prev.map((v) => v.id === res.vendor.id ? res.vendor : v));
    logAudit({ type: "vendor_edit", module: "Vendor", action: `Vendor Updated: ${res.vendor.name}`, ref: res.vendor.name, vendor: res.vendor.name });
  };
  const handleDeleteVendor = async (id) => {
    const v = vendorList.find((x) => x.id === id);
    const res = await deleteVendor(id);
    if (!res.success) { console.warn("[App] handleDeleteVendor failed:", res.error); return; }
    setVendorList((prev) => prev.filter((x) => x.id !== id));
    logAudit({ type: "vendor_delete", module: "Vendor", action: `Vendor Deleted: ${v?.name || id}`, ref: v?.name || "", vendor: v?.name || "" });
  };
  const handleBulkAddVendors = async (vendors) => {
    const res = await bulkCreateVendors(vendors);
    if (!res.success) { console.warn("[App] handleBulkAddVendors failed:", res.error); return; }
    setVendorList((prev) => [...prev, ...res.vendors]);
    res.vendors.forEach((v) => logAudit({ type: "vendor_add", module: "Vendor", action: `Vendor Imported: ${v.name}`, ref: v.name, vendor: v.name }));
  };

  // ── BOM / Outward handlers ──
  const handleUpdateBOM  = (key, newBom) => {
    setBomDefs((prev) => ({ ...prev, [key]: newBom }));
    if (isSupabaseEnabled()) bomUpdate(key, newBom).then((r) => { if (!r.success) console.warn("[App] BOM update Supabase failed:", r.error); });
    logAudit({ type: "bom_updated", module: "BOM", action: `BOM Updated: ${key}`, ref: key, details: { items: (newBom.items || []).length } });
  };

  const handleCreateBOM = (key, def) => {
    const k = (key || "").trim();
    if (!k) return { success: false, error: "BOM Key is required" };
    if (bomDefs[k]) return { success: false, error: "A BOM with this key already exists" };
    if (!(def.label || "").trim()) return { success: false, error: "Machine Model Name is required" };
    if (!(def.items || []).length) return { success: false, error: "At least one component is required" };
    const palette = ["#3b82f6","#6366f1","#8b5cf6","#ec4899","#f59e0b","#22c55e","#06b6d4","#14b8a6","#f97316","#a855f7"];
    const color = def.color || palette[Object.keys(bomDefs).length % palette.length];
    const newBom = {
      label: def.label.trim(),
      color,
      items: def.items.filter((i) => i.code && Number(i.qty) > 0).map((i) => ({ code: i.code, qty: Number(i.qty) })),
      rackCapacity: Math.max(0, parseInt(def.rackCapacity, 10) || 0),
    };
    setBomDefs((prev) => ({ ...prev, [k]: newBom }));
    if (isSupabaseEnabled()) bomCreate(k, newBom).then((r) => { if (!r.success) console.warn("[App] BOM create Supabase failed:", r.error); });
    logAudit({
      type: "bom_created", module: "BOM",
      action: `BOM Created: ${k} — ${newBom.label}`,
      ref: k,
      newValue: { key: k, label: newBom.label, items: newBom.items.length, rackCapacity: newBom.rackCapacity },
    });
    return { success: true };
  };

  const handleRenameBOM = (oldKey, newKey, newLabel) => {
    const nk = (newKey || "").trim();
    const nl = (newLabel || "").trim();
    if (!bomDefs[oldKey]) return { success: false, error: "BOM not found" };
    if (!nk) return { success: false, error: "BOM Key is required" };
    if (!nl) return { success: false, error: "Machine Model Name is required" };
    if (nk !== oldKey && bomDefs[nk]) return { success: false, error: "A BOM with this key already exists" };
    const old = bomDefs[oldKey];
    const keyChanged   = nk !== oldKey;
    const labelChanged = nl !== old.label;
    if (!keyChanged && !labelChanged) return { success: true, noop: true };

    setBomDefs((prev) => {
      const next = { ...prev };
      if (keyChanged) delete next[oldKey];
      next[nk] = { ...old, label: nl };
      return next;
    });
    if (isSupabaseEnabled()) {
      if (keyChanged) bomRename(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename Supabase failed:", r.error); });
      else bomUpdate(oldKey, { ...old, label: nl }).then((r) => { if (!r.success) console.warn("[App] BOM label update Supabase failed:", r.error); });
    }
    if (keyChanged || labelChanged) {
      setMachineLog((prev) => prev.map((m) => m.bomKey !== oldKey ? m : { ...m, bomKey: nk, bomLabel: nl }));
      setOutwardLog((prev) => prev.map((e) => e.ref !== oldKey ? e : { ...e, ref: nk, label: nl }));
      setPendingLog((prev) => prev.map((p) => p.bomKey !== oldKey ? p : { ...p, bomKey: nk, bomLabel: nl }));
      if (isSupabaseEnabled()) {
        updateMachineBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: machine cascade failed", r.error); });
        updateOutwardRef(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: outward cascade failed", r.error); });
        updatePendingBomKey(oldKey, nk, nl).then((r) => { if (!r.success) console.warn("[App] BOM rename: pending cascade failed", r.error); });
      }
    }
    logAudit({
      type: "bom_renamed", module: "BOM",
      action: keyChanged
        ? `BOM Renamed: ${oldKey} → ${nk} (${nl})`
        : `BOM Label Updated: ${oldKey} → "${nl}"`,
      ref: nk,
      oldValue: { key: oldKey, label: old.label },
      newValue: { key: nk,     label: nl },
    });
    return { success: true };
  };
  const handleAddOutward = (entry, pending) => {
    setOutwardLog((prev) => [entry, ...prev]);
    if (isSupabaseEnabled()) createOutward(entry).then((r) => { if (!r.success) console.warn("[App] Outward Supabase failed:", r.error); });
    if (pending && pending.length > 0) {
      const issueId = entry.id;
      const rows = pending.map((p) => ({ ...p, bomKey: entry.ref, bomLabel: entry.label, date: entry.date, issueId, serialNo: entry.serialNo || "" }));
      setPendingLog((prev) => [...rows, ...prev]);
      if (isSupabaseEnabled()) bulkCreatePending(rows).then((r) => { if (!r.success) console.warn("[App] Pending bulk-create Supabase failed:", r.error); });
    }
    if (entry.type === "bom") {
      logAudit({ type: "outward_bom", module: "Outward", action: `BOM Issued: ${entry.ref} × ${entry.units}`, ref: entry.ref, serialNo: entry.serialNo || "", qty: entry.units, details: { label: entry.label, issued: (entry.items || []).length, pending: (pending || []).length } });
    } else {
      const it = (entry.items || [])[0] || {};
      logAudit({ type: "outward_manual", module: "Outward", action: `Manual Outward: ${it.name || ""} × ${it.issueQty || 0}`, ref: it.code || "", itemCode: it.code || "", itemName: it.name || "", qty: it.issueQty || 0, details: { dept: entry.dept } });
    }
  };
  const handleClearPending  = () => {
    setPendingLog([]);
    if (isSupabaseEnabled()) clearAllPending().then((r) => { if (!r.success) console.warn("[App] Pending clear Supabase failed:", r.error); });
    logAudit({ type: "pending_cleared", module: "Pending", action: "All pending stock cleared", ref: "" });
  };

  // ── Machine Tracker handlers ──
  const handleCreateMachine = (bomKey, bomLabel, serialNo, date, issueId) => {
    const dateStr = date || fmtDate(new Date());
    logAudit({ type: "machine_created", module: "Machine", action: `Machine Created: ${bomKey}`, ref: bomKey, serialNo: serialNo || "", details: { bomLabel, issueId } });
    const newMachine = {
      id:          Date.now(),
      issueId:     issueId || null,
      bomKey,
      bomLabel,
      serialNo,
      stage:       "BOM Issued",
      status:      "active",
      createdDate: dateStr,
      completedDate: null,
      history:     [{ stage: "BOM Issued", date: dateStr, note: "BOM issued" }],
    };
    setMachineLog((prev) => [newMachine, ...prev]);
    if (isSupabaseEnabled()) machineCreate(newMachine).then((r) => { if (!r.success) console.warn("[App] Machine create Supabase failed:", r.error); });
  };

  const handleUpdateMachineStage = (machineId, newStage) => {
    const dateStr = fmtDate(new Date());
    const machine = machineLog.find((m) => m.id === machineId);
    const isComplete = newStage === "Ready";
    logAudit({ type: isComplete ? "machine_completed" : "machine_stage", module: "Machine", action: `${machine?.bomKey || ""} [${machine?.serialNo || ""}] → ${newStage}`, ref: machine?.bomKey || "", serialNo: machine?.serialNo || "", details: { from: machine?.stage, to: newStage, bomLabel: machine?.bomLabel } });
    setMachineLog((prev) => prev.map((m) => {
      if (m.id !== machineId) return m;
      return {
        ...m,
        stage:         newStage,
        status:        isComplete ? "completed" : "active",
        completedDate: isComplete ? dateStr : m.completedDate,
        history:       [...m.history, { stage: newStage, date: dateStr }],
      };
    }));
    if (isSupabaseEnabled() && machine) {
      machineUpdate(machineId, {
        stage: newStage,
        status: isComplete ? "completed" : "active",
        completedDate: isComplete ? dateStr : machine.completedDate,
        history: [...(machine.history || []), { stage: newStage, date: dateStr }],
      }).then((r) => { if (!r.success) console.warn("[App] Machine stage Supabase failed:", r.error); });
    }
  };

  // SERIAL-BASED start production. Takes the specific rack-machine id(s) the operator
  // selected and promotes ONLY those from "BOM Issued" (rack) → "Assembly" (active build).
  // The machine now leaves the rack and appears in the Machine Tracker.
  const handleStartProduction = (machineIds) => {
    const idArr  = Array.isArray(machineIds) ? machineIds : [machineIds];
    const idSet  = new Set(idArr);
    const targets = machineLog.filter((m) => idSet.has(m.id) && m.stage === "BOM Issued");
    if (targets.length === 0) return { success: false, error: "Select at least one machine on the rack" };
    const dateStr = fmtDate(new Date());
    setMachineLog((prev) => prev.map((m) => {
      if (!idSet.has(m.id) || m.stage !== "BOM Issued") return m;
      return {
        ...m,
        stage:   "Assembly",
        status:  "active",
        history: [...(m.history || []), { stage: "Assembly", date: dateStr, note: "Started production from rack" }],
      };
    }));
    if (isSupabaseEnabled()) {
      Promise.all(targets.map((m) =>
        machineUpdate(m.id, {
          stage: "Assembly",
          status: "active",
          history: [...(m.history || []), { stage: "Assembly", date: dateStr, note: "Started production from rack" }],
        })
      )).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) console.warn("[App] handleStartProduction: Supabase machine updates failed", failed);
      });
    }
    const serials = targets.map((m) => m.serialNo).filter(Boolean);
    logAudit({
      type: "production_started", module: "Machine",
      action: `Production Started: ${targets[0].bomKey} — ${serials.join(", ") || `${targets.length} machine(s)`}`,
      ref: targets[0].bomKey,
      serialNo: serials[0] || "",
      qty: targets.length,
      oldValue: { stage: "BOM Issued" },
      newValue: { stage: "Assembly", started: targets.length },
      details: { serialNos: serials },
    });
    return { success: true, count: targets.length, serials };
  };

  // Adds a "materials fully issued" note to Machine Tracker when an issueId is cleared
  const notifyMachineComplete = (issueId, newLog) => {
    if (!issueId || newLog.some((p) => p.issueId === issueId)) return;
    const dateStr = fmtDate(new Date());
    // Find machines that need the note BEFORE setMachineLog so we can mirror to Supabase
    const targets = machineLog.filter((m) =>
      String(m.issueId) === String(issueId) &&
      !(m.history || []).some((h) => h.note === "All materials issued")
    );
    setMachineLog((prev) => prev.map((m) => {
      if (String(m.issueId) !== String(issueId)) return m;
      if (m.history.some((h) => h.note === "All materials issued")) return m;
      return { ...m, history: [...m.history, { stage: m.stage, date: dateStr, note: "All materials issued" }] };
    }));
    if (isSupabaseEnabled() && targets.length) {
      Promise.all(targets.map((m) =>
        machineUpdate(m.id, { history: [...(m.history || []), { stage: m.stage, date: dateStr, note: "All materials issued" }] })
      )).then((results) => {
        const failed = results.filter((r) => !r.success);
        if (failed.length) console.warn("[App] notifyMachineComplete: Supabase failed", failed);
      });
    }
  };

  const handleFulfillPending = (entry, issuedQty) => {
    const matched = (p) => entry.issueId
      ? (p.issueId === entry.issueId && p.code === entry.code)
      : (p.code === entry.code && p.bomKey === entry.bomKey && p.date === entry.date);
    const newLog = pendingLog.reduce((acc, p) => {
      if (matched(p)) {
        const rem = p.pendingQty - issuedQty;
        if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + issuedQty });
      } else { acc.push(p); }
      return acc;
    }, []);
    setPendingLog(newLog);
    if (isSupabaseEnabled()) {
      const matchedRow = pendingLog.find(matched);
      if (matchedRow && matchedRow.id) {
        const rem = matchedRow.pendingQty - issuedQty;
        if (rem > 0) pendingUpdate(matchedRow.id, { pendingQty: rem, issueQty: (matchedRow.issueQty || 0) + issuedQty }).then((r) => { if (!r.success) console.warn("[App] Pending update Supabase failed:", r.error); });
        else pendingDelete(matchedRow.id).then((r) => { if (!r.success) console.warn("[App] Pending delete Supabase failed:", r.error); });
      }
    }
    notifyMachineComplete(entry.issueId, newLog);
    logAudit({ type: "pending_fulfilled", module: "Pending", action: `Fulfilled: ${entry.name || entry.code} × ${issuedQty}`, ref: entry.issueId || entry.code, itemCode: entry.code, itemName: entry.name || entry.code, qty: issuedQty, serialNo: entry.serialNo || "", details: { bomKey: entry.bomKey } });
  };

  // Atomic batch fulfillment for "Give All" — avoids stale-closure issues
  const handleFulfillGroup = (issueId, itemsToFulfill) => {
    itemsToFulfill.forEach((e) =>
      handleUpdateStock(e.category, e.code, -e.canIssue, `Fulfill: ${e.bomKey}`)
    );
    const canMap = Object.fromEntries(itemsToFulfill.map((e) => [e.code, e.canIssue]));
    const newLog = pendingLog.reduce((acc, p) => {
      if (p.issueId !== issueId) { acc.push(p); return acc; }
      const can = canMap[p.code];
      if (!can) { acc.push(p); return acc; }
      const rem = p.pendingQty - can;
      if (rem > 0) acc.push({ ...p, pendingQty: rem, issueQty: (p.issueQty || 0) + can });
      return acc;
    }, []);
    setPendingLog(newLog);
    if (isSupabaseEnabled()) {
      // Per affected row: update or delete in Supabase
      pendingLog.filter((p) => p.issueId === issueId && canMap[p.code]).forEach((p) => {
        const can = canMap[p.code];
        const rem = p.pendingQty - can;
        if (p.id) {
          if (rem > 0) pendingUpdate(p.id, { pendingQty: rem, issueQty: (p.issueQty || 0) + can }).then((r) => { if (!r.success) console.warn("[App] Pending group-update Supabase failed:", r.error); });
          else pendingDelete(p.id).then((r) => { if (!r.success) console.warn("[App] Pending group-delete Supabase failed:", r.error); });
        }
      });
    }
    notifyMachineComplete(issueId, newLog);
    logAudit({ type: "pending_fulfilled", module: "Pending", action: `Batch Fulfilled: ${itemsToFulfill.length} items for Issue #${issueId}`, ref: String(issueId), qty: itemsToFulfill.reduce((s, e) => s + e.canIssue, 0), details: { items: itemsToFulfill.map((e) => `${e.code}×${e.canIssue}`) } });
  };

  const canDo = authCanDo;

  const allItemsFlat     = Object.values(items).flat();
  const lowStockN        = allItemsFlat.filter(i => i.status === "critical" || i.status === "warning").length;
  const pipelineBadge    = lowStockN + pos.filter(p => !["received","rejected"].includes(p.status)).length;

  const pages = {
    dashboard: <DashboardPage items={items} pos={pos} vendorList={vendorList} machineLog={machineLog} pendingLog={pendingLog} followUps={followUps} onNavigate={setActivePage} settings={settings} />,
    inventory: <InventoryPage items={items} setItems={setItems} handleUpdateStock={handleUpdateStock}
                              pos={pos} inwardLog={inwardLog} outwardLog={outwardLog}
                              pendingLog={pendingLog} bomDefs={bomDefs} machineLog={machineLog}
                              onLogAudit={logAudit} canDo={canDo} vendorList={vendorList} settings={settings}
                              onCreateItem={handleCreateItemRow} onUpdateItem={handleUpdateItemRow} onDeleteItem={handleDeleteItemRow} />,
    inward:    <InwardPage    items={items} handleUpdateStock={handleUpdateStock} vendorList={vendorList} onInwardComplete={handleInwardComplete} onAddInward={(entry) => { setInwardLog(prev => [entry, ...prev]); if (isSupabaseEnabled()) createInward(entry).then((r) => { if (!r.success) console.warn("[App] Inward create Supabase failed:", r.error); }); logAudit({ type: "inward_manual", module: "Inward", action: `Manual Inward: ${entry.item} × ${entry.qty}`, ref: entry.code, itemCode: entry.code, itemName: entry.item, vendor: entry.vendor, qty: entry.qty, details: { unit: entry.unit, notes: entry.notes } }); }} appInwardLog={inwardLog} canDo={canDo} />,
    outward:   <OutwardPage   items={items} handleUpdateStock={handleUpdateStock}
                              bomDefs={bomDefs} onUpdateBOM={handleUpdateBOM}
                              onCreateBOM={handleCreateBOM} onRenameBOM={handleRenameBOM}
                              outwardLog={outwardLog} onAddOutward={handleAddOutward}
                              pendingLog={pendingLog} onClearPending={handleClearPending}
                              onCreateMachine={handleCreateMachine} machineLog={machineLog} canDo={canDo} />,
    pending:   <PendingPage   pendingLog={pendingLog} items={items} bomDefs={bomDefs}
                              machineLog={machineLog}
                              onFulfillPending={handleFulfillPending}
                              onFulfillGroup={handleFulfillGroup}
                              handleUpdateStock={handleUpdateStock}
                              onClearPending={handleClearPending}
                              onNavigate={setActivePage} canDo={canDo} />,
    pipeline:  <OrderPipelinePage
                              items={items} pos={pos} vendorList={vendorList} followUps={followUps}
                              onUpdatePO={handleUpdatePO} onCreatePO={handleCreatePO}
                              onReceivePO={handleReceivePO} onConfirmOrder={handleConfirmOrder}
                              onFollowUpDone={handleFollowUpDone} onDeletePO={handleDeletePO}
                              pendingLog={pendingLog} onFulfillPending={handleFulfillPending}
                              handleUpdateStock={handleUpdateStock} inwardLog={inwardLog} canDo={canDo}
                              settings={settings}
                              isSuperAdmin={currentUser?.role === "super_admin"}
                              onReverseReceive={handleReverseReceive} />,
    machines:  <MachinePage   machineLog={machineLog} onUpdateStage={handleUpdateMachineStage} onNavigate={setActivePage} canDo={canDo}
                              bomDefs={bomDefs} onStartProduction={handleStartProduction} />,
    vendors:   <VendorsPage   vendorList={vendorList} pos={pos} items={items}
                              onAddVendor={handleAddVendor} onEditVendor={handleEditVendor}
                              onDeleteVendor={handleDeleteVendor} onBulkAddVendors={handleBulkAddVendors} canDo={canDo} />,
    analytics: <AnalyticsPage items={items} pos={pos} vendorList={vendorList} settings={settings} />,
    ai:        <AIPage items={items} pos={pos} />,
    history:   <HistoryPage auditLog={auditLog} pos={pos} inwardLog={inwardLog} outwardLog={outwardLog} pendingLog={pendingLog} machineLog={machineLog} items={items} vendorList={vendorList} bomDefs={bomDefs} />,
    settings:  <SettingsPage settings={settings} onSave={handleSaveSettings} isSuperAdmin={currentUser?.role === "super_admin"} />,
    users:     <UserManagementPage canDo={canDo} />,
    roles:     <RoleManagementPage canDo={canDo} />,
    audit:     <AuditHistoryPage />,
  };

  return (
    <div className="flex h-screen bg-[#080a0f] text-white overflow-hidden"
         style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif", fontFeatureSettings: '"cv02","cv03","cv04","cv11"' }}>

      <Sidebar
        activePage={activePage} setActivePage={setActivePage}
        collapsed={collapsed} setCollapsed={setCollapsed}
        badges={{ pending: pendingLog.length, pipeline: pipelineBadge, machines: machineLog.filter((m) => m.status !== "completed" && m.stage !== "BOM Issued").length }}
        canView={canView}
        onSearchOpen={() => setShowSearch(true)}
        onNotifsOpen={() => setShowNotifs((v) => !v)}
        notifCount={activeNotifs.length}
        settings={settings}
      />

      {canView(activePage)
        ? (pages[activePage] || <DashboardPage />)
        : <AccessDeniedPage onNavigateHome={() => setActivePage("dashboard")} />
      }

      {/* ── Global overlays ── */}
      {showSearch && (
        <GlobalSearch
          items={items} pos={pos} vendorList={vendorList} machineLog={machineLog}
          onClose={() => setShowSearch(false)}
          onNavigate={setActivePage}
        />
      )}
      {showNotifs && (
        <NotificationPanel
          notifications={notifications}
          dismissed={dismissedIds}
          onClose={() => setShowNotifs(false)}
          onNavigate={(page) => { setActivePage(page); setShowNotifs(false); }}
          onDismiss={dismissNotif}
          onDismissAll={dismissAllNotifs}
        />
      )}

      {/* Supabase misconfiguration banner — deployed build without DB env vars shows this
          instead of silently falling back to empty/demo data. */}
      {!SUPA && (
        <div className="fixed top-0 inset-x-0 z-[200] flex items-center justify-center gap-2 px-4 py-2 text-center"
             style={{ background: "linear-gradient(90deg,#7f1d1d,#991b1b)", borderBottom: "1px solid rgba(239,68,68,0.5)" }}>
          <span className="text-sm">⚠️</span>
          <span className="text-[11px] font-bold text-red-100">
            Live database not connected — set VITE_USE_SUPABASE, VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY in Vercel and redeploy.
          </span>
        </div>
      )}

      {/* Stock movement error toast — movement rejected, optimistic UI reverted to DB truth */}
      {stockError && (
        <div className="fixed bottom-5 right-5 z-[100] max-w-sm flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl"
             style={{ background: "linear-gradient(180deg,#2a1216,#1a0c0e)", border: "1px solid rgba(239,68,68,0.4)", animation: "slideUp 0.2s ease both" }}>
          <span className="text-lg leading-none mt-0.5">⚠️</span>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-bold text-red-300">Stock update rejected</div>
            <div className="text-[11px] text-slate-400 mt-0.5 break-words">{stockError}</div>
          </div>
          <button onClick={() => setStockError(null)} className="text-slate-600 hover:text-slate-300 text-xs flex-shrink-0">✕</button>
        </div>
      )}
    </div>
  );
}
