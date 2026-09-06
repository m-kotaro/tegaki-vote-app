// frontend/src/pages/VotePage.tsx
// 投票ページ（ルート `/`）。従来 App.tsx が持っていた投票フロー全体を切り出したもの。
// アクティブ開票回の固定表示・Canvas・投票ボタン・投票アニメ・開票中表示・結果表示・
// エラー表示を組み合わせ、投票送信の状態遷移を実装する。
//
// 開票回は投票者が選択せず、管理者が Elections_Config の activeElectionId で指定した
// アクティブ開票回を getActiveElection() で確定し ActiveElectionBanner で固定表示する（Req 2）。
// 投票時は election_id に ACTIVE_ELECTION_ID を用いる（Req 2.3 / 3.3）。
// activeElectionId が不整合な設定不正で getActiveElection() が例外を投げた場合は、
// 受付停止フォールバック（「現在、投票を受け付けていません」・投票ボタン無効）にする（Req 2.4）。
//
// 状態遷移（design の Components / Frontend「投票送信フロー」「開票回選択の状態遷移」に準拠）:
//   phase: "idle" | "counting" | "result"
//   - idle:     入力受付中。結果/エラーは直前の表示を保持する（Req 11.5）。
//   - counting: 応答待機中。CountingIndicator「開票中...」表示・投票ボタン無効化・アニメ再生（Req 3.4 / 3.5）。
//   - result:   200 応答受信後。ResultView を表示（Req 3.8 / 7.2〜7.4）。
//
// タイムアウトの二段構え（design Error Handling のタイムアウト値表）:
//   - 35 秒: ハード通信タイムアウト。ApiCallOptions.timeoutMs で HttpVoteApi の AbortController に配線（Req 8.5）。
//   - 10 秒: 成功応答期限。10 秒以内に成功応答が来なければ失敗表示に倒す（Req 3.7 / 11.5）。
//            AbortController で進行中リクエストも中断する。
//
// _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 2.4, 2.5, 7.2〜7.4, 8.4, 8.5, 11.5_

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Election, VoteResult } from "@tegaki/shared";
import { ACTIVE_ELECTION_ID, getActiveElection } from "../config/elections.js";
import { createVoteApi } from "../api/index.js";
import {
  CanvasComponent,
  type CanvasComponentHandle,
} from "../components/CanvasComponent.js";
import { ActiveElectionBanner } from "../components/ActiveElectionBanner.js";
import { VoteButton } from "../components/VoteButton.js";
import { VoteAnimation } from "../components/VoteAnimation.js";
import { CountingIndicator } from "../components/CountingIndicator.js";
import { ResultView } from "../components/ResultView.js";
import {
  ErrorNotice,
  apiFailureToErrorKind,
  type ErrorKind,
} from "../components/ErrorNotice.js";

/** 投票送信フローの状態。 */
type Phase = "idle" | "counting" | "result";

/** ハード通信タイムアウト（ミリ秒, Req 8.5）。 */
const HARD_TIMEOUT_MS = 35_000;
/** 成功応答期限（ミリ秒, Req 3.7 / 11.5）。この期限で失敗表示へ倒す。 */
const SUCCESS_DEADLINE_MS = 10_000;

const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 220;
const CANVAS_LINE_WIDTH = 4;

