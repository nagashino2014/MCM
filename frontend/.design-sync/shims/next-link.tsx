// design-sync 번들 전용 대체 모듈. next/link 는 Next 런타임(process.env.__NEXT_*·라우터)이 없는
// 브라우저 단독 번들에서 평가 단계에 실패한다. 디자인·미리보기에서는 같은 <a> 마크업을 내는 이 모듈로 바꾼다.
// 앱 빌드에는 쓰이지 않는다(.design-sync/tsconfig.bundle.json 의 paths 로만 연결).
import { forwardRef, type AnchorHTMLAttributes } from "react";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, prefetch, replace, scroll, ...rest }, ref) {
  void prefetch; void replace; void scroll;
  return <a ref={ref} href={typeof href === "string" ? href : href?.pathname ?? "#"} {...rest} />;
});

export default Link;
