import { NextResponse } from "next/server";
import { getServices } from "@/server/store";

/** POST /api/ai/match-template — title/offer text -> suggested template + stack. */
export async function POST(req: Request) {
  const body = (await req.json()) as { title?: string; offerText?: string };

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { ai } = await getServices();
  const match = await ai.matchTemplate({
    title: body.title,
    offerText: body.offerText,
  });
  return NextResponse.json({ match });
}
