/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** バックエンド API のベース URL（例: https://api.example.com）。未設定時は同一オリジン相対パス。 */
  readonly VITE_API_BASE_URL?: string;
  /** "true" のとき MSW モックワーカーを有効化する。dev では既定で有効。 */
  readonly VITE_ENABLE_MOCKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
