import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperId: string }> }
) {
  const { paperId } = await params;

  const res = await fetch(`${process.env.BACKEND_URL}/papers/${paperId}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to load paper" },
      { status: res.status }
    );
  }

  const data = await res.json();

  // Rewrite figure src paths to go through the Next.js image proxy
  if (Array.isArray(data.paper?.questions)) {
    const exam: string = data.meta?.exam ?? '';
    const imgPrefix = exam === 'TMUA' ? '/api/images/tmua' : '/api/images';
    for (const q of data.paper.questions) {
      for (const fig of q.prompt?.figures ?? []) {
        if (fig.src && !fig.src.startsWith("/api/")) {
          fig.src = `${imgPrefix}/${fig.src}`;
        }
        // complex_diagram uses .url instead of .src
        if (fig.url && fig.url.startsWith('/images/')) {
          fig.url = fig.url.replace('/images/', '/api/images/');
        }
      }
    }
  }

  return NextResponse.json(data);
}