import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const imagePath = path.join("/");

  const res = await fetch(`${process.env.BACKEND_URL}/images/${imagePath}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return new NextResponse(null, { status: res.status });
  }

  const contentType = res.headers.get("content-type") || "image/png";
  const buffer = await res.arrayBuffer();

  return new NextResponse(buffer, {
    headers: { "Content-Type": contentType },
  });
}
