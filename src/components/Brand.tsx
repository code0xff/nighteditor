/**
 * 제품 워드마크 — 앱 아이콘 + 이름.
 *
 * 이름은 **한 단어**다. 두 톤으로 쪼개면 `night` 와 `editor` 가 서로 다른 것처럼 읽히고,
 * 저장소 이름·PWA 매니페스트·`<title>` 에 적힌 이름과도 어긋난다.
 * 아이콘을 갈아끼우려면 `@/lib/icons` 의 `APP_ICON` 을 고친다.
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
    <div className="flex items-center gap-2">
      {logo ? (
        <img src={logo} alt="" className="h-7 w-7 rounded-md" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <span className="text-sm font-semibold tracking-tight">{name}</span>
    </div>
  );
}
