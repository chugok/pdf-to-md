'use client';

import { useState, useCallback, useRef } from 'react';

type Mode = 'auto' | 'text' | 'ocr' | 'book';
type Progress = { phase: string; current: number; total: number } | null;

const MAX_FILE_SIZE = 500 * 1024 * 1024;

async function getPdfjs() {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  return pdfjsLib;
}

async function extractText(
  file: File,
  onProgress: (cur: number, tot: number) => void
): Promise<{ text: string; pages: number; hasText: boolean }> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join(' ')
      .trim();
    pageTexts.push(text);
    page.cleanup();
    onProgress(i, pdf.numPages);
  }

  const fullText = pageTexts.join('\n\n');
  const hasText = fullText.trim().length > 50;
  pdf.destroy();
  return { text: fullText, pages: pdf.numPages, hasText };
}

async function renderPageToBlob(pdfDoc: any, pageNum: number): Promise<Blob> {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.8);
  });
}

async function ocrPages(
  file: File,
  onProgress: (cur: number, tot: number) => void,
  signal?: AbortSignal
): Promise<{ text: string; pages: number }> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const results: string[] = [];
  const BATCH = 3;
  const CONCURRENCY = 2;
  const totalBatches = Math.ceil(pdf.numPages / BATCH);

  for (let b = 0; b < totalBatches; b += CONCURRENCY) {
    const promises: Promise<string>[] = [];

    for (let c = 0; c < CONCURRENCY && b + c < totalBatches; c++) {
      const idx = b + c;
      const startPage = idx * BATCH + 1;
      const endPage = Math.min(startPage + BATCH - 1, pdf.numPages);

      promises.push(
        (async () => {
          const formData = new FormData();
          for (let p = startPage; p <= endPage; p++) {
            const blob = await renderPageToBlob(pdf, p);
            formData.append('images', blob, `page_${p}.jpg`);
          }
          const data = await safeFetch('/api/ocr', { method: 'POST', body: formData, signal });
          return data.markdown;
        })()
      );
    }

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    const done = Math.min((b + CONCURRENCY) * BATCH, pdf.numPages);
    onProgress(done, pdf.numPages);
  }

  pdf.destroy();
  return { text: results.join('\n\n---\n\n'), pages: pdf.numPages };
}

// --- Book mode helpers ---

function isPageNumber(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // "42", "- 42 -", "— 42 —", "page 42", "p.42", Roman numerals
  if (/^[-–—]?\s*\d{1,4}\s*[-–—]?$/.test(t)) return true;
  if (/^page\s+\d+$/i.test(t)) return true;
  if (/^p\.\s*\d+$/i.test(t)) return true;
  if (/^[ivxlcdm]+$/i.test(t) && t.length <= 8) return true;
  return false;
}

function findRepeating(lines: string[], threshold: number): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const t = line?.trim();
    if (t && t.length > 0 && t.length < 100) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const minCount = Math.floor(lines.length * threshold);
  const result = new Set<string>();
  counts.forEach((count, text) => {
    if (count >= minCount && count >= 3) result.add(text);
  });
  return result;
}

function cleanBookPages(rawPages: string[]): string[] {
  // Detect repeating headers/footers
  const firstLines = rawPages.map(t => t.split('\n')[0]?.trim() || '');
  const lastLines = rawPages.map(t => {
    const lines = t.split('\n');
    return lines[lines.length - 1]?.trim() || '';
  });
  const repeatHeaders = findRepeating(firstLines, 0.3);
  const repeatFooters = findRepeating(lastLines, 0.3);

  return rawPages.map((text) => {
    let lines = text.split('\n');

    // Remove repeating header
    if (lines.length > 0 && repeatHeaders.has(lines[0].trim())) {
      lines.shift();
    }
    // Remove repeating footer
    if (lines.length > 0 && repeatFooters.has(lines[lines.length - 1].trim())) {
      lines.pop();
    }
    // Remove page numbers at start/end
    if (lines.length > 0 && isPageNumber(lines[0])) lines.shift();
    if (lines.length > 0 && isPageNumber(lines[lines.length - 1])) lines.pop();

    return lines.join('\n').trim();
  });
}

