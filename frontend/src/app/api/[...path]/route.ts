import { NextRequest, NextResponse } from "next/server";

const backend = (process.env.BACKEND_PROXY_TARGET ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, ctx: RouteCtx) {
  const { path: segments = [] } = await ctx.params;
  const tail = segments.length > 0 ? segments.join("/") : "";
  const incoming = new URL(request.url);
  const targetUrl = `${backend}/api/${tail}${incoming.search}`;

  const headers = new Headers();
  const ct = request.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const auth = request.headers.get("authorization");
  if (auth) headers.set("authorization", auth);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
  };

  if (!["GET", "HEAD"].includes(request.method)) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) {
      init.body = buf;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, init);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: {
          code: "PROXY_UPSTREAM",
          message: `Cannot reach backend at ${backend}. Start it (e.g. cd backend && npm run dev). ${msg}`,
        },
      },
      { status: 502 }
    );
  }

  const res = new NextResponse(upstream.body, { status: upstream.status });
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "transfer-encoding" || k === "connection") return;
    res.headers.set(key, value);
  });
  return res;
}

export function GET(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx);
}

export function POST(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx);
}

export function PUT(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx);
}

export function PATCH(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx);
}

export function DELETE(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
