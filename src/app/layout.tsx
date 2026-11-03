import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '青禾 · 年级信息收集',
  description: '本地运行的年级信息收集与统计系统',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