export function VotePage(): React.JSX.Element {
  // API クライアントは差し替え可能なインターフェース越しに取得する（モック/実 backend 共通）。
  const api = useMemo(() => createVoteApi(), []);

  const canvasRef = useRef<CanvasComponentHandle | null>(null);

  // アクティブ開票回を確定する（Req 2.1 / 2.2）。activeElectionId が Elections に無い設定不正で
  // 例外が投げられた場合は null とし、受付停止フォールバックへ倒す（Req 2.4）。
  // 通常はビルド時の設定検証で弾かれるが、実行時ガードとして持つ。
  const activeElection = useMemo<Election | null>(() => {
    try {
      return getActiveElection();
    } catch {
      return null;
    }
  }, []);
  const isAccepting = activeElection !== null;

  // 投票送信フローの状態。
  const [phase, setPhase] = useState<Phase>("idle");
  // 直近の判定結果。result フェーズで表示し、以降も直前表示として保持する（Req 11.5）。
  const [result, setResult] = useState<VoteResult | null>(null);
  // 表示中のエラー種別。null はエラーなし。
  // 受付停止（設定不正）時は初期表示から NOT_ACCEPTING を出す（Req 2.4）。
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(
    isAccepting ? null : "NOT_ACCEPTING",
  );

  // 進行中リクエストの中断用。10 秒期限超過時に abort する。
  const abortRef = useRef<AbortController | null>(null);
  // 成功応答期限（10 秒）タイマー。
  const deadlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 送信ごとに採番し、遅延して返ってきた古い応答を無視する（期限超過後の後着対策）。
  const requestSeqRef = useRef<number>(0);

  const clearDeadlineTimer = useCallback((): void => {
    if (deadlineTimerRef.current !== null) {
      clearTimeout(deadlineTimerRef.current);
      deadlineTimerRef.current = null;
    }
  }, []);

  // アンマウント時に進行中のタイマー/リクエストを後始末する。
  useEffect(() => {
    return () => {
      clearDeadlineTimer();
      abortRef.current?.abort();
    };
  }, [clearDeadlineTimer]);

  const handleClearCanvas = useCallback((): void => {
    canvasRef.current?.clear();
  }, []);

  const handleVote = useCallback((): void => {
    // 送信中は多重送信させない（ボタンは disabled だが念のためガード）。
    if (phase === "counting") {
      return;
    }

    // ガード 1: 受付停止中（activeElectionId 設定不正）は送信しない（Req 2.4）。
    if (!isAccepting || activeElection === null) {
      setErrorKind("NOT_ACCEPTING");
      return;
    }

    // ガード 2: Canvas が空なら送信せず手書きを促す（Req 1.6 / 3.6）。
    const canvas = canvasRef.current;
    if (canvas === null || canvas.isEmpty()) {
      setErrorKind("INPUT_EMPTY");
      return;
    }

    // 画像取得（Req 1.5 / 3.2）。未入力でないことは上で確認済みだが null 安全に扱う。
    const image = canvas.toPngBase64();
    if (image === null) {
      setErrorKind("INPUT_EMPTY");
      return;
    }

    // 送信開始: counting へ遷移し、アニメ開始・ボタン無効化・開票中表示（Req 3.4 / 3.5）。
    const seq = ++requestSeqRef.current;
    setErrorKind(null);
    setPhase("counting");

    const controller = new AbortController();
    abortRef.current = controller;

    // 成功応答期限（10 秒）。超過したら進行中リクエストを中断し失敗表示へ（Req 3.7 / 11.5）。
    clearDeadlineTimer();
    deadlineTimerRef.current = setTimeout(() => {
      if (requestSeqRef.current !== seq) {
        return;
      }
      controller.abort();
      setErrorKind("TIMEOUT");
      // 直前表示（result）は保持したまま idle に戻し、ボタンを再有効化する（Req 11.5）。
      setPhase("idle");
    }, SUCCESS_DEADLINE_MS);

    // 送信。ハードタイムアウト 35 秒を timeoutMs で HttpVoteApi の AbortController に配線（Req 8.5）。
    // アクティブ開票回の Candidate_List を candidates として同送する（Req 2.4 / 3.3）。
    void api
      .submitVote(
        {
          image,
          election_id: ACTIVE_ELECTION_ID,
          candidates: activeElection.candidates.map((c) => ({
            id: c.id,
            name: c.name,
          })),
        },
        { timeoutMs: HARD_TIMEOUT_MS, signal: controller.signal },
      )
      .then((res) => {
        // 期限超過後に後着した古い応答は無視する。
        if (requestSeqRef.current !== seq) {
          return;
        }
        clearDeadlineTimer();

        if (res.ok) {
          // 200 成功 → counting 終了 → 結果表示（Req 3.8 / 7.2〜7.4）。
          setResult(res.data);
          setErrorKind(null);
          setPhase("result");
          return;
        }

        // エラー応答/タイムアウト → ErrorKind へ変換して表示、ボタン再有効化、直前表示は保持（Req 8.4 / 11.5）。
        setErrorKind(apiFailureToErrorKind(res));
        setPhase(result !== null ? "result" : "idle");
      })
      .catch(() => {
        if (requestSeqRef.current !== seq) {
          return;
        }
        clearDeadlineTimer();
        setErrorKind("NETWORK");
        setPhase(result !== null ? "result" : "idle");
      });
  }, [api, activeElection, clearDeadlineTimer, isAccepting, phase, result]);

  const isCounting = phase === "counting";

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: "1.5rem",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1>手書き投票デモ</h1>
      <p>候補者名を手書きして「投票」してください。</p>


      {/* アクティブ開票回の固定表示（Req 2.1 / 2.2）。設定不正で受付停止中は表示しない（Req 2.4）。 */}
      {activeElection !== null && <ActiveElectionBanner election={activeElection} />}

      {/* 手書き入力（Req 1.x）。 */}
      <section aria-label="手書き入力">
        <h2>手書き入力</h2>
        <CanvasComponent
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          lineWidth={CANVAS_LINE_WIDTH}
        />
        <div style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={handleClearCanvas}
            disabled={isCounting}
            aria-label="消去"
            data-testid="clear-button"
            style={{
              appearance: "none",
              border: "1px solid #999",
              borderRadius: 6,
              padding: "0.4rem 1rem",
              background: "#fff",
              cursor: isCounting ? "not-allowed" : "pointer",
            }}
          >
            消去
          </button>
        </div>
      </section>

      {/* 投票操作（Req 3.1 / 3.5）。受付停止中（設定不正）は無効化する（Req 2.4）。 */}
      <section aria-label="投票" style={{ marginTop: "1rem" }}>
        <VoteButton onClick={handleVote} disabled={isCounting || !isAccepting} />
      </section>

      {/* 投票アニメ（Req 3.4）。送信と同時に active=true で即再生開始。 */}
      <VoteAnimation active={isCounting} />

      {/* 開票中表示（Req 3.5）。 */}
      <CountingIndicator active={isCounting} />

      {/* エラー表示（Req 8.4 / 11.5）。counting 中は隠し、それ以外で表示。 */}
      {!isCounting && <ErrorNotice kind={errorKind} />}

      {/* 結果表示（Req 3.8 / 7.2〜7.4）。直前結果は idle でも保持表示する（Req 11.5）。 */}
      {!isCounting && result !== null && <ResultView result={result} />}
    </main>
  );
}
