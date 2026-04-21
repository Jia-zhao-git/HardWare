// Theme configuration - Diversified themes with distinct styles

export interface Theme {
  name: string;
  subname?: string;
  colors: {
    bgPrimary: string;
    bgSecondary: string;
    bgCard: string;
    bgCardHover: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accentPrimary: string;
    accentSecondary: string;
    accentWarning: string;
    accentError: string;
    accentPurple: string;
    shadowGlow: string;
    shadowCard: string;
    sidebarBg: string;
    headerBg: string;
    navActiveBg: string;
    navHoverBg: string;
    navBorderAccent?: string;
    cardBg?: string;
    cardBorder?: string;
    cardShadow?: string;
    fontFamily?: string;
    fontWeightNav?: number;
    navStyle?: 'fill' | 'border-left' | 'underline' | 'pill';
    borderRadius: string;
    glowIntensity: string;
    sidebarWidth: string;
    separatorColor?: string;
    inputBg?: string;
  };
}

export const themes: Record<string, Theme> = {
  // ===== 暗夜科技 =====
  dark: {
    name: '🌙 暗夜科技',
    subname: '经典深色 · 专业开发',
    colors: {
      bgPrimary: '#0d1117',
      bgSecondary: '#161b22',
      bgCard: '#21262d',
      bgCardHover: '#30363d',
      border: '#30363d',
      textPrimary: '#c9d1d9',
      textSecondary: '#8b949e',
      textMuted: '#484f58',
      accentPrimary: '#58a6ff',
      accentSecondary: '#3fb950',
      accentWarning: '#d29922',
      accentError: '#f85149',
      accentPurple: '#bc8cff',
      shadowGlow: '0 0 20px rgba(88, 166, 255, 0.15)',
      shadowCard: '0 8px 24px rgba(0, 0, 0, 0.5)',
      sidebarBg: '#0d1117',
      headerBg: '#161b22',
      navActiveBg: 'rgba(88, 166, 255, 0.15)',
      navHoverBg: 'rgba(255, 255, 255, 0.06)',
      cardBg: '#21262d',
      cardBorder: '#30363d',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontWeightNav: 500,
      navStyle: 'fill',
      borderRadius: '8px',
      glowIntensity: '0.15',
      sidebarWidth: '240px',
      inputBg: '#0d1117',
    },
  },

  // ===== 深空灰 =====
  space: {
    name: '🚀 深空灰',
    subname: '极简主义 · 高级质感',
    colors: {
      bgPrimary: '#1a1a1a',
      bgSecondary: '#242424',
      bgCard: '#2d2d2d',
      bgCardHover: '#383838',
      border: '#404040',
      textPrimary: '#e5e5e5',
      textSecondary: '#a3a3a3',
      textMuted: '#737373',
      accentPrimary: '#60a5fa',
      accentSecondary: '#34d399',
      accentWarning: '#fbbf24',
      accentError: '#f87171',
      accentPurple: '#a78bfa',
      shadowGlow: '0 0 24px rgba(96, 165, 250, 0.18)',
      shadowCard: '0 8px 32px rgba(0, 0, 0, 0.6)',
      sidebarBg: '#1a1a1a',
      headerBg: '#1a1a1a',
      navActiveBg: 'rgba(96, 165, 250, 0.18)',
      navHoverBg: 'rgba(255, 255, 255, 0.05)',
      navBorderAccent: '#60a5fa',
      cardBg: '#2d2d2d',
      cardBorder: '#404040',
      fontFamily: "'Inter', 'SF Pro Display', -apple-system, sans-serif",
      fontWeightNav: 500,
      navStyle: 'border-left',
      borderRadius: '12px',
      glowIntensity: '0.18',
      sidebarWidth: '240px',
      separatorColor: '#2d2d2d',
      inputBg: '#242424',
    },
  },

  // ===== 紫罗兰 =====
  violet: {
    name: '💜 紫罗兰',
    subname: '优雅紫色 · 现代美学',
    colors: {
      bgPrimary: '#1a1025',
      bgSecondary: '#231735',
      bgCard: '#2d1f45',
      bgCardHover: '#3d2a5c',
      border: '#4a3570',
      textPrimary: '#e9d5ff',
      textSecondary: '#c4b5fd',
      textMuted: '#8b7ab8',
      accentPrimary: '#a78bfa',
      accentSecondary: '#f472b6',
      accentWarning: '#fbbf24',
      accentError: '#f87171',
      accentPurple: '#c084fc',
      shadowGlow: '0 0 28px rgba(167, 139, 250, 0.22)',
      shadowCard: '0 8px 32px rgba(26, 16, 37, 0.6)',
      sidebarBg: '#1a1025',
      headerBg: '#1a1025',
      navActiveBg: 'rgba(167, 139, 250, 0.2)',
      navHoverBg: 'rgba(167, 139, 250, 0.08)',
      navBorderAccent: '#a78bfa',
      cardBg: '#2d1f45',
      cardBorder: '#4a3570',
      fontFamily: "'Inter', 'PingFang SC', sans-serif",
      fontWeightNav: 500,
      navStyle: 'pill',
      borderRadius: '14px',
      glowIntensity: '0.22',
      sidebarWidth: '240px',
      separatorColor: '#2d1f45',
      inputBg: '#231735',
    },
  },

  // ===== 翡翠绿 =====
  emerald: {
    name: '💚 翡翠绿',
    subname: '自然清新 · 护眼舒适',
    colors: {
      bgPrimary: '#0f1f17',
      bgSecondary: '#152920',
      bgCard: '#1a3528',
      bgCardHover: '#224535',
      border: '#2d5a45',
      textPrimary: '#d1fae5',
      textSecondary: '#a7f3d0',
      textMuted: '#6ee7b7',
      accentPrimary: '#34d399',
      accentSecondary: '#60a5fa',
      accentWarning: '#fbbf24',
      accentError: '#f87171',
      accentPurple: '#a78bfa',
      shadowGlow: '0 0 24px rgba(52, 211, 153, 0.18)',
      shadowCard: '0 8px 28px rgba(15, 31, 23, 0.6)',
      sidebarBg: '#0f1f17',
      headerBg: '#0f1f17',
      navActiveBg: 'rgba(52, 211, 153, 0.18)',
      navHoverBg: 'rgba(52, 211, 153, 0.06)',
      navBorderAccent: '#34d399',
      cardBg: '#1a3528',
      cardBorder: '#2d5a45',
      fontFamily: "'Inter', 'PingFang SC', sans-serif",
      fontWeightNav: 500,
      navStyle: 'border-left',
      borderRadius: '10px',
      glowIntensity: '0.18',
      sidebarWidth: '240px',
      separatorColor: '#1a3528',
      inputBg: '#152920',
    },
  },

  // ===== 琥珀橙 =====
  amber: {
    name: '🧡 琥珀橙',
    subname: '温暖活力 · 激发灵感',
    colors: {
      bgPrimary: '#1f1710',
      bgSecondary: '#2d2117',
      bgCard: '#3d2d1f',
      bgCardHover: '#4d3a28',
      border: '#5c4530',
      textPrimary: '#fef3c7',
      textSecondary: '#fde68a',
      textMuted: '#fcd34d',
      accentPrimary: '#fbbf24',
      accentSecondary: '#fb923c',
      accentWarning: '#f59e0b',
      accentError: '#f87171',
      accentPurple: '#a78bfa',
      shadowGlow: '0 0 24px rgba(251, 191, 36, 0.2)',
      shadowCard: '0 8px 28px rgba(31, 23, 16, 0.6)',
      sidebarBg: '#1f1710',
      headerBg: '#1f1710',
      navActiveBg: 'rgba(251, 191, 36, 0.2)',
      navHoverBg: 'rgba(251, 191, 36, 0.08)',
      navBorderAccent: '#fbbf24',
      cardBg: '#3d2d1f',
      cardBorder: '#5c4530',
      fontFamily: "'Inter', 'PingFang SC', sans-serif",
      fontWeightNav: 500,
      navStyle: 'pill',
      borderRadius: '12px',
      glowIntensity: '0.2',
      sidebarWidth: '240px',
      separatorColor: '#3d2d1f',
      inputBg: '#2d2117',
    },
  },

  // ===== 玫瑰粉 =====
  rose: {
    name: '💗 玫瑰粉',
    subname: '温柔浪漫 · 时尚优雅',
    colors: {
      bgPrimary: '#1f1520',
      bgSecondary: '#2d1f2e',
      bgCard: '#3d2a3d',
      bgCardHover: '#4d354d',
      border: '#5c405c',
      textPrimary: '#fce7f3',
      textSecondary: '#fbcfe8',
      textMuted: '#f9a8d4',
      accentPrimary: '#f472b6',
      accentSecondary: '#fb7185',
      accentWarning: '#fbbf24',
      accentError: '#f87171',
      accentPurple: '#c084fc',
      shadowGlow: '0 0 24px rgba(244, 114, 182, 0.2)',
      shadowCard: '0 8px 28px rgba(31, 21, 32, 0.6)',
      sidebarBg: '#1f1520',
      headerBg: '#1f1520',
      navActiveBg: 'rgba(244, 114, 182, 0.2)',
      navHoverBg: 'rgba(244, 114, 182, 0.08)',
      navBorderAccent: '#f472b6',
      cardBg: '#3d2a3d',
      cardBorder: '#5c405c',
      fontFamily: "'Inter', 'PingFang SC', sans-serif",
      fontWeightNav: 500,
      navStyle: 'pill',
      borderRadius: '14px',
      glowIntensity: '0.2',
      sidebarWidth: '240px',
      separatorColor: '#3d2a3d',
      inputBg: '#2d1f2e',
    },
  },

  // ===== 清新白 =====
  light: {
    name: '☀️ 清新白',
    subname: '简约明亮 · 清爽体验',
    colors: {
      bgPrimary: '#f8fafc',
      bgSecondary: '#ffffff',
      bgCard: '#ffffff',
      bgCardHover: '#f1f5f9',
      border: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      textMuted: '#94a3b8',
      accentPrimary: '#3b82f6',
      accentSecondary: '#10b981',
      accentWarning: '#f59e0b',
      accentError: '#ef4444',
      accentPurple: '#8b5cf6',
      shadowGlow: '0 2px 12px rgba(59, 130, 246, 0.1)',
      shadowCard: '0 2px 8px rgba(0, 0, 0, 0.08)',
      sidebarBg: '#ffffff',
      headerBg: '#ffffff',
      navActiveBg: 'rgba(59, 130, 246, 0.1)',
      navHoverBg: 'rgba(0, 0, 0, 0.04)',
      navBorderAccent: '#3b82f6',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontWeightNav: 500,
      navStyle: 'pill',
      borderRadius: '8px',
      glowIntensity: '0.1',
      sidebarWidth: '240px',
      separatorColor: '#f1f5f9',
      inputBg: '#f8fafc',
    },
  },

  // ===== 纯黑 OLED =====
  oled: {
    name: '⚫ 纯黑 OLED',
    subname: '极致黑色 · 省电护眼',
    colors: {
      bgPrimary: '#000000',
      bgSecondary: '#0a0a0a',
      bgCard: '#141414',
      bgCardHover: '#1f1f1f',
      border: '#2a2a2a',
      textPrimary: '#ffffff',
      textSecondary: '#a3a3a3',
      textMuted: '#737373',
      accentPrimary: '#60a5fa',
      accentSecondary: '#34d399',
      accentWarning: '#fbbf24',
      accentError: '#f87171',
      accentPurple: '#a78bfa',
      shadowGlow: '0 0 20px rgba(96, 165, 250, 0.15)',
      shadowCard: '0 4px 16px rgba(0, 0, 0, 0.8)',
      sidebarBg: '#000000',
      headerBg: '#000000',
      navActiveBg: 'rgba(96, 165, 250, 0.15)',
      navHoverBg: 'rgba(255, 255, 255, 0.05)',
      cardBg: '#141414',
      cardBorder: '#2a2a2a',
      fontFamily: "'Inter', -apple-system, sans-serif",
      fontWeightNav: 500,
      navStyle: 'fill',
      borderRadius: '6px',
      glowIntensity: '0.15',
      sidebarWidth: '240px',
      inputBg: '#0a0a0a',
    },
  },
};

