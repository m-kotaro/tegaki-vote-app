// frontend/src/config/runtimeConfig.ts
// 実行時（起動時）に読み込むフロント設定。
//
// API のベース URL はデプロイのたびに変わりうる（API Gateway を作り直すと URL が変わる）。
// ビルド成果物に URL を焼き込むと、デプロイと成果物の不整合で「API に繋がらない」事故が
// 起きる。これを避けるため、URL は成果物に焼き込まず、配信ルートの `/config.json` を
// 起動時に fetch して取得する（config.json は CDK が deploy 時に生成し、正しい API URL を書く）。
//
// 優先順位:
//   1. ビルド時に VITE_API_BASE_URL が指定されていればそれを使う（ローカル開発や明示上書き用）。
//   2. なければ `/config.json` の apiBaseUrl を使う（本番の既定経路）。
//   3. どちらも無ければ空文字（同一オリジン相対）。MSW モック時はこれで Service Worker が捕捉する。

/** 実行時に確定するフロント設定。 */
export interface RuntimeConfig {
  /** API のベース URL。空文字なら同一オリジン相対パスへ発行する。 */
  apiBaseUrl: string;
}

/** CDK が生成する config.json の形。 */
interface ConfigJson {
  apiBaseUrl?: unknown;
}

// 起動時に一度だけ確定し、以降は createVoteApi などが同期参照する。
let current: RuntimeConfig = { apiBaseUrl: "" };

/**
 * `/config.json` を読み込み、実行時設定を確定する。
 * bootstrap（main.tsx）から、アプリのマウント前に一度だけ呼ぶ。
 * ビルド時 VITE_API_BASE_URL があればそれを優先し、fetch はスキップする。
 * fetch に失敗しても throw せず、空文字（同一オリジン相対）へフォールバックする。
 */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  // 1. ビルド時の明示指定を最優先（ローカル開発・明示上書き）。
  const buildTimeBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (typeof buildTimeBaseUrl === "string" && buildTimeBaseUrl.length > 0) {
    current = { apiBaseUrl: buildTimeBaseUrl };
    return current;
  }

  // 2. /config.json を読む（本番の既定経路）。
  try {
    const res = await fetch("/config.json", {
      headers: { Accept: "application/json" },
      cache: "no-cache",
    });
    if (res.ok) {
      const body = (await res.json()) as ConfigJson;
      if (typeof body.apiBaseUrl === "string") {
        current = { apiBaseUrl: body.apiBaseUrl };
        return current;
      }
    }
  } catch {
    // 読めなくても致命的にはしない。空文字（同一オリジン相対）へフォールバック。
  }

  // 3. フォールバック。
  current = { apiBaseUrl: "" };
  return current;
}

/** 確定済みの実行時設定を返す（loadRuntimeConfig 後に参照する）。 */
export function getRuntimeConfig(): RuntimeConfig {
  return current;
}
