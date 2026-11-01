# YAPETIDU Sistem Internal Keuangan - UI Design & Theme System

This document describes the modern, soothing, and premium slate-indigo UI theme design system implemented in the application. Use the specified Tailwind CSS tokens, patterns, and component recipes below to ensure a consistent user experience when building or refactoring pages across the application.

**The reference implementation is `src/app/dashboard/payroll/page.tsx`.** The recipes below are taken from it. When this guide and that page ever differ, the page wins; fix the guide.

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

## 📐 Corner Radius

Keep corners minimal. Rounding only softens an edge; it is not a style in itself, so nothing on screen should look like a pill, a bubble, or a tablet. Use these two steps and nothing larger.

| Step | Tailwind class | Size* | Use for |
| :--- | :--- | :--- | :--- |
| **Small** | `rounded-sm` | 6px | Buttons, inputs, select triggers, tabs, status badges, chips |
| **Medium** | `rounded-md` | 8px | Cards, action bars, tables, banners and alerts, dropdown menus, modals |

\*Sizes follow the `--radius: 0.625rem` token in `src/app/globals.css` (`rounded-sm` is 0.6×, `rounded-md` is 0.8×).

*   **Do not use** `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, or arbitrary values such as `rounded-[20px]` on any UI element.
*   **`rounded-full` is only for things that are really circles**: avatars, status dots, spinners, and the decorative background blobs. Never use it on buttons, badges, tabs, or inputs.
*   **Nested shapes**: the inner element takes the small step and its container the medium step (for example the tab switcher). Do not repeat the container's radius on what sits inside it.
*   **The shadcn/ui primitives** in `src/components/ui/` (`Button`, `Input`, `SelectTrigger`) default to `rounded-lg` (10px). In new code pass the class from the table through `className`; it overrides the default.

---

## 💎 Design Tokens & Component Specs

### 1. Canvas & Global Page Layout
All primary views should use a gradient background layout with absolute decorative blurred background blobs to establish depth.

*   **Background Canvas Wrapper**:
    ```html
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/80 to-slate-100 p-8 font-sans selection:bg-indigo-100 relative overflow-hidden text-slate-800">
    ```
*   **Decorative Background Blobs** (Place at the top of the canvas, behind content with pointer-events disabled; `rounded-full` is correct here because they are circles):
    ```html
    {/* Decorative soft blurred background blobs */}
    <div className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full bg-indigo-100/40 blur-[120px] pointer-events-none" />
    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] rounded-full bg-purple-100/30 blur-[100px] pointer-events-none" />
    ```
*   **Z-Indexed Main Content Container**:
    ```html
    <div className="relative z-10">
      {/* Page Content Here: usually one main Card (see Cards below) */}
    </div>
    ```

---

### 2. Page Typography
*   **Page Title (Heading 1)**:
    ```html
    <h1 className="text-2xl font-bold tracking-tight">
      Title Text Here
    </h1>
    ```
*   **Summary Stats Row** (figures under the toolbar; the label is plain slate-500 text, the value sits under it in a meaning colour):
    ```html
    <div className="flex flex-wrap gap-6 text-sm">
      <div>
        <span className="text-slate-500 block mb-1">Total Karyawan</span>
        <span className="font-medium">181</span>
      </div>
      <div>
        <span className="text-slate-500 block mb-1">Total Pendapatan</span>
        <span className="font-medium text-emerald-600">Rp 1.007.150.193</span>
      </div>
    </div>
    ```
    Value colours: `emerald-600` earnings and done, `rose-600` deductions, `amber-600` tax and waiting, and `font-bold text-indigo-600` for the one headline figure (net pay).
*   **Section Title / Card Title**:
    ```html
    <span className="font-semibold text-lg">
      Section Header
    </span>
    ```
*   **Table / Column Header Text** (sentence case, regular size; set it on `TableHead`):
    ```html
    <TableHead className="font-medium text-slate-500">
      Nama Karyawan
    </TableHead>
    ```

---

### 3. Cards & Structure Containers
Card designs avoid harsh borders and use the medium corner radius (`rounded-md`) with extremely soft, low-opacity drop shadows.

*   **Standard Content Card**:
    ```html
    <Card className="bg-white rounded-md shadow-[0_8px_30px_rgb(0,0,0,0.04)] border-none overflow-hidden">
      <div className="p-8 pb-0">
        {/* Title, tab switcher, filters, summary stats */}
      </div>
      <div className="p-0">
        {/* Section bars and the table, edge to edge */}
      </div>
    </Card>
    ```
*   **Section Bar** (a titled strip inside the card with its actions on the right; the card's single row of action buttons):
    ```html
    <div className="px-8 py-4 flex flex-wrap justify-between items-center gap-4 border-b border-slate-100">
      <span className="font-semibold text-lg">Validasi Gaji</span>
      <div className="flex items-center gap-3">
        {/* Buttons / Actions */}
      </div>
    </div>
    ```

---

### 4. Form Controls & Selectors
Form items use soft borders, small semibold text (`text-xs font-semibold`), the small corner radius (`rounded-sm`), a small shadow, and an indigo focus ring.

*   **Dropdown / Select**:
    ```html
    <select className="bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-sm px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer shadow-sm">
      <option value="all">Semua Kategori</option>
    </select>
    ```
*   **Search Input** (icon on the left, grows to fill the row):
    ```html
    <div className="relative flex-1">
      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
        <Search className="w-4 h-4" />
      </span>
      <input
        type="text"
        placeholder="Cari nama atau ID pegawai..."
        className="w-full bg-white border border-slate-200 text-slate-700 placeholder:text-slate-400 text-xs font-semibold rounded-sm pl-10 pr-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm"
      />
    </div>
    ```
*   **Period / Date Input** (sits under a plain slate-500 label, as in the summary stats row):
    ```html
    <input
      type="month"
      className="bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-sm px-3 py-1 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer"
    />
    ```
*   **Money (Rupiah) Inputs**: every input that takes an amount of rupiah gets a fixed `Rp` prefix and dots between the thousands while typing (`1000000` shows as `Rp 1.000.000`). Never use a bare `<input>` or `<Input>` for money; use `CurrencyInput` from `src/components/ui/currency-input.tsx`.
    ```tsx
    <CurrencyInput value={amount} onValue={setAmount} />
    ```
    *   `value` and `onValue` are plain numbers, not formatted strings. Empty is `0`, and only whole rupiah up to 10 digits are accepted.
    *   The component follows the parent's `value`, so resetting the form or removing a row clears the box.
    *   Pass the page's usual input classes through `className` (the `Rp` padding is added for you). Put margins and width limits (`mt-1`, `max-w-44`, `ml-auto`) on a wrapper around it, not on the input, or the prefix drifts off the text.
    *   In tables and grids add `text-right`, and label the column or give the input an `aria-label`, because the placeholder is always `0`.
    *   Amounts that are only displayed (not edited) use the same notation: `Rp 500.000`.
*   **Custom Autocomplete Suggestions Dropdown**:
    ```html
    <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-2xl z-[999] max-h-48 overflow-y-auto divide-y divide-slate-50 animate-in fade-in slide-in-from-top-1">
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
Buttons use the small corner radius (`rounded-sm`), `text-xs font-semibold`, a small shadow, soft color filters, and smooth state changes. Section-bar buttons are `px-4 py-2`; buttons inside a table row are smaller (`px-3 py-1.5`) with the `-600` text shade.