export const getTheme = (key: string): Theme => themes[key] || themes.dark;

export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  const c = theme.colors;
  const set = (name: string, val: string | undefined) => {
    if (val === undefined) return;

    if (val !== undefined) root.style.setProperty(name, val);
  };
  set('--bg-primary', c.bgPrimary);
  set('--bg-secondary', c.bgSecondary);
  set('--bg-card', c.bgCard || c.bgCardHover);
  set('--bg-card-hover', c.bgCardHover);
  set('--border-color', c.border);
  set('--text-primary', c.textPrimary);
  set('--text-secondary', c.textSecondary);
  set('--text-muted', c.textMuted);
  set('--accent-primary', c.accentPrimary);
  set('--accent-secondary', c.accentSecondary);
  set('--accent-warning', c.accentWarning);
  set('--accent-error', c.accentError);
  set('--accent-purple', c.accentPurple);
  set('--shadow-glow', c.shadowGlow);
  set('--shadow-card', c.shadowCard);
  set('--sidebar-bg', c.sidebarBg);
  set('--header-bg', c.headerBg);
  set('--nav-active-bg', c.navActiveBg);
  set('--nav-hover-bg', c.navHoverBg);
  set('--card-bg', c.cardBg);
  set('--card-border', c.cardBorder);
  set('--font-family', c.fontFamily);
  set('--font-weight-nav', String(c.fontWeightNav || 400));
  set('--nav-style', c.navStyle);
  set('--radius', c.borderRadius);
  set('--glow-intensity', c.glowIntensity);
  set('--sidebar-width', c.sidebarWidth);
  set('--separator-color', c.separatorColor);
  set('--nav-border-accent', c.navBorderAccent);
  set('--input-bg', c.inputBg);
};

export const saveTheme = (key: string) => {
  localStorage.setItem('adb-tools-theme', key);
};

export const loadTheme = (): string => {
  return localStorage.getItem('adb-tools-theme') || 'dark';
};
