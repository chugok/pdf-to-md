'use client';

import { useState, useCallback, useRef } from 'react';

type Mode = 'auto' | 'text' | 'ocr';
type Progress = { phase: 'splitting' | 'converting'; current: number; total: number } | null;

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const CHUNK_THRESHOLD = 4 * 1024 * 1024;
const PAGES_PER_CHUNK = 10;

async function splitPdf(file: File): Promise<{ chunks: Blob[]; totalPages: number }> {
  if (file.size <= CHUNK_THRESHOLD) {
    return {
      chunks: [new Blob([await file.arrayBuffer()], { type: 'application/pdf' })],
      totalPages: 0,
    };
  }

  const { PDFDocument } = await import('pdf-lib');
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const chunks: Blob[] = [];

  for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const chunkDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const copiedPages = await chunkDoc.copyPages(pdfDoc, indices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));
    chunks.push(new Blob([await chunkDoc.save()], { type: 'application/pdf' }));
  }

  return { chunks, totalPages };
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setLoading(true); setError(''); setProgress(null);

    try {
      setProgress({ phase: 'splitting', current: 0, total: 0 });
      const { chunks, totalPages } = await splitPdf(file);
      const isChunked = chunks.length > 1;

      setProgress({ phase: 'converting', current: 0, total: chunks.length });

      const results: { markdown: string; method: string; pages: number }[] = [];
      const CONCURRENCY = mode === 'ocr' ? 2 : 3;

      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, Math.min(i + CONCURRENCY, chunks.length));
        const batchResults = await Promise.all(
          batch.map(async (chunk) => {
            const formData = new FormData();
            formData.append('file', chunk, file.name);
            formData.append('mode', mode);
            if (isChunked) formData.append('chunk', 'true');

            const res = await fetch('/api/convert', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Conversion failed');
            return data;
          })
        );
        results.push(...batchResults);
        setProgress({ phase: 'converting', current: Math.min(i + CONCURRENCY, chunks.length), total: chunks.length });
      }

      let combined: string;
      if (isChunked) {
        const title = file.name.replace('.pdf', '').replace(/[-_]/g, ' ');
        combined = `# ${title}\n\n${results.map((r) => r.markdown).join('\n\n---\n\n')}`;
      } else {
        combined = results[0].markdown;
      }

      const methods = [...new Set(results.map((r) => r.method))];
      const finalMethod = methods.length === 1 ? methods[0] : 'mixed';
      const finalPages = totalPages || results.reduce((sum, r) => sum + (r.pages || 0), 0);

      setMarkdown(combined);
      setFileName(file.name.replace('.pdf', '.md'));
      setPages(finalPages);
      setMethod(finalMethod);
    } catch (err: any) {
      setError(err.message || '변환 중 오류가 발생했습니다.');
    } finally {
      setLoading(false); setProgress(null);
    }
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
    setFile(null); setMarkdown(''); setFileName(''); setPages(0); setMethod(''); setError(''); setProgress(null);
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
        .tag-mixed { color: #fbbf24; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.15); }
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
                <div className="drop-hint">최대 500MB · PDF 파일만 지원</div>
              </>
            )}
          </div>
          <div className="actions">
            <button className="btn btn-primary" onClick={convert} disabled={!file || loading}>
              {loading ? (<><div className="spinner" />변환 중...</>) : '🔄 변환하기'}
            </button>
            {file && <button className="btn btn-secondary" onClick={reset}>초기화</button>}
          </div>
          {loading && progress && (
            <div className="progress-container">
              {progress.phase === 'splitting' ? (
                <div className="progress-text">📄 PDF 분석 중...</div>
              ) : (
                <>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
                  </div>
                  <div className="progress-text">
                    {mode === 'ocr' ? '🔍 OCR' : '⚡'} 변환 중... ({progress.current}/{progress.total})
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
                  <span className={`result-tag ${method === 'ocr' ? 'tag-ocr' : method === 'mixed' ? 'tag-mixed' : 'tag-text'}`}>
                    {method === 'ocr' ? '🔍 OCR (Claude Vision)' : method === 'mixed' ? '⚡🔍 텍스트+OCR' : '📝 텍스트 추출'}
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