*   **Solid Primary Button** (e.g., *Simpan*, *Submit*; used in dialogs and forms):
    ```html
    <Button className="rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-2 shadow-md shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed">
      Save Changes
    </Button>
    ```
*   **Outline Soft Indigo Button** (e.g., *Refresh Semua*):
    ```html
    <button className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm">
      <RefreshCw className="w-4 h-4 text-indigo-500" />
      Action Button
    </button>
    ```
*   **Outline Soft Teal Button** (e.g., *Review Laporan*):
    ```html
    <button className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-teal-200 text-teal-700 bg-teal-50 hover:bg-teal-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm">
      Review Reports
    </button>
    ```
*   **Outline Soft Emerald Button** (e.g., *Verifikasi & Kunci Semua*):
    ```html
    <button className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm">
      Download PDF
    </button>
    ```
*   **Outline Soft Amber Button** (e.g., *Siapkan Semua Draf*):
    ```html
    <button className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm">
      Get Template
    </button>
    ```
*   **Row Action Buttons** (inside a table row: Edit is amber, the main row action emerald or indigo; disabled is slate):
    ```html
    <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 hover:border-amber-300 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-sm">
      <Pencil className="w-3.5 h-3.5" />
      Edit
    </button>
    ```
*   **Neutral Outline Button** (e.g., *Cetak Dokumen*, *Tambah Kolom*):
    ```html
    <button className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-sm border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 hover:shadow-sm transition-all duration-150 shadow-sm cursor-pointer">
      <Printer className="w-4 h-4 text-slate-500" />
      Add Column
    </button>
    ```
