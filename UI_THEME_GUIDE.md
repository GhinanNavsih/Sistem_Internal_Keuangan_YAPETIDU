# YAPETIDU Sistem Internal Keuangan - UI Design & Theme System

This document describes the modern, soothing, and premium slate-indigo UI theme design system implemented in the application. Use the specified Tailwind CSS tokens, patterns, and component recipes below to ensure a consistent user experience when building or refactoring pages across the application.

---

## 🎨 Theme Colors & Palette

The core color palette shifts away from harsh, high-contrast primary saturated colors to a refined, calming workspace environment using Slate, Indigo, and accents of Emerald, Teal, Amber, and Rose.

| Role | Color Family | Tailwind Hex/Tints | Purpose |
| :--- | :--- | :--- | :--- |
| **Canvas Background** | Slate & Indigo | `slate-50`, `indigo-50/80`, `slate-100` | Smooth main canvas backdrop |
| **Text Headers** | Slate | `slate-800` | High readability titles |
| **Text Support** | Slate | `slate-500` | Subtitles, footnotes, captions |
| **Forms / Borders** | Slate | `slate-200`, `slate-100` | Inputs, table divider lines, cards |
| **Primary Theme Accent**| Indigo | `indigo-50` to `indigo-700` | Primary buttons, active states, active tab |
| **Success Indicator** | Emerald | `emerald-50`, `emerald-200`, `emerald-700` | Success badges, export actions, success alerts |
| **Secondary Accents** | Teal / Amber | `teal-50` / `amber-50` | Secondary flows, reviews, pending badges |
| **Danger / Destructive** | Rose / Red | `rose-50`, `rose-200`, `rose-600`, `red-50` | Logout buttons, declined badges, error alerts |

---

## 💎 Design Tokens & Component Specs

### 1. Canvas & Global Page Layout
All primary views should use a gradient background layout with absolute decorative blurred background blobs to establish depth.

*   **Background Canvas Wrapper**:
    ```html
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-6 lg:p-8 pb-24 lg:pb-32 font-sans selection:bg-indigo-100 relative overflow-hidden">
    ```
*   **Decorative Background Blobs** (Place at the top of the canvas, behind content with pointer-events disabled):
    ```html
    {/* Decorative soft blurred background blobs */}
    <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
    ```
*   **Z-Indexed Main Content Container**:
    ```html
    <div className="max-w-[1600px] mx-auto space-y-8 relative z-10">
      {/* Page Content Here */}
    </div>
    ```

---

### 2. Page Typography
*   **Page Title (Heading 1)**:
    ```html
    <h1 className="text-3xl font-bold text-slate-800">
      Title Text Here
    </h1>
    ```
*   **Page Subtitle / Support Text**:
    ```html
    <p className="text-slate-500 text-sm">
      Description or summary text goes here.
    </p>
    ```
*   **Section Title / Card Title**:
    ```html
    <h2 className="text-lg font-bold text-slate-800">
      Section Header
    </h2>
    ```
*   **Table / Column Header Text**:
    ```html
    <th className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
      COLUMN NAME
    </th>
    ```

---

### 3. Cards & Structure Containers
Card designs avoid harsh borders and leverage extra-large rounded corners with extremely soft, low-opacity drop shadows.

*   **Standard Content Card**:
    ```html
    <div className="bg-white rounded-[20px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none p-6">
      {/* Content */}
    </div>
    ```
*   **Accent Global Action Bar** (Used for main action rows above grids):
    ```html
    <div className="flex flex-wrap items-center gap-3 bg-white p-4 rounded-[20px] border border-slate-200/60 shadow-sm">
      {/* Buttons / Actions */}
    </div>
    ```

---

### 4. Form Controls & Selectors
Form items use soft borders, clean typography, and a smooth light blue border expansion transition on hover.

*   **Dropdown / Select Trigger (Shadcn/UI SelectTrigger)**:
    ```html
    <SelectTrigger className="bg-white shadow-sm border-slate-200 rounded-xl font-semibold hover:border-indigo-300 focus:border-indigo-500 transition-all text-slate-700">
      <SelectValue />
    </SelectTrigger>
    ```
*   **Text Inputs / Number Inputs**:
    ```html
    <input
      type="text"
      className="rounded-xl border-slate-200 font-bold text-slate-700 text-xs h-10 w-full hover:border-indigo-300 focus:border-indigo-500 transition-all placeholder:text-slate-400"
    />
    ```
*   **Custom Autocomplete Suggestions Dropdown**:
    ```html
    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
      {/* Option Active State */}
      <div className="px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors bg-indigo-50 text-indigo-600 font-bold">
        <p className="text-indigo-700">Active Name</p>
        <p className="text-[10px] font-mono text-indigo-400 mt-0.5">Active Role / Metadata</p>
      </div>

      {/* Option Inactive State */}
      <div className="px-4 py-2.5 text-xs font-semibold cursor-pointer transition-colors hover:bg-indigo-50 hover:text-indigo-600 text-slate-700">
        <p className="text-slate-800">Inactive Name</p>
        <p className="text-[10px] font-mono text-slate-400 mt-0.5">Inactive Role / Metadata</p>
      </div>
    </div>
    ```

