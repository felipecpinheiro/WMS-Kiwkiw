import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// Antes do login não existe wms_user, então cai na chave global.
// Mesmo algoritmo replicado em index.html (roda antes do React montar).
function getStorageKey(): string {
  try {
    const raw = localStorage.getItem('wms_user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u && u.id != null) return `wms_theme_${u.id}`;
    }
  } catch {
    // ignore
  }
  return 'wms_theme';
}

function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(getStorageKey());
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);

  // O <script> de index.html já aplicou o atributo antes do mount;
  // isto mantém o estado React em sincronia a cada troca.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Sem escolha explícita salva, segue o Windows (inclusive mudanças ao vivo).
  useEffect(() => {
    let hasExplicitChoice = false;
    try {
      hasExplicitChoice = localStorage.getItem(getStorageKey()) !== null;
    } catch {
      hasExplicitChoice = false;
    }
    if (hasExplicitChoice) return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(getStorageKey(), next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme deve ser usado dentro de ThemeProvider');
  return ctx;
}