*   **Destructive Soft Rose Button** (e.g., *Keluar*, *Hapus*):
    ```html
    <button className="rounded-sm text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 transition-all flex items-center gap-2 shadow-sm">
      Delete Item
    </button>
    ```
*   **Ghost Navigation / Back Button**:
    ```html
    <button className="group text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-sm px-4 py-2.5 transition-all flex items-center gap-2">
      <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
      Kembali
    </button>
    ```

---

### 6. Premium Tab Switcher Container
Perfect for segmented controls, lists views, and context switching (the Pekarya / Loyalis switch). The container takes the medium radius and the tabs inside it the small one. The active tab is a white chip with indigo text; there is no solid indigo tab.

```html
<div className="flex bg-slate-100 p-1 rounded-md">
  {/* Active Tab */}
  <button className="px-4 py-1.5 rounded-sm text-xs font-semibold transition-all bg-white text-indigo-600 shadow-sm font-bold">
    Active View
  </button>

  {/* Inactive Tab */}
  <button className="px-4 py-1.5 rounded-sm text-xs font-semibold transition-all text-slate-500 hover:text-slate-700">
    Inactive View
  </button>
</div>
```

---

### 7. Status Badges
Small indicators representing records states (used extensively in grid lists & review queues). Use `Badge variant="outline"` with the classes below. They are rounded rectangles (`rounded-sm`), never fully rounded pills, so always pass `rounded-sm`; the component's own default is a pill.

*   **Draft State (Gray)**:
    ```html
    <Badge variant="outline" className="rounded-sm border-slate-200 bg-slate-100 text-slate-700">
      Draft
    </Badge>
    ```
*   **Pending Review (Amber)**:
    ```html
    <Badge variant="outline" className="rounded-sm border-amber-200 bg-amber-50 text-amber-700">
      Menunggu Review
    </Badge>
    ```
*   **Approved / Open (Emerald)**:
    ```html
    <Badge variant="outline" className="rounded-sm border-emerald-200 bg-emerald-50 text-emerald-700">
      Disetujui
    </Badge>
    ```
*   **Revision Needed (Orange)**:
    ```html
    <Badge variant="outline" className="rounded-sm border-orange-200 bg-orange-50 text-orange-700">
      Minta Revisi
    </Badge>
    ```
*   **Declined / Closed (Rose)**:
    ```html
    <Badge variant="outline" className="rounded-sm border-rose-200 bg-rose-50 text-rose-700">
      Ditolak
    </Badge>
    ```

---

### 8. Message Banners & Inline Alerts
Used for temporary feedback messages or context notifications inside card bodies.

*   **Success Banner**:
    ```html
    <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 className="w-4 h-4" /> Message text here.
    </div>
    ```
*   **Error / Attention Banner**:
    ```html
    <div className="flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium bg-red-50 text-red-700 border border-red-200">
      <AlertCircle className="w-4 h-4" /> Error explanation text here.
    </div>
    ```

---

### 9. Tables
Records lists and action-rich tables. Use the `Table` primitives from `src/components/ui/table.tsx` and put the table edge to edge inside the card (no extra border). The first column has `pl-8` and the actions column `pr-8` so the content lines up with the card's `p-8`.

