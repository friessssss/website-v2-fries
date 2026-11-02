import { NextResponse } from 'next/server';
import { latestHelper } from '@/lib/rl/helper-release';
import { withErrors } from '@/lib/rl/request';

export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => NextResponse.json(await latestHelper(Date.now())));
