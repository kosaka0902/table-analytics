import { useState, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

const FRAME_INTERVAL_SEC = 30;
const MAX_FRAMES = 40;
const BATCH_SIZE = 8;
const FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;
const SEEK_TIMEOUT_MS = 8000;

function safeSeek(video, time) {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new Error(`フレーム取得がタイムアウトしました(${t}秒付近)`));
    }, SEEK_TIMEOUT_MS);
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = t;
    } catch (e) {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      reject(new Error("動画の時間指定に失敗しました"));
    }
  });
}

function resolveDuration(video) {
  return new Promise((resolve) => {
    const initial = video.duration;
    if (Number.isFinite(initial) && initial > 0) {
      resolve(initial);
      return;
    }
    // 一部の動画ファイルで duration が Infinity/NaN になる問題への対処
    const onTimeUpdate = () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      finish();
    };
    const finish = () => {
      const d = video.duration;
      try { video.currentTime = 0; } catch (e) {}
      resolve(Number.isFinite(d) && d > 0 ? d : 60);
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    try {
      video.currentTime = 1e10;
    } catch (e) {
      finish();
      return;
    }
    setTimeout(finish, 2000);
  });
}

function extractFrames(videoFile, { intervalSec = FRAME_INTERVAL_SEC, maxFrames = MAX_FRAMES } = {}) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.style.position = "fixed";
    video.style.top = "-9999px";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);
    video.src = URL.createObjectURL(videoFile);

    const canvas = document.createElement("canvas");

    const cleanup = () => {
      URL.revokeObjectURL(video.src);
      if (video.parentNode) video.parentNode.removeChild(video);
    };

    video.onloadedmetadata = async () => {
      try {
        const duration = await resolveDuration(video);

        const ratio = (video.videoHeight && video.videoWidth) ? video.videoHeight / video.videoWidth : 0.5625;
        canvas.width = FRAME_WIDTH;
        canvas.height = Math.round(FRAME_WIDTH * ratio);
        const ctx = canvas.getContext("2d");

        const timestamps = [];
        for (let t = 0; t < duration && timestamps.length < maxFrames; t += intervalSec) {
          timestamps.push(t);
        }
        if (timestamps.length === 0) timestamps.push(0);

        const frames = [];
        for (const t of timestamps) {
          const target = Math.min(t, Math.max(duration - 0.1, 0));
          await safeSeek(video, target);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
          frames.push({ timestamp: Math.round(t), dataUrl });
        }

        cleanup();
        resolve(frames);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    video.onerror = () => {
      cleanup();
      reject(new Error("動画の読み込みに失敗しました。別の動画形式(mp4推奨)でお試しください"));
    };
  });
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default function VideoAnalysis({ matchId, userId, accessToken }) {
  const [videoFile, setVideoFile] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [report, setReport] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const analysisIdRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setReport(null);
      setErrorMessage(null);
      setPhase("idle");
    }
  };

  const runAnalysis = useCallback(async () => {
    if (!videoFile) return;
    try {
      setPhase("uploading");
      const videoPath = `${userId}/${matchId}/${Date.now()}_${videoFile.name}`;

      const { data: analysisRow, error: insertError } = await supabase
        .from("video_analyses")
        .insert({ match_id: matchId, user_id: userId, video_path: videoPath, status: "uploading" })
        .select()
        .single();
      if (insertError) throw insertError;
      analysisIdRef.current = analysisRow.id;

      const { error: uploadError } = await supabase.storage
        .from("match-videos")
        .upload(videoPath, videoFile, { upsert: false });
      if (uploadError) throw uploadError;

      setPhase("extracting");
      const frames = await extractFrames(videoFile);
      await supabase
        .from("video_analyses")
        .update({ frame_count: frames.length, status: "analyzing" })
        .eq("id", analysisRow.id);

      setPhase("analyzing");
      const batches = chunkArray(frames, BATCH_SIZE);
      setProgress({ current: 0, total: batches.length + 1 });

      for (let i = 0; i < batches.length; i++) {
        const res = await fetch("/api/analyze-video-batch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            analysisId: analysisRow.id,
            batchIndex: i,
            frames: batches[i],
          }),
        });
        if (!res.ok) throw new Error(`バッチ${i}の解析に失敗しました`);
        setProgress((p) => ({ ...p, current: i + 1 }));
      }

      const finalRes = await fetch("/api/finalize-video-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ analysisId: analysisRow.id }),
      });
      if (!finalRes.ok) throw new Error("最終レポートの生成に失敗しました");
      const { report: finalReport } = await finalRes.json();

      setProgress((p) => ({ ...p, current: batches.length + 1 }));
      setReport(finalReport);
      setPhase("done");
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || "不明なエラーが発生しました");
      setPhase("error");
      if (analysisIdRef.current) {
        await supabase
          .from("video_analyses")
          .update({ status: "failed", error_message: err.message })
          .eq("id", analysisIdRef.current);
      }
    }
  }, [videoFile, matchId, userId, accessToken]);

  return (
    <div style={{ background: "#f9f9f8", borderRadius: 10, padding: 14, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        ※ 一定間隔のスナップショットから傾向を推定するAI分析です(ベータ機能)
      </div>

      {phase === "idle" && (
        <>
          <input type="file" accept="video/*" onChange={handleFileChange} style={{ fontSize: 12 }} />
          {videoFile && (
            <button onClick={runAnalysis} style={{ marginTop: 10, width: "100%", padding: 9, background: "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
              分析を開始
            </button>
          )}
        </>
      )}

      {phase === "uploading" && <p style={{ fontSize: 13, color: "#666" }}>動画をアップロード中...</p>}
      {phase === "extracting" && <p style={{ fontSize: 13, color: "#666" }}>フレームを抽出中...</p>}
      {phase === "analyzing" && (
        <p style={{ fontSize: 13, color: "#666" }}>
          AIが分析中... ({progress.current}/{progress.total})
        </p>
      )}
      {phase === "error" && <p style={{ fontSize: 13, color: "#A32D2D" }}>エラー: {errorMessage}</p>}

      {phase === "done" && report && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>分析レポート</div>
          <p style={{ fontSize: 13, color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{report}</p>
        </div>
      )}
    </div>
  );
}
