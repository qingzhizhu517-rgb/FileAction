import { useEffect } from "react";
import wenqiIcon from "../../../../frontend/wenqi-icon.svg";

export function ProductBrand() {
  return (
    <span className="entry-brand">
      <img className="entry-brand-mark" src={wenqiIcon} alt="" width="40" height="40" />
      <span>
        文启 <span className="entry-brand-en">FileAction</span>
      </span>
    </span>
  );
}

// 静态托管的 SPA 回退入口也只打开同一份完整首页。
export function HomePage() {
  useEffect(() => {
    window.location.replace(
      "/intro/" + window.location.search + window.location.hash,
    );
  }, []);
  return (
    <main className="loading-screen">
      <p role="status">正在打开文启首页…</p>
      <a className="entry-back" href="/intro/">
        进入文启首页
      </a>
    </main>
  );
}
