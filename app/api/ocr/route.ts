import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인해주세요.' },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const images = formData.getAll('images') as File[];
    const mode = (formData.get('mode') as string) || 'default';
    const startPage = formData.get('startPage') as string;

    if (!images.length) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    const imageBlocks: Anthropic.ImageBlockParam[] = [];
    for (const img of images) {
      const buffer = Buffer.from(await img.arrayBuffer());
      imageBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: buffer.toString('base64'),
        },
      });
    }

    const defaultPrompt = `이 PDF 페이지 이미지들의 모든 텍스트를 정확하게 추출해주세요.

규칙:
1. 모든 페이지의 텍스트를 순서대로 추출
2. 제목, 소제목은 ## 또는 ### 마크다운 헤딩으로 표시
3. 목록은 - 또는 1. 2. 3. 형식 유지
4. 표가 있으면 마크다운 테이블 형식으로 변환
5. 수식이 있으면 최대한 텍스트로 표현
6. 이미지 설명은 [이미지: 설명] 형식으로
7. 페이지 구분은 --- 로 표시
8. 원본 구조와 포맷을 최대한 보존
9. 헤더/푸터(페이지 번호 등)는 제외
10. 오직 추출된 텍스트만 출력하고, 부연 설명은 하지 마세요`;

    const bookPrompt = `이 책 페이지 이미지들에서 본문 텍스트만 정확하게 추출해주세요.
${startPage ? `(페이지 ${startPage}부터 시작)` : ''}

규칙:
1. 페이지 번호는 반드시 제외
2. 머리글(헤더: 책 제목, 챕터 제목 반복 등)은 제외
3. 바닥글(푸터: 출판사 정보 등)은 제외
4. 본문 텍스트만 순서대로 추출
5. 챕터/섹션 제목은 ## 마크다운 헤딩으로 표시
6. 각주는 [각주: 내용] 형식으로
7. 표가 있으면 마크다운 테이블 형식으로 변환
8. 이미지 설명은 [이미지: 설명] 형식으로
9. 각 페이지 시작에 [p.페이지번호] 마커를 붙여주세요
10. 오직 추출된 본문만 출력하고, 부연 설명은 하지 마세요`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            {
              type: 'text',
              text: mode === 'book' ? bookPrompt : defaultPrompt,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return NextResponse.json({ markdown: text });
  } catch (error: any) {
    console.error('OCR error:', error);
    return NextResponse.json(
      { error: 'OCR 실패: ' + (error.message || 'Unknown error') },
      { status: 500 }
    );
  }
}
