// frontend/src/mocks/browser.ts
// ブラウザ用 MSW Service Worker のセットアップ。
// main.tsx から dev（または VITE_ENABLE_MOCKS=true）時のみ起動する。

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

export const worker = setupWorker(...handlers);

/**
 * モックワーカーを起動する。public/mockServiceWorker.js が配信されている必要がある
 * （`npx msw init public` で生成 / package.json の msw.workerDirectory で管理）。
 */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    // 未定義のリクエストはそのまま通す（実 backend への切り替えを妨げない）。
    onUnhandledRequest: "bypass",
    quiet: false,
  });
}
