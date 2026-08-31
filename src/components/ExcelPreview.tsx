/**
 * Excel Preview — renders the SAME generated workbook as a lightweight
 * spreadsheet-style table. Shows the actual sheet, column widths, formatted
 * amounts, dates, totals, and multiple sheets. Horizontal scroll on mobile.
 */
import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";
import { workbookToPreview, formatCell, type PrevSheet } from "../lib/excelPreview";
import type ExcelJS from "exceljs";

export interface ExcelPreviewHandle {
  wb: ExcelJS.Workbook;
  title: string;
  filename: string;
}

export function ExcelPreview({ doc, onClose }: { doc: ExcelPreviewHandle; onClose: () => void }) {
  const [sheets, setSheets] = useState<PrevSheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    workbookToPreview(doc.wb)
      .then((s) => { if (!cancelled) setSheets(s); })
      .catch((e) => { if (!cancelled) setError("Could not preview workbook: " + (e as Error).message); });
    return () => { cancelled = true; };
  }, [doc]);

  const sheet = sheets?.[active];

  return (
    <div className="excel-preview-modal" role="dialog" aria-label="Excel preview">
      <div className="pdf-preview-bar">
        <div className="pdf-preview-title">
          <strong>{doc.title}</strong>
          <span className="muted small">{sheet ? `${sheet.name} · ${sheet.rows.length} rows` : ""}</span>
        </div>
        <div className="pdf-preview-actions">
          <button className="btn small ghost" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
      </div>
      {sheets && sheets.length > 1 && (
        <div className="excel-sheet-tabs">
          {sheets.map((s, i) => (
            <button key={s.name} className={`btn small ${i === active ? "primary" : "ghost"}`} onClick={() => setActive(i)}>{s.name}</button>
          ))}
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      {!sheets && !error && <div className="pdf-loading">Preparing spreadsheet preview…</div>}
      {sheet && (
        <div className="excel-scroll">
          <table className="excel-preview-table">
            <tbody>
              {sheet.rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="excel-row-head">{ri + 1}</td>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={[
                        cell.bold ? "excel-bold" : "",
                        ci === 0 && ri < 4 ? "excel-title" : "",
                        typeof cell.v === "number" ? "excel-num" : "",
                        cell.title ? "excel-title" : "",
                      ].filter(Boolean).join(" ")}
                      style={{ minWidth: Math.max(48, (sheet.widths[ci] || 10) * 6) }}
                    >
                      {formatCell(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pdf-preview-footer">
        <button className="btn primary" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([doc.wb.xlsx.writeBuffer() as unknown as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })); a.download = doc.filename; document.body.appendChild(a); a.click(); a.remove(); }}>
          <Download size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Download Excel
        </button>
        <button className="btn" onClick={onClose}><X size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Close Preview</button>
      </div>
    </div>
  );
}
