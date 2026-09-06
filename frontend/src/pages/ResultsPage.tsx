// frontend/src/pages/ResultsPage.tsx
// 開票結果ページ（ルート `/results`, Requirement 9 want）。
//
// マウント時にアクティブ開票回（getActiveElection().election_id）の票レコード一覧を
// GET /elections/{election_id}/results（VoteApi.getResults）で取得し、フロント側の純粋関数
// tally(votes, electionId) で集計して表示する。集計は Backend では行わない
// （design Components / Frontend ResultsView + tally, API 契約）。
//
// 表示項目（Req 9.3〜9.5）:
//   - アクティブ開票回のタイトル
//   - 総投票数 total / 有効票数 valid / 無効票数 invalid（total = valid + invalid, Req 9.3）
//   - 候補者ごとの得票数（得票数降順, Req 9.4）
//   - 票が 0 件のときは空表示
// 通信失敗時はエラーメッセージ、取得中はローディング表示を出す（design 通信失敗系）。
//
// _Requirements: 9.1, 9.3, 9.4, 9.5_

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Election, ElectionResults } from "@tegaki/shared";
import { getActiveElection } from "../config/elections.js";
import { createVoteApi } from "../api/index.js";
import { tally } from "../logic/tally.js";
import { ErrorNotice, apiFailureToErrorKind, type ErrorKind } from "../components/ErrorNotice.js";

/** 結果取得の状態。 */
type Status = "loading" | "loaded" | "error";

/** results 取得のタイムアウト（ミリ秒）。ハード通信タイムアウトに合わせる。 */
const RESULTS_TIMEOUT_MS = 35_000;

export function ResultsPage(): React.JSX.Element {
  const api = useMemo(() => createVoteApi(), []);

  // アクティブ開票回を確定する。設定不正で例外が投げられた場合は null。
  const activeElection = useMemo<Election | null>(() => {
    try {
      return getActiveElection();
    } catch {
      return null;
    }
  }, []);

  const [status, setStatus] = useState<Status>("loading");
  const [results, setResults] = useState<ElectionResults | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  useEffect(() => {
    // 設定不正で開票回が確定できない場合はエラー表示に倒す。
    if (activeElection === null) {
      setStatus("error");
      setErrorKind("CONFIG_INVALID");
      return;
    }

    const electionId = activeElection.election_id;
    const controller = new AbortController();
    let cancelled = false;

    setStatus("loading");
    setErrorKind(null);

    void api
      .getResults(electionId, {
        timeoutMs: RESULTS_TIMEOUT_MS,
        signal: controller.signal,
      })
      .then((res) => {
        if (cancelled) {
          return;
        }
        if (res.ok) {
          // 票レコード一覧をフロント側で集計する（Req 9.3〜9.5）。
          setResults(tally(res.data.votes, electionId));
          setStatus("loaded");
          return;
        }
        setErrorKind(apiFailureToErrorKind(res));
        setStatus("error");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setErrorKind("NETWORK");
        setStatus("error");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [api, activeElection]);

  const title = activeElection?.title ?? "開票結果";
  const hasVotes = results !== null && results.total > 0;

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1.5rem",
        maxWidth: 720,
        margin: "0 auto",
        backgroundColor: "#ffffff",
      }}
    >
      <h1>開票結果</h1>

      <h2 style={{ marginBottom: "0.5rem" }}>{title}</h2>

      {/* 運営者エリア間の相互遷移リンク（Req 12.4）。投票ページ（/）へのリンクは追加しない（Req 12.6）。 */}
      <p style={{ margin: "0 0 1rem" }}>
        <Link to="/invalid">無効票を見る →</Link>
      </p>

      {/* ローディング表示。 */}
      {status === "loading" && (
        <p aria-live="polite" style={{ color: "#555" }}>
          集計中...
        </p>
      )}

      {/* 取得失敗時のエラー表示（既存 ErrorNotice を流用）。 */}
      {status === "error" && <ErrorNotice kind={errorKind} />}

      {/* 集計結果表示（Req 9.3〜9.5）。 */}
      {status === "loaded" && results !== null && (
        <section aria-label="開票結果">
          {/* 総数・有効・無効の集計（Req 9.3）。 */}
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 1rem",
              display: "flex",
              gap: "1.5rem",
            }}
          >
            <li>
              総投票数: <strong>{results.total}</strong>
            </li>
            <li>
              有効票数: <strong>{results.valid}</strong>
            </li>
            <li>
              無効票数: <strong>{results.invalid}</strong>
            </li>
          </ul>

          {/* 候補者ごとの得票数（得票数降順, Req 9.4）。 */}
          {hasVotes ? (
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
                maxWidth: 480,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid #ccc",
                      padding: "0.4rem 0.6rem",
                    }}
                  >
                    候補者
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      borderBottom: "1px solid #ccc",
                      padding: "0.4rem 0.6rem",
                    }}
                  >
                    得票数
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.tally.map((row) => (
                  <tr key={row.candidate}>
                    <td
                      style={{
                        borderBottom: "1px solid #eee",
                        padding: "0.4rem 0.6rem",
                      }}
                    >
                      {row.candidate}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        borderBottom: "1px solid #eee",
                        padding: "0.4rem 0.6rem",
                      }}
                    >
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // 票が 0 件のときの空表示。
            <p style={{ color: "#555" }}>まだ投票がありません</p>
          )}
        </section>
      )}
    </main>
  );
}
