/**
 * ═══ STAND-IN — the media Worker's audio door, as Séra's logistics reaches it ═══
 *
 * Bound as `MEDIA_AUDIO` in the seam tests, in place of the Boutik+ media
 * Worker's `AudioRead` entrypoint (reachable only through a service binding:
 * no URL, no secret). The coordinator runs the real one at integration; this
 * stand-in answers EXACTLY the contract that door was built to, and nothing
 * kinder.
 *
 * ═══ BOUNDS (it may never exceed them) ═══
 * · GET `/media/<uuid v4>` for a note it holds → 200, the bytes, the stored
 *   `Content-Type`, `Accept-Ranges: bytes`, `Cache-Control: private, no-store`.
 * · A single `Range: bytes=a-b | a- | -n` → 206 with `Content-Range` and
 *   `Content-Length`; a range past the end → 416 `bytes *\/total`. A multi-range
 *   or unparseable header is ignored and answers the full 200, as the media
 *   Worker's open read does today.
 * · Anything else — any method but GET, a malformed path, an unknown ref, a
 *   ref that is not audio — → `404 {"error":"not_found"}`, one uniform answer.
 * · It records every request it is handed (method, path, headers) so a test
 *   can ask what logistics actually sent; it never changes its answer on them.
 * · It says nothing about appearance, and nothing about how long a note is kept.
 */

export interface NoteStockee {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface MediaAudioStandIn {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly recus: { method: string; path: string; headers: Record<string, string> }[];
}

const REF = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const introuvable = (): Response => Response.json({ error: 'not_found' }, { status: 404 });

function plage(header: string | null, total: number): { start: number; end: number } | 'hors' | null {
  if (header === null) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (m === null) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start: number;
  let end: number;
  if (a === '') {
    start = Math.max(0, total - Number(b));
    end = total - 1;
  } else {
    start = Number(a);
    end = b === '' ? total - 1 : Math.min(Number(b), total - 1);
    if (b !== '' && Number(b) < start) return null;
  }
  if (start >= total) return 'hors';
  return { start, end };
}

export function mediaAudioStandIn(notes: Record<string, NoteStockee>): MediaAudioStandIn {
  const recus: MediaAudioStandIn['recus'] = [];
  return {
    recus,
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => {
        headers[k] = v;
      });
      recus.push({ method: request.method, path: url.pathname, headers });
      if (request.method !== 'GET' || !REF.test(url.pathname)) return introuvable();
      const note = notes[url.pathname.slice(1)];
      if (note === undefined || !note.contentType.startsWith('audio/')) return introuvable();
      const total = note.bytes.byteLength;
      const base = { 'Content-Type': note.contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
      const r = plage(request.headers.get('Range'), total);
      if (r === 'hors') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${total}` } });
      if (r === null) return new Response(note.bytes, { status: 200, headers: base });
      return new Response(note.bytes.slice(r.start, r.end + 1), {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${r.start}-${r.end}/${total}`, 'Content-Length': String(r.end - r.start + 1) },
      });
    },
  };
}
