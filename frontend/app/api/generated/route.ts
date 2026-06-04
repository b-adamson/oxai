// app/api/generated/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  const res = await fetch(`${process.env.BACKEND_URL}/generated-question`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "No generated question available" },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}