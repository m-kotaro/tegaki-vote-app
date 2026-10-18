// frontend/src/pages/InvalidVotesPage.tsx
// 無効票詳細ページ（ルート `/invalid`, Requirement 12 want）。運営者エリア。
//
// マウント時にアクティブ開票回（getActiveElection().election_id）の票レコード一覧を
// GET /elections/{election_id}/results（VoteApi.getResults）で取得し、フロント側の純粋関数
// selectInvalidVotes(votes) で is_valid=false の票を抽出して詳細を一覧表示する。
// 抽出は Backend では行わない（design Components / Frontend InvalidVotesView + selectInvalidVotes）。
//
// 表示項目（Req 12.1〜12.3）:
//   - アクティブ開票回のタイトル
//   - 各無効票の vote_id・recognized_text（null は「判読不能」表示, Req 12.2）・reason・created_at
//   - 無効票が 0 件のときは「無効票はありません」（Req 12.3）
// 運営者エリア間の相互遷移として /results へのリンクを表示する（Req 12.5）。
// 投票ページ（/）へのリンクは持たない（Req 12.6）。
// 通信失敗時はエラーメッセージ、取得中はローディング表示を出す（ResultsPage と同じパターン）。
//
// _Requirements: 12.1, 12.2, 12.3, 12.5, 12.7, 9.1_

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Election, VoteRecordSummary } from "@tegaki/shared";
import { getActiveElection } from "../config/elections.js";
import { createVoteApi } from "../api/index.js";
import { selectInvalidVotes } from "../logic/invalidVotes.js";
import {
  ErrorNotice,
  apiFailureToErrorKind,
  type ErrorKind,
} from "../components/ErrorNotice.js";

/** 結果取得の状態。 */
type Status = "loading" | "loaded" | "error";

/** results 取得のタイムアウト（ミリ秒）。ハード通信タイムアウトに合わせる。 */
const RESULTS_TIMEOUT_MS = 35_000;

export function InvalidVotesPage(): React.JSX.Element {
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
  const [invalidVotes, setInvalidVotes] = useState<VoteRecordSummary[]>([]);
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
          // 票レコード一覧から無効票のみをフロント側で抽出する（Req 12.1）。
          setInvalidVotes(selectInvalidVotes(res.data.votes));
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

  const title = activeElection?.title ?? "無効票詳細";
  const hasInvalid = invalidVotes.length > 0;

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
      <h1>無効票詳細</h1>

      <h2 style={{ marginBottom: "0.5rem" }}>{title}</h2>

      {/* 運営者エリア間の相互遷移リンク（Req 12.5）。投票ページ（/）へのリンクは持たない（Req 12.6）。 */}
      <p style={{ margin: "0 0 1rem" }}>
        <Link to="/results">← 開票結果を見る</Link>
      </p>

      {/* ローディング表示。 */}
      {status === "loading" && (
        <p aria-live="polite" style={{ color: "#555" }}>
          集計中...
        </p>
      )}

      {/* 取得失敗時のエラー表示（既存 ErrorNotice を流用）。 */}
      {status === "error" && <ErrorNotice kind={errorKind} />}

      {/* 無効票の詳細一覧（Req 12.1〜12.3）。 */}
      {status === "loaded" && (
        <section aria-label="無効票詳細">
          {hasInvalid ? (
            <table
              style={{
                borderCollapse: "collapse",
                width: "100%",
              }}
            >
              <thead>
                <tr>
                  <th style={thStyle}>vote_id</th>
                  <th style={thStyle}>手書き画像</th>
                  <th style={thStyle}>読み取りテキスト</th>
                  <th style={thStyle}>理由</th>
                  <th style={thStyle}>登録日時</th>
                </tr>
              </thead>
              <tbody>
                {invalidVotes.map((vote) => (
                  <tr key={vote.vote_id}>
                    <td style={tdStyle}>{vote.vote_id}</td>
                    {/* 当該投票の手書き画像（Req 12.8）。null / 読み込み失敗時はプレースホルダ（Req 12.9）。 */}
                    <td style={tdStyle}>
                      <InvalidVoteImage
                        imageUrl={vote.image_url}
                        voteId={vote.vote_id}
                      />
                    </td>
                    <td style={tdStyle}>
                      {/* recognized_text が null（判読不能）のときはその旨を表示（Req 12.2）。 */}
                      {vote.recognized_text === null ? (
                        <span style={{ color: "#888" }}>判読不能</span>
                      ) : (
                        vote.recognized_text
                      )}
                    </td>
                    {/* reason などの判定詳細を運営者向けに表示する（Req 12.7）。 */}
                    <td style={tdStyle}>{vote.reason}</td>
                    <td style={tdStyle}>{vote.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // 無効票が 1 件もないときの表示（Req 12.3）。
            <p style={{ color: "#555" }}>無効票はありません</p>
          )}
        </section>
      )}
    </main>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ccc",
  padding: "0.4rem 0.6rem",
};

const tdStyle: React.CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: "0.4rem 0.6rem",
  verticalAlign: "top",
};

/**
 * 無効票 1 行分の手書き画像セル（Req 12.8 / 12.9）。
 * - image_url が非 null なら pre-signed URL を `<img src={image_url}>` で表示する（Req 12.8）。
 * - image_url が null、または `<img>` の読み込みに失敗（onError）した場合は
 *   「画像なし」プレースホルダを表示する（Req 12.9）。読み込み失敗は行ごとの useState で管理する。
 */
function InvalidVoteImage({
  imageUrl,
  voteId,
}: {
  imageUrl: string | null;
  voteId: string;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  // URL が無い（presign 失敗など）か、読み込みに失敗したときはプレースホルダ（Req 12.9）。
  if (imageUrl === null || failed) {
    return (
      <div style={imagePlaceholderStyle} aria-label="画像なし">
        画像なし
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={`手書き画像 (${voteId})`}
      style={imageStyle}
      onError={() => setFailed(true)}
    />
  );
}

const imageStyle: React.CSSProperties = {
  width: 150,
  height: "auto",
  objectFit: "contain",
  border: "1px solid #ddd",
  display: "block",
};

const imagePlaceholderStyle: React.CSSProperties = {
  width: 150,
  minHeight: 60,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px dashed #ccc",
  color: "#888",
  fontSize: "0.85rem",
  boxSizing: "border-box",
};
