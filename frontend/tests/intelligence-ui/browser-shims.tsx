import type { ReactNode } from "react";
export function useSession() { return { data: { user: { id: "u1", name: "테스트 담당자", perms: ["sales.view@all", "sales.edit@all", "facility.edit@all", "scraper.manage@all"] } }, status: "authenticated" }; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
export function usePathname() { return window.location.pathname; }
export function useRouter() { return { push: (url: string) => window.location.assign(url), refresh() {}, replace: (url: string) => window.history.replaceState(null, "", url) }; }
export default function Link({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) { return <a href={href} {...props}>{children}</a>; }
