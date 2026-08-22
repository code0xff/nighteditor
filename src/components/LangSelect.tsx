/** UI language picker. Each name in the list is written in its own language (`LOCALE_LABEL`). */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { IconLanguage } from '@/lib/icons';
import { isLocale, LOCALES, LOCALE_LABEL } from '@/lib/messages';
import { useI18n, useLocale } from '@/store/locale';

export function LangSelect() {
  const { locale, t } = useI18n();
  const setLocale = useLocale((s) => s.setLocale);
  const label = t('locale.select');

  return (
    <Select
      value={locale}
      onValueChange={(value) => {
        // The select hands back a string. Unsupported values are simply ignored.
        if (isLocale(value)) setLocale(value);
      }}
    >
      {/* Until `lg` only the icon is left. The chosen language is still
          visible — it is the language everything on screen is written in.
          The `!` is needed: the trigger's own `[&>span]:line-clamp-1` sets a
          display of its own, and without it that rule wins over `hidden`. */}
      <SelectTrigger
        className="w-auto min-w-8 touch:min-w-10 justify-center gap-1.5 px-2 [&>span]:!hidden [&>svg:last-child]:hidden lg:justify-between lg:px-2.5 lg:[&>span]:!block lg:[&>svg:last-child]:block"
        aria-label={label}
        title={label}
      >
        <IconLanguage className="h-3.5 w-3.5 shrink-0 opacity-70 touch:h-4 touch:w-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((item) => (
          <SelectItem key={item} value={item}>
            {LOCALE_LABEL[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
