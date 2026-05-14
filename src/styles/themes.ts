// Theme configuration - 5 high-quality themes optimized for ADB debugging tool

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
  // ===== 深邃黑暗 · 默认 =====
  dark: {
    name: '🌙 深邃黑暗',
    subname: '高对比 · 护眼沉浸',
    colors: {
      bgPrimary: '#0b0e14',
      bgSecondary: '#11161e',
      bgCard: '#171d28',
      bgCardHover: '#1e2635',
      border: '#252d3b',
      textPrimary: '#e6edf3',
      textSecondary: '#8b949e',
      textMuted: '#545d68',
      accentPrimary: '#58a6ff',
      accentSecondary: '#3fb950',
      accentWarning: '#d29922',
      accentError: '#f85149',
      accentPurple: '#a371f7',
      shadowGlow: '0 0 20px rgba(88, 166, 255, 0.15)',
      shadowCard: '0 4px 16px rgba(0, 0, 0, 0.5)',
      sidebarBg: '#0b0e14',
      headerBg: '#0b0e14',
      navActiveBg: 'rgba(88, 166, 255, 0.15)',
      navHoverBg: 'rgba(255, 255, 255, 0.04)',
      navBorderAccent: '#58a6ff',
      cardBg: '#171d28',
      cardBorder: '#252d3b',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeightNav: 500,
      navStyle: 'border-left',
      borderRadius: '10px',
      glowIntensity: '0.15',
      sidebarWidth: '220px',
      separatorColor: '#1a2233',
      inputBg: '#11161e',
    },
  },

  // ===== 日光白 · 清爽正式 =====
  light: {
    name: '☀️ 日光白',
    subname: '明亮干净 · 长时间不累',
    colors: {
      bgPrimary: '#f6f8fa',
      bgSecondary: '#ffffff',
      bgCard: '#ffffff',
      bgCardHover: '#f0f3f6',
      border: '#d8dee4',
      textPrimary: '#1a1e24',
      textSecondary: '#57606a',
      textMuted: '#8c959f',
      accentPrimary: '#0550ae',
      accentSecondary: '#1a7f37',
      accentWarning: '#9a6700',
      accentError: '#cf222e',
      accentPurple: '#8250df',
      shadowGlow: '0 2px 12px rgba(5, 80, 174, 0.10)',
      shadowCard: '0 1px 3px rgba(31, 35, 40, 0.08)',
      sidebarBg: '#f6f8fa',
      headerBg: '#ffffff',
      navActiveBg: 'rgba(5, 80, 174, 0.08)',
      navHoverBg: 'rgba(31, 35, 40, 0.04)',
      navBorderAccent: '#0550ae',
      cardBg: '#ffffff',
      cardBorder: '#d8dee4',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeightNav: 500,
      navStyle: 'underline',
      borderRadius: '10px',
      glowIntensity: '0.10',
      sidebarWidth: '220px',
      separatorColor: '#eaeef2',
      inputBg: '#f6f8fa',
    },
  },

  // ===== 深海蓝 · 沉稳专业 =====
  ocean: {
    name: '🌊 深海蓝',
    subname: '冷色 · 专注编码',
    colors: {
      bgPrimary: '#060d19',
      bgSecondary: '#0c1526',
      bgCard: '#111d36',
      bgCardHover: '#162649',
      border: '#1a3360',
      textPrimary: '#d6e4ff',
      textSecondary: '#7fa2d4',
      textMuted: '#4a6a9e',
      accentPrimary: '#4dabf7',
      accentSecondary: '#20c997',
      accentWarning: '#fcc419',
      accentError: '#ff6b6b',
      accentPurple: '#9775fa',
      shadowGlow: '0 0 24px rgba(77, 171, 247, 0.18)',
      shadowCard: '0 6px 20px rgba(0, 0, 0, 0.55)',
      sidebarBg: '#060d19',
      headerBg: '#060d19',
      navActiveBg: 'rgba(77, 171, 247, 0.15)',
      navHoverBg: 'rgba(77, 171, 247, 0.06)',
      navBorderAccent: '#4dabf7',
      cardBg: '#111d36',
      cardBorder: '#1a3360',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeightNav: 500,
      navStyle: 'fill',
      borderRadius: '10px',
      glowIntensity: '0.18',
      sidebarWidth: '220px',
      separatorColor: '#152040',
      inputBg: '#0c1526',
    },
  },

  // ===== 琥珀金 · 温暖活力 =====
  amber: {
    name: '🧡 琥珀金',
    subname: '暖色 · 缓解视觉疲劳',
    colors: {
      bgPrimary: '#1c1410',
      bgSecondary: '#261d18',
      bgCard: '#302520',
      bgCardHover: '#3d302a',
      border: '#4a3c34',
      textPrimary: '#f5e6d8',
      textSecondary: '#c4a98a',
      textMuted: '#8b705a',
      accentPrimary: '#f0a050',
      accentSecondary: '#4db380',
      accentWarning: '#e8c040',
      accentError: '#e05555',
      accentPurple: '#b080d0',
      shadowGlow: '0 0 22px rgba(240, 160, 80, 0.18)',
      shadowCard: '0 6px 20px rgba(28, 20, 16, 0.55)',
      sidebarBg: '#1c1410',
      headerBg: '#1c1410',
      navActiveBg: 'rgba(240, 160, 80, 0.15)',
      navHoverBg: 'rgba(240, 160, 80, 0.06)',
      navBorderAccent: '#f0a050',
      cardBg: '#302520',
      cardBorder: '#4a3c34',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeightNav: 500,
      navStyle: 'pill',
      borderRadius: '10px',
      glowIntensity: '0.18',
      sidebarWidth: '220px',
      separatorColor: '#302520',
      inputBg: '#261d18',
    },
  },

  // ===== 森林绿 · 自然舒适 =====
  forest: {
    name: '🌿 森林绿',
    subname: '护眼 · 低蓝光柔和',
    colors: {
      bgPrimary: '#0d1a12',
      bgSecondary: '#13241a',
      bgCard: '#1a2e22',
      bgCardHover: '#223b2c',
      border: '#2a4a36',
      textPrimary: '#d8eddf',
      textSecondary: '#8bbf9e',
      textMuted: '#5a8a68',
      accentPrimary: '#4ade80',
      accentSecondary: '#2dd4bf',
      accentWarning: '#facc15',
      accentError: '#f87171',
      accentPurple: '#a78bfa',
      shadowGlow: '0 0 20px rgba(74, 222, 128, 0.16)',
      shadowCard: '0 5px 18px rgba(13, 26, 18, 0.55)',
      sidebarBg: '#0d1a12',
      headerBg: '#0d1a12',
      navActiveBg: 'rgba(74, 222, 128, 0.12)',
      navHoverBg: 'rgba(74, 222, 128, 0.05)',
      navBorderAccent: '#4ade80',
      cardBg: '#1a2e22',
      cardBorder: '#2a4a36',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      fontWeightNav: 500,
      navStyle: 'border-left',
      borderRadius: '10px',
      glowIntensity: '0.16',
      sidebarWidth: '220px',
      separatorColor: '#1a2e22',
      inputBg: '#13241a',
    },
  },
};

export const LIGHT_THEMES = ['light'] as const;

export const isLightTheme = (key: string): boolean =>
  (LIGHT_THEMES as readonly string[]).includes(key);

export const getTheme = (key: string): Theme => themes[key] || themes.dark;

export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  const c = theme.colors;
  const set = (name: string, val: string | undefined) => {
    if (val === undefined) return;
    root.style.setProperty(name, val);
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
  const saved = localStorage.getItem('adb-tools-theme');
  // Migrate old theme keys to new system
  const migrationMap: Record<string, string> = {
    oled: 'dark',
    pure: 'light',
    midnight: 'dark',
    aurora: 'ocean',
    ember: 'amber',
    dark: 'dark',
    light: 'light',
    space: 'dark',
  };
  if (saved && migrationMap[saved]) {
    return migrationMap[saved];
  }
  if (saved && !themes[saved]) {
    return 'light';
  }
  return saved || 'light';
};
