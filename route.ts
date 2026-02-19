import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ──────────────────────────────────────
// Main handler
// ──────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const mode = (formData.get('mode') as string) || 'auto';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'PDF 파일만 지원합니다' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Step 1: Try text extraction first
    let textResult = '';
    let numpages = 0;

    try {
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);
      textResult = data.text;
      numpages = data.numpages;
    } catch (e) {
      console.error('pdf-parse failed:', e);
    }

    // Step 2: Decide whether to use OCR
    const hasText = textResult.trim().length > 50;
    const useOCR = mode === 'ocr' || (mode === 'auto' && !hasText);

    let markdown: string;
    let method: string;

    if (useOCR) {
      // Check API key
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인해주세요.' },
          { status: 500 }
        );
      }

      const ocrResult = await ocrWithVision(buffer, apiKey);
      markdown = formatMarkdown(ocrResult.text, file.name, true);
      numpages = ocrResult.pages || numpages;
      method = 'ocr';
    } else {
      markdown = formatMarkdown(textResult, file.name, false);
      method = 'text';
    }

    return NextResponse.json({
      markdown,
      pages: numpages,
      method,
      fileName: file.name.replace('.pdf', '.md'),
    });
  } catch (error: any) {
    console.error('Conversion error:', error);
    return NextResponse.json(
      { error: '변환 실패: ' + (error.message || 'Unknown error') },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────
// OCR with Claude Vision (PDF native)
// ──────────────────────────────────────
async function ocrWithVision(
  pdfBuffer: Buffer,
  apiKey: string
): Promise<{ text: string; pages: number }> {
  const client = new Anthropic({ apiKey });
  const base64 = pdfBuffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64,
            },
          },
          {
            type: 'text',
            text: `이 PDF 문서의 모든 텍스트를 정확하게 추출해주세요.

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
10. 오직 추출된 텍스트만 출력하고, 부연 설명은 하지 마세요`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  let pages = 1;
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(pdfBuffer);
    pages = data.numpages;
  } catch {
    pages = (text.match(/---/g) || []).length + 1;
  }

  return { text, pages };
}

// ──────────────────────────────────────
// Format text to Markdown
// ──────────────────────────────────────
function formatMarkdown(text: string, fileName: string, fromOCR: boolean): string {
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\ufeff/g, '')
    .replace(/\u00a0/g, ' ');

  // If from OCR, Claude already formatted it as markdown, just add title
  if (fromOCR) {
    const title = fileName.replace('.pdf', '').replace(/[-_]/g, ' ');
    return `# ${title}\n\n${cleaned}`;
  }

  // Text extraction: try to detect structure
  const lines = cleaned.split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1]?.trim() || '';
    const prevLine = lines[i - 1]?.trim() || '';

    if (line === '') {
      formattedLines.push('');
      continue;
    }

    if (/^#{1,6}\s/.test(line) || /^\|/.test(line) || line === '---') {
      formattedLines.push(line);
      continue;
    }

    const isShortLine = line.length < 80 && line.length > 2;
    const isAllCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
    const hasNoPunctuation = !/[.,:;!?]$/.test(line);
    const isStandalone = prevLine === '' && (nextLine === '' || nextLine.length > line.length);

    if (isAllCaps && isShortLine && hasNoPunctuation) {
      formattedLines.push(`## ${titleCase(line)}`);
    } else if (
      isShortLine &&
      hasNoPunctuation &&
      isStandalone &&
      !line.startsWith('-') &&
      !line.startsWith('•') &&
      !/^\d+[\.\)]/.test(line)
    ) {
      formattedLines.push(`### ${line}`);
    } else if (/^[•●○▪▸►–—-]\s/.test(line)) {
      formattedLines.push(`- ${line.replace(/^[•●○▪▸►–—-]\s*/, '')}`);
    } else {
      formattedLines.push(line);
    }
  }

  const title = fileName.replace('.pdf', '').replace(/[-_]/g, ' ');
  return `# ${title}\n\n${formattedLines.join('\n')}`;
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
