/** Day/night theme toggle button (persists to localStorage via useTheme). */
import { Button } from '@/components/ui/button';
import { IconThemeDark, IconThemeLight } from '@/lib/icons';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/store/locale';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const label = t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={label} title={label}>
      {theme === 'dark' ? (
        <IconThemeLight className="h-4 w-4" />
      ) : (
        <IconThemeDark className="h-4 w-4" />
      )}
    </Button>
  );
}
