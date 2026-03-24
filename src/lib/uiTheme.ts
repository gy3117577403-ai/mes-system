/** 全域 UI 主題與看板佈局（Mock，可日後接 Context） */
export type AppTheme = 'dark' | 'light';
export type LayoutMode = 'card' | 'compact';

export function cn(...parts: (string | false | undefined | null)[]) {
  return parts.filter(Boolean).join(' ');
}

/** 根容器 */
export function pageShell(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-[#070b12] text-slate-200'
    : 'bg-gray-50 text-gray-900';
}

/** 浮動警報條 */
export function alertBanner(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-red-900/20 border-b border-red-800/50'
    : 'bg-red-50 border-b border-red-200';
}

/** Header 主列（manager） */
export function headerBar(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-900/85 backdrop-blur-xl border-b border-cyan-500/15 shadow-[0_0_40px_rgba(34,211,238,0.06)]'
    : 'bg-white/95 backdrop-blur-xl border-b border-gray-300 shadow-sm';
}

export function headerTitle(theme: AppTheme) {
  return theme === 'dark' ? 'text-slate-100' : 'text-gray-900';
}

export function headerMuted(theme: AppTheme) {
  return theme === 'dark' ? 'text-slate-400' : 'text-gray-600';
}

export function headerInput(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600'
    : 'bg-white border-gray-300 text-gray-900 placeholder:text-gray-500';
}

export function headerSelect(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-900 border-slate-700 text-slate-300'
    : 'bg-white border-gray-300 text-gray-900';
}

export function headerBtnGhost(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'
    : 'bg-gray-100 border-gray-300 text-gray-900 hover:bg-gray-200';
}

/** 看板外層 */
export function kanbanOuter(theme: AppTheme) {
  return theme === 'dark' ? '' : 'bg-gray-100';
}

/** 三池 / 日列外殼 */
export function poolShellOuter(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-900/50 backdrop-blur-md'
    : 'bg-white/90 backdrop-blur-md shadow-sm';
}

export function poolShellHeader(theme: AppTheme) {
  return theme === 'dark'
    ? 'border-b border-slate-700/80 bg-slate-950/40'
    : 'border-b border-gray-300 bg-gray-50';
}

export function poolShellTitle(theme: AppTheme) {
  return theme === 'dark' ? 'text-slate-100' : 'text-gray-900';
}

export function poolShellSub(theme: AppTheme) {
  return theme === 'dark' ? 'text-slate-500' : 'text-gray-600';
}

export function poolEmpty(theme: AppTheme) {
  return theme === 'dark'
    ? 'text-slate-500 border-slate-700/80 bg-slate-950/30'
    : 'text-gray-500 border-gray-300 bg-white';
}

export function dayColumnShell(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-slate-900/50 backdrop-blur-md border border-slate-700/80'
    : 'bg-white backdrop-blur-md border border-gray-300 shadow-sm';
}

export function dayColumnHeader(theme: AppTheme) {
  return theme === 'dark' ? 'bg-slate-950/40 border-slate-700' : 'bg-gray-50 border-gray-200';
}

/** Workshop 主區 */
export function workshopRoot(theme: AppTheme) {
  return theme === 'dark'
    ? 'bg-[#070b12] text-slate-200'
    : 'bg-gray-50 text-gray-900';
}

export function workshopTitle(theme: AppTheme) {
  return theme === 'dark' ? 'text-cyan-400' : 'text-cyan-700';
}

export function workshopDayTab(theme: AppTheme, isActive: boolean) {
  if (theme === 'dark') {
    return isActive
      ? 'bg-gradient-to-t from-cyan-500/15 to-transparent border-b-[3px] border-cyan-400'
      : 'bg-transparent border-b border-slate-800/50';
  }
  return isActive
    ? 'bg-gradient-to-t from-cyan-100 to-transparent border-b-[3px] border-cyan-600'
    : 'bg-transparent border-b border-gray-300';
}
