import { NextRequest, NextResponse } from 'next/server';
import { signToken, authCookieOptions } from '@/lib/auth';

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'oxford1234!';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    if (password !== SITE_PASSWORD) {
      return NextResponse.json({ error: '비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    const token = await signToken();
    const res = NextResponse.json({ success: true });
    res.cookies.set(authCookieOptions(token));
    return res;
  } catch {
    return NextResponse.json({ error: '오류가 발생했습니다.' }, { status: 500 });
  }
}
