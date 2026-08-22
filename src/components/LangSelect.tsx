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
      <SelectTrigger className="w-auto gap-1.5" aria-label={label} title={label}>
        <IconLanguage className="h-3.5 w-3.5 opacity-70" />
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
