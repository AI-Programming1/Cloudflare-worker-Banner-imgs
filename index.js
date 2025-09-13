// index.js — Cloudflare Worker (upload image -> KV, serve /bg/:id)
// Paste into your worker project root (replace binding name BANNERS in wrangler.toml)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight support for /upload and others
    if (request.method === "OPTIONS") {
      return makeCorsResponse();
    }

    // POST /upload -> store image in KV and return short id
    if (request.method === "POST" && pathname === "/upload") {
      try {
        const MAX_BYTES = 5 * 1024 * 1024; // 5MB limit — change if you want
        const arrayBuffer = await request.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_BYTES) {
          return makeCorsResponse(JSON.stringify({ error: "File too large" }), 413, {
            "Content-Type": "application/json",
          });
        }

        const bytes = new Uint8Array(arrayBuffer);
        const mime = detectMimeType(bytes);
        const id = crypto.randomUUID();

        // store binary in KV; metadata includes mime
        // NOTE: KV supports storing ArrayBuffer/TypedArray directly from Workers
        await env.BANNERS.put(id, arrayBuffer, {
          metadata: { mime },
          // optional: set TTL (seconds). Remove expirationTtl if you don't want auto-expire
          expirationTtl: 60 * 60 * 24 * 7, // 7 days
        });

        return makeCorsResponse(JSON.stringify({ id }), 200, {
          "Content-Type": "application/json",
        });
      } catch (err) {
        return makeCorsResponse(JSON.stringify({ error: err.message }), 500, {
          "Content-Type": "application/json",
        });
      }
    }

    // GET /bg/:id -> return image binary with correct mime
    if (request.method === "GET" && pathname.startsWith("/bg/")) {
      const id = pathname.slice("/bg/".length);
      if (!id) return new Response("Missing ID", { status: 400 });

      // get with metadata
      const obj = await env.BANNERS.getWithMetadata(id, { type: "arrayBuffer" });
      if (!obj || !obj.value) return new Response("Not found", { status: 404 });

      const mime = (obj.metadata && obj.metadata.mime) || "application/octet-stream";
      return new Response(obj.value, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=604800", // 7 days
          // CORS OK for image requests (not strictly necessary for <img> but safe)
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

/** Helpers **/

function makeCorsResponse(body = null, status = 204, headers = {}) {
  const base = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
  return new Response(body, { status, headers: { ...base, ...headers } });
}

/** Detect mime type from magic bytes (Uint8Array) */
function detectMimeType(bytes) {
  if (!bytes || bytes.length < 4) return "application/octet-stream";
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPG (JPEG): FF D8
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return "image/jpeg";
  // GIF: 47 49 46
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}
