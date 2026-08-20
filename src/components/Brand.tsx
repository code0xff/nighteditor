/** Product wordmark: the app icon (or an icon tile) + a two-tone name.
 *  Edit the defaults (or pass props) to brand it for your app:
 *    <Brand name="acme" suffix="console" /> renders  [icon] acme console
 *  Icons come from @/lib/icons — swap APP_ICON there, or pass logo={null} to fall back
 *  to the primary tile with a lucide icon. Keep the h-7 w-7 mark + tracking-tight text. */
import { APP_ICON, IconBrand, type LucideIcon } from '@/lib/icons';

export function Brand({
  name = 'app',
  suffix = 'console',
  logo = APP_ICON,
  icon: Icon = IconBrand,
}: {
  name?: string;
  suffix?: string;
  logo?: string | null;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-center gap-2">
      {logo ? (
        <img src={logo} alt="" className="h-7 w-7 rounded-md" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="text-sm font-semibold tracking-tight">
        {name} {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
    </div>
  );
}
