"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import { useHotkeys } from "react-hotkeys-hook";
import { Sun, Moon, MonitorPlay } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const cycle = () => {
    setTheme(theme === "light" ? "dark" : theme === "dark" ? "system" : "light");
  };

  useHotkeys("mod+shift+l", cycle, { preventDefault: true }, [theme]);

  // Durante a hidratação inicial, usa o estado do servidor (system) para evitar hydration mismatch.
  const displayTheme = mounted ? theme : "system";
  const Icon = displayTheme === "dark" ? Moon : displayTheme === "system" ? MonitorPlay : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Tema: ${displayTheme}. Cmd+Shift+L para alternar.`}
      suppressHydrationWarning
    >
      <Icon size={16} aria-hidden />
    </Button>
  );
}
