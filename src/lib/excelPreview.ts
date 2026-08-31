/**
 * Excel preview model.
 *
 * The in-app Excel preview shows the SAME workbook that will be downloaded:
 * we walk the generated ExcelJS workbook and project it into a lightweight
 * cell structure (values + display formats + column widths) that the React
 * spreadsheet component renders. No separate data source, no fake preview.
 */
import type ExcelJS from "exceljs";

export interface PrevCell {
  /** Raw value (number/string/Date). */
  v: string | number | Date | null;
  /** Excel display format for numbers (e.g. "$"#,##0.00). */
  numFmt?: string;
  bold?: boolean;
  /** True for the title/subtitle block rows. */
  title?: boolean;
}

export interface PrevSheet {
  name: string;
  /** Column widths in Excel units. */
  widths: number[];
  /** 2D grid: rows of cells (sparse allowed). */
  rows: PrevCell[][];
}

/**
 * Project a workbook into preview sheets. Reads actual cell values and
 * number formats so the preview matches the downloaded file exactly.
 */
export async function workbookToPreview(wb: ExcelJS.Workbook): Promise<PrevSheet[]> {
  const sheets: PrevSheet[] = [];
  for (const ws of wb.worksheets) {
    const widths: number[] = [];
    const rows: PrevCell[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: PrevCell[] = [];
      for (let c = 1; c <= (ws.columnCount || 0); c++) {
        const cell = row.getCell(c);
        if (cell.value === undefined || cell.value === null) {
          cells.push({ v: null });
          continue;
        }
        const numFmt = cell.numFmt && cell.numFmt !== "General" ? cell.numFmt : undefined;
        cells.push({
          v: (cell.value as { text?: string }).text !== undefined
            ? (cell.value as { text: string }).text
            : (cell.value as { result?: string | number }).result !== undefined
              ? (cell.value as { result: string | number }).result
              : (cell.value as string | number | Date),
          numFmt,
          bold: !!cell.font?.bold,
        });
      }
      rows.push(cells);
    });
    for (let c = 1; c <= (ws.columnCount || 0); c++) {
      widths.push(ws.getColumn(c).width ?? 10);
    }
    sheets.push({ name: ws.name, widths, rows });
  }
  return sheets;
}

/** Format a preview cell value for display (numbers use the sheet format). */
export function formatCell(cell: PrevCell): string {
  if (cell.v === null || cell.v === undefined) return "";
  if (typeof cell.v === "number") {
    if (cell.numFmt && cell.numFmt.includes("$")) return `$${cell.v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (cell.numFmt && cell.numFmt.includes("#,##0")) return cell.v.toLocaleString("en-US", { minimumFractionDigits: cell.numFmt.endsWith(".00") ? 2 : 0, maximumFractionDigits: 2 });
    return String(cell.v);
  }
  if (cell.v instanceof Date) {
    return cell.v.toLocaleDateString("en-GB");
  }
  return String(cell.v);
}
