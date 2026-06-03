import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch(`${process.env.BACKEND_URL}/papers`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to load papers" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}