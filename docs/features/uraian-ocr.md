# Uraian OCR pipeline

## OCR Processing Pipeline (Uraian)

Physical presence printouts are parsed via the [/api/parse-rekap](../../src/app/api/parse-rekap/route.ts) route: an uploaded PNG/JPEG is sent to Gemini (`gemini-1.5-flash`) with a structured-extraction prompt that returns per-row `y_top`/`y_bottom` coordinates plus column values; outputs then flow to `UraianTable` components matching [rekapConfig.ts](../../src/utils/rekapConfig.ts) indices.