```html
<Table>
  <TableHeader className="bg-slate-50/50">
    <TableRow className="border-slate-100">
      <TableHead className="font-medium text-slate-500 pl-8">Nama Karyawan</TableHead>
      <TableHead className="font-medium text-slate-500">Jabatan / Golongan</TableHead>
      <TableHead className="font-medium text-slate-500">Gaji Bersih</TableHead>
      <TableHead className="font-medium text-slate-500 text-right pr-8">Aksi</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow className="border-slate-100 transition-colors hover:bg-slate-50/50">
      <TableCell className="font-medium pl-8 py-4">John Doe</TableCell>
      <TableCell className="py-4">
        <div className="flex flex-col">
          <span>REKTORAT</span>
          <span className="text-xs text-slate-500">Golongan AA</span>
        </div>
      </TableCell>
      <TableCell className="py-4 font-bold text-indigo-700">Rp 1.975.000</TableCell>
      <TableCell className="text-right pr-8 py-4">
        {/* Row Action Buttons, see Buttons */}
      </TableCell>
    </TableRow>
  </TableBody>
</Table>
```
*   Plain figures are `text-slate-600`; a figure that needs attention takes its meaning colour with `font-semibold` (for example `text-amber-600` for tax). A missing value is a dash.
*   A row that is done or ready takes a soft tint (`bg-emerald-50 hover:bg-emerald-100/60`), not a badge on every cell.
*   Empty state: `<div className="p-20 flex flex-col items-center justify-center text-slate-400">` with a `w-12 h-12 mb-4 opacity-20` icon and one line of text.

---

### 10. Dialogs
Dialogs use the medium radius, a hairline border and a soft large shadow. The title is `text-xl font-bold tracking-tight text-slate-900`; the footer pairs a neutral outline button with the solid primary button.

```html
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="sm:max-w-[760px] p-6 rounded-md bg-white border border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.1)]">
    <DialogHeader>
      <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
        Cetak Dokumen Payroll
      </DialogTitle>
    </DialogHeader>
    {/* Content */}
  </DialogContent>
</Dialog>
```
`DialogContent` defaults to `rounded-xl`; always pass `rounded-md`.

---

### 11. File & Image Uploads
Every feature that takes a photo or scan (receipts, proofs, attachments, ID photos) must accept **many kinds of image files, not a hand-picked few**. People attach what their phone or scanner gave them, and should never have to convert a file first.

*   **Accept the whole list**: JPG/JPEG, PNG, WebP, GIF, BMP, AVIF, **HEIC/HEIF** (the default iPhone photo format), TIFF, and **PDF** (scans, bank and e-wallet receipts). Do not write a new list of MIME types by hand; use `src/lib/uploadFileTypes.ts`:
    *   `UPLOAD_ACCEPT` goes in the `accept` attribute. It lists extensions as well as types, because browsers often report HEIC with no type at all.
    *   `uploadFileProblem(file)` checks size (5 MB by default, `MAX_UPLOAD_BYTES`) and type in the browser. Run it as soon as the file is picked and show the message at once, not after submit.
    *   `UPLOAD_TYPES_TEXT` is the wording for the hint under the picker.
    *   LPJ expense-report receipts have no input file-size cap. Prepare them in the browser before upload: compress images above 1 MB, convert HEIC/HEIF and TIFF for viewing, and retain every PDF page. The complete stored receipt must be at most 1 MB. Do not apply the default 5 MB input check to this uploader.
*   **The server decides by the file's own bytes**, never by the browser's declared type or the file name: `detectUploadFileType(bytes)` (a renamed `.exe` is refused, an empty or generic type is fine). Store and serve the *detected* type. Read data URLs with `parseBase64DataUrl`, which ignores the declared type.
*   **Showing a stored file**: images and PDFs open in a preview; formats browsers cannot display (`inlinePreview: false`, i.e. HEIC/HEIF/TIFF outside Safari) show a short note and an **Unduh berkas** button. Never leave a broken image.
*   **Picker pattern**: no raw `<input type="file">`. A hidden input, a neutral outline button ("Lampirkan bukti"), then the chosen file name with a small remove (x) button. Under it, one line of hint: what is optional, the accepted types, the size limit. Wording says "bukti" or "berkas", not "foto", since PDFs are allowed.
*   **Never delete evidence**: replacing or removing an attachment keeps the old file in Storage and the audit trail points at it.
*   Existing upload features that still list only JPG/PNG/WebP (for example the Ganti Libur and expense-report attachments) should move to the shared list when they are next changed.
