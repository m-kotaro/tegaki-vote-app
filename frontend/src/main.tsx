// frontend/src/main.tsx
// エントリポイント。dev（または VITE_ENABLE_MOCKS=true）時は MSW モックワーカーを起動してから
// アプリをマウントする。これにより backend 未起動でも frontend を単体起動できる。

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

async function enableMocksIfNeeded(): Promise<void> {
  const explicit = import.meta.env.VITE_ENABLE_MOCKS;
  // 明示指定があればそれに従い、なければ dev のみモックを有効化する。
  const useMocks = explicit === undefined ? import.meta.env.DEV : explicit === "true";
  if (!useMocks) return;

  const { startMockWorker } = await import("./mocks/browser.js");
  await startMockWorker();
}

async function bootstrap(): Promise<void> {
  await enableMocksIfNeeded();

  const container = document.getElementById("root");
  if (container === null) {
    throw new Error("#root 要素が見つかりません");
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
