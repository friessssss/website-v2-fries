import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

const webhookSecret =
  process.env.SANITY_REVALIDATE_SECRET ??
  process.env.SANITY_WEBHOOK_SECRET ??
  process.env.NEXT_PUBLIC_SANITY_PREVIEW_SECRET;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const secretFromRequest =
    body?.secret ?? request.nextUrl.searchParams.get("secret");

  if (webhookSecret && secretFromRequest !== webhookSecret) {
    return NextResponse.json({ revalidated: false, reason: "Invalid secret" }, { status: 401 });
  }

  const path = body?.path ?? "/";
  const tag = body?.tag ?? "sanity-home";

  revalidatePath(path);
  revalidateTag(tag);

  return NextResponse.json({ revalidated: true, path, tag, now: Date.now() });
}
