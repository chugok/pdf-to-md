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
