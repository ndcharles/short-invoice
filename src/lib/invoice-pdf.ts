'use client';

/**
 * Renders the on-screen invoice canvas to an A4 PDF in the browser, for email
 * attachments. The capture uses the same rules as printing (`.is-capturing` in
 * shared.css): editing controls hidden, fields shown as plain text. Both
 * libraries load only when a PDF is actually made.
 */

const A4 = { width: 595.28, height: 841.89 }; // points
const MARGIN = 28; // points, ~10 mm
const CAPTURE_WIDTH = 794; // CSS px: A4 width at 96 dpi
/** A page up to this much too tall is shrunk onto one page instead of split. */
const SHRINK_TO_FIT = 1.2;

/** Shows form fields as text in the cloned document so the capture looks like a document. */
function flattenFields(root: HTMLElement) {
  const doc = root.ownerDocument;
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((field) => {
    if (field instanceof HTMLInputElement && ['date', 'checkbox', 'radio', 'file', 'hidden'].includes(field.type)) {
      field.remove();
      return;
    }
    const text = doc.createElement(field instanceof HTMLTextAreaElement ? 'div' : 'span');
    text.className = `${field.className} pdf-field`;
    const style = field.getAttribute('style');
    if (style) text.setAttribute('style', style);
    text.textContent = field.value;
    field.replaceWith(text);
  });
}

/** Base64 of an A4 PDF made from `node` (the `.invoice-canvas` element). */
export async function renderInvoicePdf(node: HTMLElement, title: string): Promise<string> {
  const [{ default: html2canvas }, { PDFDocument }] = await Promise.all([import('html2canvas-pro'), import('pdf-lib')]);

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: Math.max(1200, window.innerWidth),
    onclone: (_doc, clone) => {
      clone.classList.add('is-capturing');
      clone.style.width = `${CAPTURE_WIDTH}px`;
      flattenFields(clone);
    },
  });

  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('short-invoice');

  const usableWidth = A4.width - MARGIN * 2;
  const usableHeight = A4.height - MARGIN * 2;
  const scale = usableWidth / canvas.width; // points per canvas pixel
  const fullHeight = canvas.height * scale;

  const addSlice = async (source: HTMLCanvasElement, drawWidth: number, drawHeight: number) => {
    const jpg = await pdf.embedJpg(source.toDataURL('image/jpeg', 0.9));
    const page = pdf.addPage([A4.width, A4.height]);
    page.drawImage(jpg, { x: (A4.width - drawWidth) / 2, y: A4.height - MARGIN - drawHeight, width: drawWidth, height: drawHeight });
  };

  if (fullHeight <= usableHeight * SHRINK_TO_FIT) {
    const fit = Math.min(1, usableHeight / fullHeight);
    await addSlice(canvas, usableWidth * fit, fullHeight * fit);
  } else {
    // Longer invoices continue on further pages.
    const sliceHeight = Math.floor(usableHeight / scale);
    for (let top = 0; top < canvas.height; top += sliceHeight) {
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.min(sliceHeight, canvas.height - top);
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('Could not draw the PDF page');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, top, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      await addSlice(slice, usableWidth, slice.height * scale);
    }
  }

  return pdf.saveAsBase64();
}

/** "Invoice-4th-000123.pdf": the server only accepts simple file names. */
export function pdfFileName(kind: 'invoice' | 'receipt', number: string): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 80) || 'document';
  return `${kind === 'invoice' ? 'Invoice' : 'Receipt'}-${safe}.pdf`;
}