async function extractBookText(
  file: File,
  onProgress: (cur: number, tot: number) => void
): Promise<{ text: string; pages: number; hasText: boolean }> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const rawPages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => item.str)
      .join(' ')
      .trim();
    rawPages.push(text);
    page.cleanup();
    onProgress(i, pdf.numPages);
  }

  const cleaned = cleanBookPages(rawPages);
  const fullText = cleaned.join('\n\n');
  const hasText = fullText.trim().length > 50;

  // Format with page markers
  const formatted = cleaned
    .map((text, i) => text ? `[p.${i + 1}]\n${text}` : '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  pdf.destroy();
  return { text: formatted, pages: pdf.numPages, hasText };
}

async function ocrBookPages(
  file: File,
  onProgress: (cur: number, tot: number) => void,
  signal?: AbortSignal
): Promise<{ text: string; pages: number }> {
  const pdfjsLib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const results: string[] = [];
  const BATCH = 3;
  const CONCURRENCY = 2;
  const totalBatches = Math.ceil(pdf.numPages / BATCH);

  for (let b = 0; b < totalBatches; b += CONCURRENCY) {
    const promises: Promise<string>[] = [];

    for (let c = 0; c < CONCURRENCY && b + c < totalBatches; c++) {
      const idx = b + c;
      const startPage = idx * BATCH + 1;
      const endPage = Math.min(startPage + BATCH - 1, pdf.numPages);

      promises.push(
        (async () => {
          const formData = new FormData();
          for (let p = startPage; p <= endPage; p++) {
            const blob = await renderPageToBlob(pdf, p);
            formData.append('images', blob, `page_${p}.jpg`);
          }
          formData.append('mode', 'book');
          formData.append('startPage', String(startPage));
          const data = await safeFetch('/api/ocr', { method: 'POST', body: formData, signal });
          return data.markdown;
        })()
      );
    }

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);

    const done = Math.min((b + CONCURRENCY) * BATCH, pdf.numPages);
    onProgress(done, pdf.numPages);
  }

  pdf.destroy();
  return { text: results.join('\n\n---\n\n'), pages: pdf.numPages };
}

function chunkText(text: string, maxSize: number = 3000): string[] {
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxSize && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function safeFetch(url: string, options: RequestInit): Promise<any> {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`서버 오류 (${res.status}): ${text.slice(0, 100)}`);
  }
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

async function correctText(
  text: string,
  onProgress: (cur: number, tot: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const chunks = chunkText(text);
  const results: string[] = [];
  const CONCURRENCY = 3;

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, Math.min(i + CONCURRENCY, chunks.length));
    const batchResults = await Promise.all(
      batch.map(async (chunk) => {
        const data = await safeFetch('/api/correct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: chunk }),
          signal,
        });
        return data.corrected;
      })
    );
    results.push(...batchResults);
    onProgress(Math.min(i + CONCURRENCY, chunks.length), chunks.length);
  }

  return results.join('\n\n');
}

