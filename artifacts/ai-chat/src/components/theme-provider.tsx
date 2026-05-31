import { createContext, useContext, useEffect, useState } from "react";

export type AppTheme = "light" | "dark" | "amoled" | "night-yellow" | "system";

const ALL_THEME_CLASSES: AppTheme[] = ["light", "dark", "amoled", "night-yellow"];
const STORAGE_KEY = "app-theme";

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: AppTheme;
  storageKey?: string;
}

function resolveTheme(theme: AppTheme): Exclude<AppTheme, "system"> {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = STORAGE_KEY,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<AppTheme>(
    () => (localStorage.getItem(storageKey) as AppTheme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;
    ALL_THEME_CLASSES.forEach((cls) => root.classList.remove(cls));
    const resolved = resolveTheme(theme);
    root.classList.add(resolved);
  }, [theme]);

  const setTheme = (newTheme: AppTheme) => {
    localStorage.setItem(storageKey, newTheme);
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div {...props}>{children}</div>
    </ThemeContext.Provider>
  );
}
