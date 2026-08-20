const PDF_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
const TESSERACT_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist';
const TESSERACT_CORE_BASE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1';
const TESSDATA_BASE = 'https://tessdata.projectnaptha.com/4.0.0';

const CORE_FILES = new Set([
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
]);

function upstreamFor(parts: string[]) {
  if (parts.length === 1 && parts[0] === 'pdf.min.js') return `${PDF_BASE}/pdf.min.js`;
  if (parts.length === 1 && parts[0] === 'pdf.worker.min.js') return `${PDF_BASE}/pdf.worker.min.js`;
  if (parts.length === 1 && parts[0] === 'tesseract.min.js') return `${TESSERACT_BASE}/tesseract.min.js`;
  if (parts.length === 1 && parts[0] === 'tesseract-worker.min.js') return `${TESSERACT_BASE}/worker.min.js`;
  if (parts.length === 2 && parts[0] === 'core' && CORE_FILES.has(parts[1])) {
    return `${TESSERACT_CORE_BASE}/${parts[1]}`;
  }
  if (parts.length === 2 && parts[0] === 'lang' && /^[a-z0-9_+-]+\.traineddata\.gz$/i.test(parts[1])) {
    return `${TESSDATA_BASE}/${parts[1]}`;
  }
  return null;
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const upstream = upstreamFor(path ?? []);
  if (!upstream) return new Response('Reader asset not found.', { status: 404 });

  try {
    const response = await fetch(upstream, {
      headers: {
        'user-agent': 'Norlow-Outside-Work-Reader/1.0',
      },
    });
    if (!response.ok || !response.body) {
      return new Response('Reader asset could not be loaded.', { status: 502 });
    }

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    headers.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(response.body, { headers });
  } catch (error) {
    console.error(JSON.stringify({ event: 'outside_work_reader_asset_failed', upstream, error: String(error) }));
    return new Response('Reader asset could not be loaded.', { status: 502 });
  }
}
