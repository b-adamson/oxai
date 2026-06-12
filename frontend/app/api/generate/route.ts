// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { recordUsage } from "@/lib/usage";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const response = await fetch(`${process.env.BACKEND_URL}/generate-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        { error: data?.detail || "Failed to generate question" },
        { status: response.status }
      );
    }

    await recordUsage("generations");
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}