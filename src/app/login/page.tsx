'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Cpu, Lock, User } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { UserRole } from '@/types/auth';

const ROLES: { role: UserRole; label: string; accent: string }[] = [
  { role: 'Boss', label: '老板', accent: 'from-amber-500/80 to-orange-600/80 border-amber-400/50' },
  { role: 'Planner', label: '计划', accent: 'from-cyan-500/80 to-blue-600/80 border-cyan-400/50' },
  { role: 'Engineering', label: '技术', accent: 'from-rose-500/80 to-fuchsia-700/80 border-rose-400/50' },
  { role: 'Warehouse', label: '仓库', accent: 'from-yellow-400/80 to-amber-700/80 border-yellow-400/50' },
  { role: 'Employee', label: '员工', accent: 'from-emerald-500/80 to-teal-700/80 border-emerald-400/50' },
];

export default function LoginPage() {
  const { user, login, isHydrated } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!isHydrated) return;
    if (user) router.replace('/');
  }, [isHydrated, user, router]);

  const handleRoleLogin = (role: UserRole) => {
    const name = username.trim() || '访客';
    login(name, role);
  };

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-[#05080f] flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#05080f] text-slate-200 flex items-center justify-center p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            radial-gradient(circle at 1px 1px, rgba(34,211,238,0.12) 1px, transparent 0),
            linear-gradient(rgba(15,23,42,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(15,23,42,0.4) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px, 64px 64px, 64px 64px',
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-cyan-950/30 via-transparent to-violet-950/20 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-cyan-500/25 bg-slate-950/70 backdrop-blur-xl shadow-[0_0_60px_rgba(34,211,238,0.12),0_25px_80px_rgba(0,0,0,0.5)] p-8"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-cyan-500/30 shadow-[0_0_20px_rgba(34,211,238,0.25)]">
            <Cpu className="w-8 h-8 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">MES 协同终端</h1>
            <p className="text-xs text-cyan-400/80 font-mono tracking-[0.2em] mt-1">OFFLINE MOCK · RBAC</p>
          </div>
        </div>

        <div className="space-y-4 mb-8">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="用户名（可空，默认访客）"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 transition-shadow"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="password"
              placeholder="密码（模拟，任意输入即可）"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRoleLogin('Employee')}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/80 border border-slate-700/80 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 transition-shadow"
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 mb-3 font-bold tracking-wide">选择角色进入系统</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ROLES.map(({ role, label, accent }) => (
            <motion.button
              key={role}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleRoleLogin(role)}
              className={`rounded-xl px-4 py-3 font-black text-sm text-white bg-gradient-to-r border shadow-lg transition-all ${accent} hover:shadow-[0_0_24px_rgba(34,211,238,0.2)]`}
            >
              {label}
            </motion.button>
          ))}
        </div>

        <p className="mt-8 text-center text-[10px] text-slate-600 font-mono">
          无后端验证 · 状态存 localStorage · 仅供演示
        </p>
      </motion.div>
    </div>
  );
}
