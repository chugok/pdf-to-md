#!/bin/bash
# PDF to Markdown 프로젝트 셋업 스크립트
# Claude Code에서 실행: bash setup.sh

PROJECT_DIR="/c/Users/user/Desktop/AI Project/pdf-to-md"
cd "$PROJECT_DIR"

echo "📦 프로젝트 파일 생성 중..."

# package.json
cat > package.json << 'ENDOFFILE'
{
  "name": "pdf-to-markdown",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "pdf-parse": "^1.1.1",
    "@anthropic-ai/sdk": "^0.39.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "@types/react": "^18",
    "typescript": "^5"
  }
}
ENDOFFILE

# tsconfig.json
cat > tsconfig.json << 'ENDOFFILE'
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
ENDOFFILE

# next.config.js
cat > next.config.js << 'ENDOFFILE'
/** @type {import('next').NextConfig} */
const nextConfig = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
}
module.exports = nextConfig
ENDOFFILE

# vercel.json
cat > vercel.json << 'ENDOFFILE'
{
  "functions": {
    "app/api/convert/route.ts": {
      "maxDuration": 120,
      "memory": 1024
    }
  }
}
ENDOFFILE

# .gitignore
cat > .gitignore << 'ENDOFFILE'
node_modules/
.next/
.env
.env.local
ENDOFFILE

# .env.example
cat > .env.example << 'ENDOFFILE'
# Anthropic API Key (OCR 기능에 필요)
ANTHROPIC_API_KEY=sk-ant-xxxxx
ENDOFFILE

# pdf-parse.d.ts
cat > pdf-parse.d.ts << 'ENDOFFILE'
declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: any): Promise<PDFData>;
  export default pdfParse;
}
ENDOFFILE

# Create directories
mkdir -p app/api/convert

echo "📄 app/layout.tsx 생성..."
cat > app/layout.tsx << 'ENDOFFILE'
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PDF → Markdown | Oxford Academy',
  description: 'PDF 파일을 마크다운 텍스트로 변환합니다',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
ENDOFFILE

