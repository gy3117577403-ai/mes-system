import { NextResponse } from 'next/server';

const provider = 'DeepSeek';
const model = 'deepseek-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const required = ['DATABASE_URL', 'DEEPSEEK_API_KEY'] as const;
  const missing = required.filter((name) => !(process.env[name] ?? '').trim());

  return NextResponse.json({
    configured: missing.length === 0,
    provider,
    model,
    missing,
  });
}