---

### 5. Premium Button System
Buttons utilize rounded extra-large borders, shadows, soft color filters, and smooth state changes.

*   **Solid Primary Button** (e.g., *Simpan*, *Submit*):
    ```html
    <button className="rounded-xl px-6 py-2.5 bg-indigo-600 shadow-lg shadow-indigo-200 text-white font-bold transition-all hover:bg-indigo-700 hover:shadow-indigo-300 flex items-center gap-2">
      Save Changes
    </button>
    ```
*   **Outline Soft Indigo Button** (e.g., *Kegiatan SPJ*):
    ```html
    <button className="rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:border-indigo-300 transition-all font-semibold flex items-center gap-2 shadow-sm">
      Action Button
    </button>
    ```
*   **Outline Soft Teal Button** (e.g., *Review Laporan*):
    ```html
    <button className="rounded-xl border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 hover:border-teal-300 transition-all font-semibold flex items-center gap-2 shadow-sm">
      Review Reports
    </button>
    ```
*   **Outline Soft Emerald Button** (e.g., *Ekspor PDF*):
    ```html
    <button className="rounded-xl border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-all font-semibold flex items-center gap-2 shadow-sm">
      Download PDF
    </button>
    ```
*   **Outline Soft Amber Button** (e.g., *Ekspor Templat*):
    ```html
    <button className="rounded-xl border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:border-amber-300 transition-all font-semibold flex items-center gap-2 shadow-sm">
      Get Template
    </button>
    ```
*   **Neutral Outline Button** (e.g., *Tambah Kolom*):
    ```html
    <button className="rounded-xl border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 bg-white font-semibold transition-all shadow-sm flex items-center gap-2">
      Add Column
    </button>
    ```
*   **Destructive Soft Rose Button** (e.g., *Keluar*, *Hapus*):
    ```html
    <button className="rounded-xl text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all flex items-center gap-2 shadow-sm">
      Delete Item
    </button>
    ```
*   **Ghost Navigation / Back Button**:
    ```html
    <button className="group text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl px-4 py-2.5 transition-all flex items-center gap-2">
      <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
      Kembali
    </button>
    ```

---

### 6. Premium Tab Switcher Container
Perfect for segmented controls, lists views, and context switching.

```html
<div className="flex bg-white p-1 rounded-xl w-fit shadow-sm border border-slate-200/60">
  {/* Active Tab */}
  <button className="px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 bg-indigo-600 text-white shadow-sm">
    Active View
  </button>
  
  {/* Inactive Tab */}
  <button className="px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50">
    Inactive View
  </button>
</div>
```

---

### 7. Status Badges & Pill Indicators
Small indicators representing records states (used extensively in grid lists & review queues).

*   **Draft State (Gray)**:
    ```html
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
      Draft
    </span>
    ```
*   **Pending Review (Amber)**:
    ```html
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      Menunggu Review
    </span>
    ```
*   **Approved (Emerald)**:
    ```html
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
      Disetujui
    </span>
    ```
*   **Revision Needed (Orange)**:
    ```html
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
      Minta Revisi
    </span>
    ```
*   **Declined (Rose)**:
    ```html
    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
      Ditolak
    </span>
    ```

---

### 8. Message Banners & Inline Alerts
Used for temporary feedback messages or context notifications inside card bodies.

*   **Success Banner**:
    ```html
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 className="w-4 h-4" /> Message text here.
    </div>
    ```
*   **Error / Attention Banner**:
    ```html
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200">
      <AlertCircle className="w-4 h-4" /> Error explanation text here.
    </div>
    ```

---

### 9. Inner Tables Grid
Nested records, workers lists, or action-rich tables.

```html
<div className="border border-slate-100 rounded-2xl shadow-sm overflow-visible bg-white">
  <table className="w-full text-left border-collapse">
    <thead>
      <tr className="bg-slate-50 border-b border-slate-100">
        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-12 text-center">NO</th>
        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">NAMA PEGAWAI</th>
        <th className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider w-[220px]">JUMLAH (RP)</th>
      </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
      <tr className="hover:bg-slate-50/50 transition-colors">
        <td className="px-4 py-3.5 text-center text-xs font-medium text-slate-400">1</td>
        <td className="px-4 py-3.5 text-xs font-bold text-slate-800">John Doe</td>
        <td className="px-4 py-3.5 text-xs text-slate-600">Rp 500.000</td>
      </tr>
    </tbody>
  </table>
</div>
```