function formatText(rawText: string, fileName: string): string {
  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\ufeff/g, '')
    .replace(/\u00a0/g, ' ');
  const title = fileName.replace('.pdf', '').replace(/[-_]/g, ' ');
  return `# ${title}\n\n${cleaned}`;
}

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
  const [progress, setProgress] = useState<Progress>(null);
  const [autoCorrect, setAutoCorrect] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleFile = useCallback((f: File) => {
    if (f.type !== 'application/pdf') { setError('PDF 파일만 업로드 가능합니다.'); return; }
    if (f.size > MAX_FILE_SIZE) { setError('파일 크기는 500MB 이하여야 합니다.'); return; }
    setFile(f); setError(''); setMarkdown('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const convert = async () => {
    if (!file) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true); setError(''); setProgress(null);

    try {
      let resultText: string;
      let resultPages: number;
      let resultMethod: string;

      if (mode === 'text') {
        setProgress({ phase: '텍스트 추출', current: 0, total: 0 });
        const { text, pages: p } = await extractText(file, (cur, tot) =>
          setProgress({ phase: '텍스트 추출', current: cur, total: tot })
        );
        resultText = formatText(text, file.name);
        resultPages = p;
        resultMethod = 'text';
      } else if (mode === 'ocr') {
        setProgress({ phase: 'OCR 처리', current: 0, total: 0 });
        const { text, pages: p } = await ocrPages(file, (cur, tot) =>
          setProgress({ phase: 'OCR 처리', current: cur, total: tot }),
          controller.signal
        );
        resultText = formatText(text, file.name);
        resultPages = p;
        resultMethod = 'ocr';
      } else if (mode === 'book') {
        setProgress({ phase: '책 텍스트 추출', current: 0, total: 0 });
        const { text, pages: p, hasText } = await extractBookText(file, (cur, tot) =>
          setProgress({ phase: '책 텍스트 추출', current: cur, total: tot })
        );
        if (hasText) {
          resultText = formatText(text, file.name);
          resultPages = p;
          resultMethod = 'book';
        } else {
          setProgress({ phase: 'OCR 처리 (책)', current: 0, total: 0 });
          const ocrResult = await ocrBookPages(file, (cur, tot) =>
            setProgress({ phase: 'OCR 처리 (책)', current: cur, total: tot }),
            controller.signal
          );
          resultText = formatText(ocrResult.text, file.name);
          resultPages = ocrResult.pages;
          resultMethod = 'book-ocr';
        }
      } else {
        setProgress({ phase: '텍스트 추출', current: 0, total: 0 });
        const { text, pages: p, hasText } = await extractText(file, (cur, tot) =>
          setProgress({ phase: '텍스트 추출', current: cur, total: tot })
        );
        if (hasText) {
          resultText = formatText(text, file.name);
          resultPages = p;
          resultMethod = 'text';
        } else {
          setProgress({ phase: 'OCR 전환 (텍스트 없음)', current: 0, total: 0 });
          const ocrResult = await ocrPages(file, (cur, tot) =>
            setProgress({ phase: 'OCR 처리', current: cur, total: tot }),
            controller.signal
          );
          resultText = formatText(ocrResult.text, file.name);
          resultPages = ocrResult.pages;
          resultMethod = 'ocr';
        }
      }

      if (autoCorrect) {
        setProgress({ phase: 'AI 교정', current: 0, total: 0 });
        resultText = await correctText(resultText, (cur, tot) =>
          setProgress({ phase: 'AI 교정', current: cur, total: tot }),
          controller.signal
        );
      }

      setMarkdown(resultText);
      setFileName(file.name.replace('.pdf', '.md'));
      setPages(resultPages);
      setMethod(resultMethod);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('변환이 취소되었습니다.');
      } else {
        setError(err.message || '변환 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false); setProgress(null); abortRef.current = null;
    }
  };

  const cancelConvert = () => {
    abortRef.current?.abort();
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
    setFile(null); setMarkdown(''); setFileName(''); setPages(0);
    setMethod(''); setError(''); setProgress(null);
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
        .option-row {
          display: flex; align-items: center; justify-content: center; gap: 10px;
          margin-bottom: 24px;
        }
        .toggle-label {
          display: flex; align-items: center; gap: 10px; cursor: pointer;
          padding: 8px 18px; border-radius: 10px;
          background: rgba(15, 15, 25, 0.6); border: 1px solid rgba(100, 116, 139, 0.15);
          transition: all 0.2s ease; user-select: none;
        }
        .toggle-label:hover { border-color: rgba(168, 85, 247, 0.3); }
        .toggle-label.active {
          background: rgba(168, 85, 247, 0.1); border-color: rgba(168, 85, 247, 0.3);
        }
        .toggle-switch {
          width: 36px; height: 20px; border-radius: 10px;
          background: rgba(100, 116, 139, 0.3); position: relative;
          transition: background 0.2s ease; flex-shrink: 0;
        }
        .toggle-switch.on { background: rgba(168, 85, 247, 0.6); }
        .toggle-switch::after {
          content: ''; position: absolute; top: 2px; left: 2px;
          width: 16px; height: 16px; border-radius: 50%;
          background: #e2e8f0; transition: transform 0.2s ease;
        }
        .toggle-switch.on::after { transform: translateX(16px); }
        .toggle-text { font-size: 13px; color: #94a3b8; font-weight: 500; }
        .toggle-label.active .toggle-text { color: #c4b5fd; }
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
        .btn-danger { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
        .btn-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.25); }
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
        .progress-container { margin-top: 16px; max-width: 480px; margin-left: auto; margin-right: auto; }
        .progress-bar {
          height: 6px; background: rgba(100, 116, 139, 0.15);
          border-radius: 3px; overflow: hidden; margin-bottom: 8px;
        }
        .progress-fill {
          height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa);
          border-radius: 3px; transition: width 0.3s ease;
        }
        .progress-text {
          text-align: center; font-size: 13px; color: #64748b;
          animation: pulse 2s ease-in-out infinite;
        }
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
        .tag-book { color: #fb923c; background: rgba(251, 146, 60, 0.1); border: 1px solid rgba(251, 146, 60, 0.15); }
        .tag-corrected { color: #c4b5fd; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.15); }
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
            <button className={`mode-btn ${mode === 'book' ? 'active' : ''}`} onClick={() => setMode('book')}>
              <span className="mode-label">📖 책</span><span className="mode-desc">페이지번호 제거</span>
            </button>
          </div>
          <div className="option-row">
            <div
              className={`toggle-label ${autoCorrect ? 'active' : ''}`}
              onClick={() => setAutoCorrect(!autoCorrect)}
            >
              <div className={`toggle-switch ${autoCorrect ? 'on' : ''}`} />
              <span className="toggle-text">AI 자동 교정 (띄어쓰기·맞춤법)</span>
            </div>
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
                <div className="drop-hint">최대 500MB · PDF 파일만 지원</div>
              </>
            )}
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={convert} disabled={!file || loading}>
              {loading ? (<><div className="spinner" />변환 중...</>) : '🔄 변환하기'}
            </button>
            {loading && <button className="btn btn-danger" onClick={cancelConvert}>⏹ 중단</button>}
            {file && !loading && <button className="btn btn-secondary" onClick={reset}>초기화</button>}
          </div>
          {loading && progress && (
            <div className="progress-container">
              {progress.total === 0 ? (
                <div className="progress-text">📄 {progress.phase}...</div>
              ) : (
                <>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                  </div>
                  <div className="progress-text">
                    {progress.phase} ({progress.current}/{progress.total}) · {Math.round((progress.current / progress.total) * 100)}%
                  </div>
                </>
              )}
            </div>
          )}
          {error && <div className="error">⚠️ {error}</div>}
          {markdown && (
            <div className="result">
              <div className="result-header">
                <div className="result-meta">
                  <span className="result-label">✅ 변환 완료</span>
                  <span className="result-tag tag-pages">{pages}페이지</span>
                  <span className={`result-tag ${method === 'ocr' ? 'tag-ocr' : method.startsWith('book') ? 'tag-book' : 'tag-text'}`}>
                    {method === 'ocr' ? '🔍 OCR (Claude Vision)' : method === 'book-ocr' ? '📖🔍 책 OCR' : method === 'book' ? '📖 책 추출' : '📝 텍스트 추출'}
                  </span>
                  {autoCorrect && <span className="result-tag tag-corrected">✨ AI 교정</span>}
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
