export const UI_TOKENS = {
  color: {
    primary: '#16a34a',
    primaryHover: '#15803d',
    text: '#111827',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    bg: '#f8fafc',
    surface: '#ffffff',
    surfaceMuted: '#f1f5f9',
    border: '#e5e7eb',
    borderSoft: '#eef2f7',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#2563eb',
    consoleBg: '#0f172a',
    consoleText: '#d1d5db',
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  shadow: {
    none: 'none',
    soft: '0 8px 24px rgba(15, 23, 42, 0.06)',
    panel: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  fontSize: {
    xs: 12,
    sm: 13,
    md: 14,
    lg: 16,
    xl: 20,
  },
  fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
} as const

export type UiTokens = typeof UI_TOKENS
