/**
 * PDF Preview — renders the ACTUAL generated PDF blob (pdf.js) inside the app.
 * Same document that gets downloaded; nothing fake. Supports page navigation,
 * zoom (fit-width / fit-page / percentage), full-screen and touch pinch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Download, Printer, Maximize2, Minimize2 } from "lucide-react";
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface PdfPreviewHandle {
  /** The exact blob that will be downloaded. */
  blob: Blob;
  title: string;
  filename: string;
}

interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (p: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<unknown>; cancel: () => void };
}

interface PagedDoc {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => void;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function PdfPreview({ doc, onClose }: { doc: PdfPreviewHandle; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1); // 1 = fit width
  const [pct, setPct] = useState(100);
  const [full, setFull] = useState(false);
  const [pdf, setPdf] = useState<PagedDoc | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  // Load the document once from the same blob used for download.
  useEffect(() => {
    let cancelled = false;
    let docInstance: PagedDoc | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // Worker served by Vite as an asset — guarantees the render works offline.
        pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
        const data = await doc.blob.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data });
        docInstance = await loadingTask.promise as unknown as PagedDoc;
        if (cancelled) { docInstance.destroy(); return; }
        setPdf(docInstance);
        setNumPages(docInstance.numPages);
        setPage(1);
        setLoading(false);
      } catch (e) {
        if (!cancelled) { setError("Could not render preview: " + (e as Error).message); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      if (docInstance) docInstance.destroy();
    };
  }, [doc]);

  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return;
    try {
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const container = canvasRef.current.parentElement as HTMLElement;
      const cw = container.clientWidth || 700;
      const ch = container.clientHeight || 500;
      const scale = zoom === 1 ? cw / base.width : zoom === 2 ? Math.min(ch / base.height, cw / base.width) : (pct / 100) * (cw / base.width);
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      const task = p.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e) {
      console.error("PDF render error:", e);
      setError("Could not render page: " + (e as Error).message);
    }
  }, [pdf, page, zoom, pct]);

  useEffect(() => {
    if (!pdf) return;
    // Small delay so the canvas is mounted and sized.
    const t = setTimeout(() => { renderPage().catch(() => {}); }, 60);
    return () => clearTimeout(t);
  }, [pdf, page, zoom, pct, renderPage, loading]);

  useEffect(() => {
    const onResize = () => renderPage().catch(() => {});
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [renderPage]);

  const zoomLabel = zoom === 1 ? "Fit width" : zoom === 2 ? "Fit page" : `${pct}%`;

  return (
    <div className={`pdf-preview-modal${full ? " full" : ""}`} role="dialog" aria-label="Report preview">
      <div className="pdf-preview-bar">
        <div className="pdf-preview-title">
          <strong>{doc.title}</strong>
          <span className="muted small">{numPages > 0 ? `Page ${page} / ${numPages}` : ""}</span>
        </div>
        <div className="pdf-preview-actions">
          <button className="btn small ghost" onClick={() => { setZoom(3); setPct((p) => clamp(Math.round(p * 0.9), 25, 300)); }} aria-label="Zoom out"><ZoomOut size={14} /></button>
          <button className="btn small ghost" onClick={() => { setZoom(3); setPct((p) => clamp(Math.round(p * 1.1), 25, 300)); }} aria-label="Zoom in"><ZoomIn size={14} /></button>
          <span className="pdf-zoom-label">{zoomLabel}</span>
          <button className="btn small ghost" onClick={() => setZoom((z) => (z === 1 ? 2 : 1))}>{zoom === 1 ? "Fit page" : "Fit width"}</button>
          <span className="pdf-nav">
            <button className="btn small ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span className="pdf-page-num">{page} / {numPages}</span>
            <button className="btn small ghost" disabled={page >= numPages} onClick={() => setPage((p) => Math.min(numPages, p + 1))} aria-label="Next page"><ChevronRight size={14} /></button>
          </span>
          <button className="btn small ghost" onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        </div>
      </div>
      <div className="pdf-preview-canvas-wrap" onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(3); setPct((p) => clamp(Math.round(p * (e.deltaY < 0 ? 1.1 : 0.9)), 25, 300)); } }}>
        {loading && <div className="pdf-loading">Generating preview…</div>}
        {error && <div className="alert error">{error}</div>}
        <canvas ref={canvasRef} className="pdf-canvas" style={{ display: loading || error ? "none" : "block" }} />
      </div>
      <div className="pdf-preview-footer">
        <button className="btn primary" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(doc.blob); a.download = doc.filename; document.body.appendChild(a); a.click(); a.remove(); }}>
          <Download size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Download PDF
        </button>
        <button className="btn" onClick={() => { const w = window.open(URL.createObjectURL(doc.blob), "_blank"); if (w) w.addEventListener("load", () => setTimeout(() => w.print(), 300)); }}>
          <Printer size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Print
        </button>
        <button className="btn" onClick={onClose}><X size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Close Preview</button>
      </div>
    </div>
  );
}
