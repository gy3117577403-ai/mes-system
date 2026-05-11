'use client';

import { useEffect } from 'react';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function GlobalError({ error, unstable_retry }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[app/global-error]', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#020617',
            color: '#f8fafc',
            padding: 24,
            fontFamily: 'Arial, sans-serif',
          }}
        >
          <section
            style={{
              width: '100%',
              maxWidth: 480,
              border: '1px solid rgba(248, 113, 113, 0.35)',
              borderRadius: 8,
              background: '#0f172a',
              padding: 24,
            }}
          >
            <p style={{ margin: 0, color: '#fca5a5', fontSize: 12, fontWeight: 700 }}>
              GLOBAL RENDER ERROR
            </p>
            <h1 style={{ margin: '12px 0 0', fontSize: 24, lineHeight: 1.25 }}>
              AI 排单执行失败，请检查模型配置、数据库连接或稍后重试
            </h1>
            <p style={{ margin: '12px 0 0', color: '#94a3b8', fontSize: 14, lineHeight: 1.7 }}>
              根布局异常已被全局错误页拦截。请检查 Sealos 环境变量和服务日志。
            </p>
            {error.digest && (
              <p style={{ margin: '12px 0 0', color: '#64748b', fontSize: 12 }}>Digest: {error.digest}</p>
            )}
            <button
              type="button"
              onClick={() => unstable_retry()}
              style={{
                marginTop: 20,
                border: 0,
                borderRadius: 6,
                background: '#22d3ee',
                color: '#020617',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 700,
                padding: '10px 16px',
              }}
            >
              重试
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
