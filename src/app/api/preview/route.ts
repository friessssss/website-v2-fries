import { draftMode } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const previewSecret =
  process.env.SANITY_PREVIEW_SECRET ?? process.env.NEXT_PUBLIC_SANITY_PREVIEW_SECRET;

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const secret = searchParams.get("secret");
  const redirectPath = searchParams.get("redirect") ?? "/";

  if (previewSecret && secret !== previewSecret) {
    return new NextResponse("Invalid preview token", { status: 401 });
  }

  draftMode().enable();

  const redirectUrl = new URL(redirectPath, origin);
  return NextResponse.redirect(redirectUrl);
}
