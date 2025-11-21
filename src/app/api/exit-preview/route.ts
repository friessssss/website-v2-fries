import { draftMode } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  draftMode().disable();
  const redirectUrl = new URL(request.nextUrl.searchParams.get("redirect") ?? "/", request.url);
  return NextResponse.redirect(redirectUrl);
}
