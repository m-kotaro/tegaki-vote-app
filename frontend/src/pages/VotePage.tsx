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
import { EraseAnimation } from "../components/EraseAnimation.js";
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
/**
 * 投票アニメの最低表示時間（ミリ秒）。VoteAnimation の投函アニメ長に合わせる。
 * API 送信とアニメを並列で走らせ、API が早く成功してもこの時間までは結果表示へ進めず、
 * 「投票した感」を保証する。API がこれより遅ければ API 完了時に結果へ進む（遅い方に合わせる）。
 */
const MIN_ANIMATION_MS = 2_000;

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
  // 消去アニメーション再生中フラグ。消しゴムの往復中は true。
  // 実際の canvas クリアはアニメ完了（onDone）で行う。
  const [isErasing, setIsErasing] = useState<boolean>(false);

  // 進行中リクエストの中断用。10 秒期限超過時に abort する。
  const abortRef = useRef<AbortController | null>(null);
  // 成功応答期限（10 秒）タイマー。
  const deadlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最低アニメ表示時間を満たすための遅延タイマー（API が早く成功したとき用）。
  const minAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // counting 開始時刻。最低アニメ時間の残りを算出するために使う。
  const countingStartRef = useRef<number>(0);
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
      if (minAnimTimerRef.current !== null) {
        clearTimeout(minAnimTimerRef.current);
        minAnimTimerRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [clearDeadlineTimer]);

  // 消去ボタン押下: 消しゴムの往復アニメを開始する。実際のクリアは完了時（handleEraseDone）。
  // 応答待機中・既に消去中は無視。空の canvas でも無視（消すものがない）。
  const handleClearCanvas = useCallback((): void => {
    if (phase === "counting" || isErasing) {
      return;
    }
    if (canvasRef.current?.isEmpty() ?? true) {
      return;
    }
    setIsErasing(true);
  }, [phase, isErasing]);

  // 消しゴム位置ごとに canvas を実際に削る（案B: destination-out で徐々に消す）。
  const handleErase = useCallback(
    (x: number, y: number, radius: number, strength: number): void => {
      canvasRef.current?.eraseAt(x, y, radius, strength);
    },
    [],
  );

  // 消去アニメ完了: 削り残しがないよう最終クリアし、消去中フラグを下ろす。
  const handleEraseDone = useCallback((): void => {
    canvasRef.current?.clear();
    setIsErasing(false);
  }, []);

  const handleVote = useCallback((): void => {
    // 送信中・消去アニメ中は送信させない（ボタンは disabled だが念のためガード）。
    // 消去途中の中途半端な画像で投票が飛ぶのを防ぐ。
    if (phase === "counting" || isErasing) {
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
    // API 送信とアニメを並列開始する。最低アニメ時間の残り算出のため開始時刻を記録し、
    // 前回の最低アニメ待機タイマーが残っていれば破棄する。
    countingStartRef.current = Date.now();
    if (minAnimTimerRef.current !== null) {
      clearTimeout(minAnimTimerRef.current);
      minAnimTimerRef.current = null;
    }

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
      // 入力画面（idle）へ戻して手書きを続けられるようにする。直前の完了表示は消し、
      // エラー（TIMEOUT）のみを提示する。
      setResult(null);
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
          // 200 成功 → 結果表示（Req 3.8 / 7.2〜7.4）。
          // ただし API がアニメより早く成功したときは、最低アニメ時間まで counting を維持し
          // 「投票した感」を保証する（並列: 遅い方に合わせる）。残り時間だけ遅延して確定する。
          const data = res.data;
          const commitResult = (): void => {
            // 遅延中に新しい送信が始まっていたら、この確定は破棄する。
            if (requestSeqRef.current !== seq) {
              return;
            }
            // 次の投票に備えて手書き内容を消去する。
            canvasRef.current?.clear();
            setResult(data);
            setErrorKind(null);
            setPhase("result");
          };

          const elapsed = Date.now() - countingStartRef.current;
          const remaining = MIN_ANIMATION_MS - elapsed;
          if (remaining > 0) {
            minAnimTimerRef.current = setTimeout(commitResult, remaining);
          } else {
            commitResult();
          }
          return;
        }

        // エラー応答/タイムアウト → ErrorKind へ変換して表示、入力画面（idle）へ戻して再入力を促す。
        // result フェーズでは canvas を隠す設計のため、エラー時は idle に倒し、手書きを続けられるようにする。
        // 直前の完了表示（ResultView）は消し、エラーのみを提示する。
        setErrorKind(apiFailureToErrorKind(res));
        setResult(null);
        setPhase("idle");
      })
      .catch(() => {
        if (requestSeqRef.current !== seq) {
          return;
        }
        clearDeadlineTimer();
        setErrorKind("NETWORK");
        setResult(null);
        setPhase("idle");
      });
  }, [api, activeElection, clearDeadlineTimer, isAccepting, phase, isErasing]);

  const isCounting = phase === "counting";
  // 投票完了画面（result フェーズ）では入力エリア（canvas・投票ボタン）を隠し、
  // 「投票されました」と「もう一度投票する」だけを見せる。
  const isResult = phase === "result";

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
      <h1>投票</h1>


      {/* アクティブ開票回の固定表示（Req 2.1 / 2.2）。設定不正で受付停止中は表示しない（Req 2.4）。 */}
      {activeElection !== null && <ActiveElectionBanner election={activeElection} />}

      {/* 手書き入力（Req 1.x）。投票完了（result）フェーズと投票中（counting）は隠す。
          投票中は手書きを隠して投票アニメーションを主役にする。 */}
      {!isResult && !isCounting && (
        <section aria-label="手書き入力">
          <h2>選択肢を書いてください</h2>
          {/* canvas と消しゴムアニメを重ねるため relative コンテナで包む。
              消去中は canvas を薄くフェードし、消しゴムの往復で「消えていく」様子を演出する。 */}
          <div
            style={{
              position: "relative",
              display: "inline-block",
              lineHeight: 0,
            }}
          >
            <CanvasComponent
              ref={canvasRef}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              lineWidth={CANVAS_LINE_WIDTH}
            />
            <EraseAnimation
              active={isErasing}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              onErase={handleErase}
              onDone={handleEraseDone}
            />
          </div>
          <div style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              onClick={handleClearCanvas}
              disabled={isCounting || isErasing}
              aria-label="消す"
              data-testid="clear-button"
              style={{
                appearance: "none",
                border: "1px solid #999",
                borderRadius: 6,
                padding: "0.4rem 1rem",
                background: "#fff",
                cursor: isCounting || isErasing ? "not-allowed" : "pointer",
              }}
            >
              消す
            </button>
          </div>
        </section>
      )}

      {/* 投票操作（Req 3.1 / 3.5）。受付停止中（設定不正）は無効化する（Req 2.4）。
          投票完了（result）フェーズでは隠す。 */}
      {!isResult && (
        <section aria-label="投票" style={{ marginTop: "1rem" }}>
          <VoteButton
            onClick={handleVote}
            disabled={isCounting || isErasing || !isAccepting}
            counting={isCounting}
          />
        </section>
      )}

      {/* 投票アニメ（Req 3.4）。送信と同時に active=true で即再生開始。 */}
      <VoteAnimation active={isCounting} />

      {/* 応答待機中の表示は VoteButton のラベル（「投票中...」）に統合した。
          下に別要素を出さないことでレイアウト高さを一定に保つ。 */}

      {/* エラー表示（Req 8.4 / 11.5）。counting 中は隠し、それ以外で表示。 */}
      {!isCounting && <ErrorNotice kind={errorKind} />}

      {/* 結果表示（Req 3.8 / 7.2〜7.4）。直前結果は idle でも保持表示する（Req 11.5）。 */}
      {!isCounting && result !== null && <ResultView result={result} />}
    </main>
  );
}
