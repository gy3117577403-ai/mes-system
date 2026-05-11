'use client';

import { useEffect } from 'react';

type ErrorPageProps = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function ErrorPage({ error, unstable_retry }: ErrorPageProps) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <section className="w-full max-w-md rounded-lg border border-red-400/30 bg-slate-900 p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-red-300">Server Component Error</p>
        <h1 className="mt-3 text-2xl font-bold">AI 排单执行失败，请检查模型配置、数据库连接或稍后重试</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          页面已拦截生产环境渲染异常。请确认 Sealos 环境变量、数据库连接和 AI 模型服务状态。
        </p>
        {error.digest && <p className="mt-3 text-xs text-slate-500">Digest: {error.digest}</p>}
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-5 rounded-md bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
        >
          重试
        </button>
      </section>
    </main>
  );
}
