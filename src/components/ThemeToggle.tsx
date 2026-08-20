/** Day/night theme toggle button (persists to localStorage via useTheme). */
import { Button } from '@/components/ui/button';
import { IconThemeDark, IconThemeLight } from '@/lib/icons';
import { useTheme } from '@/lib/theme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
    >
      {theme === 'dark' ? (
        <IconThemeLight className="h-4 w-4" />
      ) : (
        <IconThemeDark className="h-4 w-4" />
      )}
    </Button>
  );
}
