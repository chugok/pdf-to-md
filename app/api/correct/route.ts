import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' },
        { status: 500 }
      );
    }

    const { text } = await request.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey, timeout: 50000 });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `다음 텍스트의 띄어쓰기와 맞춤법만 교정해주세요.

규칙:
1. 원본의 의미, 구조, 포맷을 절대 변경하지 마세요
2. 마크다운 문법(#, ##, -, |, ---, \`\`\` 등)은 그대로 유지하세요
3. 오직 한국어/영어 맞춤법과 띄어쓰기 오류만 수정하세요
4. 내용을 추가하거나 삭제하지 마세요
5. 교정된 텍스트만 출력하세요 (설명 없이)

텍스트:
${text}`,
        },
      ],
    });

    const corrected = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return NextResponse.json({ corrected });
  } catch (error: any) {
    console.error('Correction error:', error);
    return NextResponse.json(
      { error: '교정 실패: ' + (error.message || 'Unknown error') },
      { status: 500 }
    );
  }
}