echo "📄 app/api/convert/route.ts 생성..."
cat > app/api/convert/route.ts << 'ENDOFFILE'
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

    const hasText = textResult.trim().length > 50;
    const useOCR = mode === 'ocr' || (mode === 'auto' && !hasText);

    let markdown: string;
    let method: string;

    if (useOCR) {
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

function formatMarkdown(text: string, fileName: string, fromOCR: boolean): string {
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\ufeff/g, '')
    .replace(/\u00a0/g, ' ');

  if (fromOCR) {
    const title = fileName.replace('.pdf', '').replace(/[-_]/g, ' ');
    return `# ${title}\n\n${cleaned}`;
  }

  const lines = cleaned.split('\n');
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nextLine = lines[i + 1]?.trim() || '';
    const prevLine = lines[i - 1]?.trim() || '';

    if (line === '') { formattedLines.push(''); continue; }
    if (/^#{1,6}\s/.test(line) || /^\|/.test(line) || line === '---') {
      formattedLines.push(line); continue;
    }

    const isShortLine = line.length < 80 && line.length > 2;
    const isAllCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
    const hasNoPunctuation = !/[.,:;!?]$/.test(line);
    const isStandalone = prevLine === '' && (nextLine === '' || nextLine.length > line.length);

    if (isAllCaps && isShortLine && hasNoPunctuation) {
      formattedLines.push(`## ${titleCase(line)}`);
    } else if (isShortLine && hasNoPunctuation && isStandalone && !line.startsWith('-') && !line.startsWith('•') && !/^\d+[\.\)]/.test(line)) {
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
  return str.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
ENDOFFILE

echo "📄 app/page.tsx 생성..."
cat > app/page.tsx << 'ENDOFFILE'
'use client';

import { useState, useCallback, useRef } from 'react';

type Mode = 'auto' | 'text' | 'ocr';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>('auto');
  const [markdown, setMarkdown] = useState('');
  const [fileName, setFileName] = useState('');
  const [pages, setPages] = useState(0);
  const [method, setMethod] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf') { setError('PDF 파일만 업로드 가능합니다.'); return; }
    if (f.size > 50 * 1024 * 1024) { setError('파일 크기는 50MB 이하여야 합니다.'); return; }
    setFile(f); setError(''); setMarkdown('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const convert = async () => {
    if (!file) return;
    setLoading(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mode', mode);
      const res = await fetch('/api/convert', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Conversion failed');
      setMarkdown(data.markdown); setFileName(data.fileName); setPages(data.pages); setMethod(data.method);
    } catch (err: any) { setError(err.message || '변환 중 오류가 발생했습니다.'); }
    finally { setLoading(false); }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const downloadMd = () => {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName || 'converted.md'; a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null); setMarkdown(''); setFileName(''); setPages(0); setMethod(''); setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Noto Sans KR', sans-serif;
          background: #0a0a0f; color: #e8e6e3;
          min-height: 100vh; overflow-x: hidden;
        }
        .page {
          min-height: 100vh;
          background: radial-gradient(ellipse at 20% 0%, rgba(59, 130, 246, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(168, 85, 247, 0.06) 0%, transparent 50%), #0a0a0f;
        }
        .container { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
        .header { text-align: center; margin-bottom: 48px; }
        .badge {
          display: inline-block; padding: 6px 16px;
          background: rgba(59, 130, 246, 0.12); border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: 100px; font-size: 12px; font-weight: 500; color: #60a5fa;
          letter-spacing: 0.5px; margin-bottom: 20px;
        }
        .title {
          font-size: 40px; font-weight: 700; letter-spacing: -1px; margin-bottom: 12px;
          background: linear-gradient(135deg, #fff 0%, #94a3b8 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .subtitle { font-size: 16px; color: #64748b; font-weight: 300; }
        .mode-selector {
          display: flex; gap: 4px; background: rgba(15, 15, 25, 0.6);
          border: 1px solid rgba(100, 116, 139, 0.15); border-radius: 12px; padding: 4px;
          margin-bottom: 24px; max-width: 480px; margin-left: auto; margin-right: auto;
        }
        .mode-btn {
          flex: 1; padding: 10px 16px; border: none; border-radius: 9px;
          background: transparent; color: #64748b; font-size: 13px; font-weight: 500;
          font-family: 'Noto Sans KR', sans-serif; cursor: pointer; transition: all 0.2s ease;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .mode-btn:hover { color: #94a3b8; }
        .mode-btn.active {
          background: rgba(59, 130, 246, 0.15); color: #60a5fa;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
        }
        .mode-label { font-size: 13px; font-weight: 600; }
        .mode-desc { font-size: 10px; opacity: 0.7; }
        .dropzone {
          border: 2px dashed rgba(100, 116, 139, 0.3); border-radius: 16px;
          padding: 56px 32px; text-align: center; cursor: pointer;
          transition: all 0.3s ease; background: rgba(15, 15, 25, 0.5);
          backdrop-filter: blur(10px); position: relative; overflow: hidden;
        }
        .dropzone::before {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.04), transparent 70%);
          pointer-events: none;
        }
        .dropzone:hover, .dropzone.dragover { border-color: rgba(59, 130, 246, 0.5); background: rgba(59, 130, 246, 0.04); }
        .dropzone.has-file { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.04); }
        .drop-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.6; }
        .drop-text { font-size: 16px; color: #94a3b8; margin-bottom: 8px; }
        .drop-hint { font-size: 13px; color: #475569; }
        .file-info { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 4px 0; }
        .file-icon {
          width: 40px; height: 40px; background: rgba(239, 68, 68, 0.1);
          border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;
        }
        .file-name { font-weight: 500; font-size: 15px; color: #e2e8f0; }
        .file-size { font-size: 13px; color: #64748b; }
        .actions { display: flex; gap: 12px; margin-top: 24px; justify-content: center; }
        .btn {
          padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 500;
          font-family: 'Noto Sans KR', sans-serif; cursor: pointer; border: none;
          transition: all 0.2s ease; display: inline-flex; align-items: center; gap: 8px;
        }
        .btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-primary {
          background: linear-gradient(135deg, #3b82f6, #2563eb); color: white;
          box-shadow: 0 4px 14px rgba(59, 130, 246, 0.25);
        }
        .btn-primary:hover:not(:disabled) { box-shadow: 0 6px 20px rgba(59, 130, 246, 0.35); transform: translateY(-1px); }
        .btn-secondary { background: rgba(100, 116, 139, 0.12); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.2); }
        .btn-secondary:hover:not(:disabled) { background: rgba(100, 116, 139, 0.2); color: #e2e8f0; }
        .btn-success { background: rgba(34, 197, 94, 0.12); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.2); }
        .btn-success:hover:not(:disabled) { background: rgba(34, 197, 94, 0.2); }
        .spinner {
          width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, 0.2);
          border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error {
          margin-top: 16px; padding: 12px 16px; background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; color: #f87171;
          font-size: 14px; text-align: center;
        }
        .loading-info { margin-top: 16px; text-align: center; color: #64748b; font-size: 13px; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
        .result { margin-top: 32px; animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .result-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
        .result-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .result-label { font-size: 15px; font-weight: 600; color: #e2e8f0; }
        .result-tag { font-size: 11px; padding: 3px 10px; border-radius: 6px; font-weight: 500; }
        .tag-pages { color: #64748b; background: rgba(100, 116, 139, 0.1); }
        .tag-text { color: #4ade80; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.15); }
        .tag-ocr { color: #a78bfa; background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.15); }
        .result-actions { display: flex; gap: 8px; }
        .btn-sm { padding: 8px 16px; font-size: 13px; border-radius: 8px; }
        .output {
          background: rgba(15, 15, 25, 0.8); border: 1px solid rgba(100, 116, 139, 0.15);
          border-radius: 12px; overflow: hidden;
        }
        .output-bar {
          display: flex; align-items: center; gap: 6px; padding: 12px 16px;
          background: rgba(30, 30, 45, 0.5); border-bottom: 1px solid rgba(100, 116, 139, 0.1);
        }
        .output-dot { width: 10px; height: 10px; border-radius: 50%; }
        .output-content {
          padding: 20px; max-height: 500px; overflow-y: auto;
          font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 1.7;
          color: #cbd5e1; white-space: pre-wrap; word-break: break-word;
        }
        .output-content::-webkit-scrollbar { width: 6px; }
        .output-content::-webkit-scrollbar-track { background: transparent; }
        .output-content::-webkit-scrollbar-thumb { background: rgba(100, 116, 139, 0.3); border-radius: 3px; }
        .footer {
          text-align: center; margin-top: 48px; padding-top: 24px;
          border-top: 1px solid rgba(100, 116, 139, 0.1); font-size: 13px; color: #475569;
        }
        .hidden { display: none; }
        @media (max-width: 640px) {
          .container { padding: 32px 16px; }
          .title { font-size: 28px; }
          .dropzone { padding: 40px 20px; }
          .result-header { flex-direction: column; align-items: flex-start; }
          .mode-selector { flex-direction: column; }
        }
      `}</style>
      <div className="page">
        <div className="container">
          <header className="header">
            <div className="badge">Oxford Academy Tools</div>
            <h1 className="title">PDF → Markdown</h1>
            <p className="subtitle">PDF 파일을 마크다운 텍스트로 빠르게 변환합니다</p>
          </header>
          <div className="mode-selector">
            <button className={`mode-btn ${mode === 'auto' ? 'active' : ''}`} onClick={() => setMode('auto')}>
              <span className="mode-label">⚡ 자동</span><span className="mode-desc">텍스트 없으면 OCR</span>
            </button>
            <button className={`mode-btn ${mode === 'text' ? 'active' : ''}`} onClick={() => setMode('text')}>
              <span className="mode-label">📝 텍스트</span><span className="mode-desc">빠른 추출</span>
            </button>
            <button className={`mode-btn ${mode === 'ocr' ? 'active' : ''}`} onClick={() => setMode('ocr')}>
              <span className="mode-label">🔍 OCR</span><span className="mode-desc">스캔/이미지 PDF</span>
            </button>
          </div>
          <div
            className={`dropzone ${dragOver ? 'dragover' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {file ? (
              <div className="file-info">
                <div className="file-icon">📄</div>
                <div>
                  <div className="file-name">{file.name}</div>
                  <div className="file-size">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              </div>
            ) : (
              <>
                <div className="drop-icon">📎</div>
                <div className="drop-text">PDF 파일을 여기에 드래그하거나 클릭하여 선택</div>
                <div className="drop-hint">최대 50MB · PDF 파일만 지원</div>
              </>
            )}
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={convert} disabled={!file || loading}>
              {loading ? (<><div className="spinner" />변환 중...</>) : '🔄 변환하기'}
            </button>
            {file && <button className="btn btn-secondary" onClick={reset}>초기화</button>}
          </div>
          {loading && mode !== 'text' && (
            <div className="loading-info">
              {mode === 'ocr' ? '🔍 Claude Vision으로 OCR 처리 중... (30초~2분 소요)' : '⚡ 텍스트 추출 시도 중... 텍스트가 없으면 OCR로 전환됩니다'}
            </div>
          )}
          {error && <div className="error">⚠️ {error}</div>}
          {markdown && (
            <div className="result">
              <div className="result-header">
                <div className="result-meta">
                  <span className="result-label">✅ 변환 완료</span>
                  <span className="result-tag tag-pages">{pages}페이지</span>
                  <span className={`result-tag ${method === 'ocr' ? 'tag-ocr' : 'tag-text'}`}>
                    {method === 'ocr' ? '🔍 OCR (Claude Vision)' : '📝 텍스트 추출'}
                  </span>
                </div>
                <div className="result-actions">
                  <button className="btn btn-sm btn-secondary" onClick={copyToClipboard}>
                    {copied ? '✓ 복사됨' : '📋 복사'}
                  </button>
                  <button className="btn btn-sm btn-success" onClick={downloadMd}>💾 .md 다운로드</button>
                </div>
              </div>
              <div className="output">
                <div className="output-bar">
                  <div className="output-dot" style={{ background: '#ef4444' }} />
                  <div className="output-dot" style={{ background: '#eab308' }} />
                  <div className="output-dot" style={{ background: '#22c55e' }} />
                </div>
                <div className="output-content">{markdown}</div>
              </div>
            </div>
          )}
          <footer className="footer">Oxford Academy · PDF to Markdown Converter v2</footer>
        </div>
      </div>
    </>
  );
}
ENDOFFILE

echo ""
echo "✅ 프로젝트 파일 생성 완료!"
echo ""
echo "다음 단계:"
echo "  1. npm install"
echo "  2. git add . && git commit -m 'Initial commit: PDF to Markdown v2'"
echo "  3. GitHub 리포 생성 후 git remote add origin <URL> && git push -u origin main"
echo "  4. Vercel에서 Import → ANTHROPIC_API_KEY 환경변수 추가 → Deploy"
