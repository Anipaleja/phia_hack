import { NextResponse } from "next/server";

const backend = (process.env.BACKEND_PROXY_TARGET ?? "http://127.0.0.1:3001").replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${backend}/health`, { cache: "no-store" });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
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
}
