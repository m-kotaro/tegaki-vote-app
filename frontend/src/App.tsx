// frontend/src/App.tsx
// アプリのルーティング定義。BrowserRouter でルーターをマウントし、以下のルートを提供する。
//   - `/`        → 投票ページ（VotePage: 投票フロー全体）
//   - `/results` → 開票結果ページ（ResultsPage: Requirement 9 want）
//   - `/invalid` → 無効票詳細ページ（InvalidVotesPage: Requirement 12 want）
//
// 投票フロー本体は VotePage へ切り出した。App はページ間のルーティングのみを担う。
// BrowserRouter を用いるが、/results での直リロードは dev（Vite）の SPA フォールバック、
// 本番は CloudFront の 403/404 → index.html フォールバックで解決するため特別な対応は不要。

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { VotePage } from "./pages/VotePage.js";
import { ResultsPage } from "./pages/ResultsPage.js";
import { InvalidVotesPage } from "./pages/InvalidVotesPage.js";

export function App(): React.JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<VotePage />} />
        <Route path="/results" element={<ResultsPage />} />
        <Route path="/invalid" element={<InvalidVotesPage />} />
      </Routes>
    </BrowserRouter>
  );
}
