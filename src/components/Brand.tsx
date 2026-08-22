/**
 * The product wordmark — app icon + name.
 *
 * The name is **one word**. Split into two tones, `night` and `editor` read as
 * separate things, and it diverges from the name in the repository, the PWA
 * manifest, and the `<title>`.
 * To swap the icon, change `APP_ICON` in `@/lib/icons`.
 */
import { APP_ICON, IconBrand, type LucideIcon } from '@/lib/icons';

export function Brand({
  name = 'nighteditor',
  logo = APP_ICON,
  icon: Icon = IconBrand,
}: {
  name?: string;
  logo?: string | null;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {logo ? (
        <img src={logo} alt="" className="h-7 w-7 rounded-md" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      {/* On a narrow screen the mark alone carries the identity. The name is the
          first thing to go — everything beside it is something you act with. */}
      <span className="hidden text-sm font-semibold tracking-tight sm:inline">{name}</span>
    </div>
  );
}
