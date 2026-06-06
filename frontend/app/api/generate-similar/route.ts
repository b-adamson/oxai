import { NextResponse } from 'next/server';
import { upsertGeneratedQuestion } from '@/lib/questionPool';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const response = await fetch(`${process.env.BACKEND_URL}/generate-similar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json({ error: data?.detail || 'Failed' }, { status: response.status });
    }
    await upsertGeneratedQuestion(data);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
