import { useState, useCallback, useRef } from "react";
import { supabase } from "./supabaseClient";

const MAX_FRAMES = 40;
const BATCH_SIZE = 8;
const FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.7;
const SEEK_TIMEOUT_MS = 8000;
const FALLBACK_INTERVAL_SEC = 30;

async function detectAudioPeaks(videoFile) {
  const arrayBuffer = await videoFile.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  let audioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }

  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const windowSize = Math.floor(sampleRate * 0.02);

  const energies = [];
  for (let i = 0; i < channelData.length; i += windowSize) {
    let sum = 0;
    const end = Math.min(i + windowSize, channelData.length);
    for (let j = i; j < end; j++) sum += channelData[j] * channelData[j];
    energies.push({ time: i / sampleRate, energy: Math.sqrt(sum / (end - i)) });
  }

  const values = energies.map((e) => e.energy);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const threshold = mean + std * 2.2;

  const minGapSec = 0.35;
  const peaks = [];
  let lastPeakTime = -Infinity;
  for (let i = 1; i < energies.length - 1; i++) {
    const cur = energies[i];
    if (
      cur.energy > threshold &&
      cur.energy >= energies[i - 1].energy &&
      cur.energy >= energies[i + 1].energy &&
      cur.time - lastPeakTime > minGapSec
    ) {
      peaks.push({ time: cur.time, energy: cur.energy });
      lastPeakTime = cur.time;
    }
  }
  return peaks;
}

function selectCandidates(peaks, duration, maxFrames) {
  if (peaks.length <= maxFrames) return peaks.map((p) => p.time);

  const bucketCount = maxFrames;
  const bucketDuration = duration / bucketCount;
  const selected = [];
  for (let b = 0; b < bucketCount; b++) {
    const bucketStart = b * bucketDuration;
    const bucketEnd = bucketStart + bucketDuration;
    const inBucket = peaks.filter((p) => p.time >= bucketStart && p.time < bucketEnd);
    if (inBucket.length === 0) continue;
    const strongest = inBucket.reduce((a, b2) => (a.energy > b2.energy ? a : b2));
    selected.push(strongest.time);
  }
  return selected;
}

async function hasMotionAt(video, canvas, ctx, time, duration) {
  const t1 = Math.max(0, Math.min(time, duration - 0.2));
  const t2 = Math.min(duration - 0.05, t1 + 0.15);

  const grab = async (t) => {
    await safeSeek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };

  const frame1 = await grab(t1);
  const frame2 = await grab(t2);

  let diff = 0;
  for (let i = 0; i < frame1.length; i += 4) {
    diff += Math.abs(frame1[i] - frame2[i]);
  }
  const avgDiff = diff / (frame1.length / 4);
  return avgDiff > 3;
}

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

async function extractFrames(videoFile, onPhaseChange) {
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

  const cleanup = () => {
    URL.revokeObjectURL(video.src);
    if (video.parentNode) video.parentNode.removeChild(video);
  };

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("動画の読み込みに失敗しました。別の動画形式(mp4推奨)でお試しください"));
    });

    const duration = await resolveDuration(video);
    const ratio = (video.videoHeight && video.videoWidth) ? video.videoHeight / video.videoWidth : 0.5625;
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round(FRAME_WIDTH * ratio);
    const ctx = canvas.getContext("2d");

    onPhaseChange("detecting");
    let timestamps = [];
    try {
      const peaks = await detectAudioPeaks(videoFile);
      const candidates = selectCandidates(peaks, duration, MAX_FRAMES * 2);

      const smallCanvas = document.createElement("canvas");
      smallCanvas.width = 64;
      smallCanvas.height = Math.round(64 * ratio);
      const smallCtx = smallCanvas.getContext("2d");

      const confirmed = [];
      for (const t of candidates) {
        try {
          const moving = await hasMotionAt(video, smallCanvas, smallCtx, t, duration);
          if (moving) confirmed.push(t);
        } catch (e) {
          // スキップ
        }
        if (confirmed.length >= MAX_FRAMES) break;
      }
      timestamps = confirmed.sort((a, b) => a - b);
    } catch (e) {
      console.warn("音声解析に失敗、等間隔サンプリングにフォールバックします", e);
    }

    if (timestamps.length < 5) {
      timestamps = [];
      for (let t = 0; t < duration && timestamps.length < MAX_FRAMES; t += FALLBACK_INTERVAL_SEC) {
        timestamps.push(t);
      }
      if (timestamps.length === 0) timestamps.push(0);
    }

    onPhaseChange("extracting");
    const frames = [];
    for (const t of timestamps) {
      const target = Math.min(t, Math.max(duration - 0.1, 0));
      await safeSeek(video, target);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      frames.push({ timestamp: Math.round(t), dataUrl });
    }

    cleanup();
    return frames;
  } catch (err) {
    cleanup();
    throw err;
  }
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default function VideoAnalysis({ matchId, userId, accessToken, profile }) {
  const [videoFile, setVideoFile] = useState(null);
  const [selfDescription, setSelfDescription] = useState("");
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [report, setReport] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [extractedFrames, setExtractedFrames] = useState([]);
  const analysisIdRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
      setReport(null);
      setErrorMessage(null);
      setPhase("idle");
      setExtractedFrames([]);
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

      const frames = await extractFrames(videoFile, setPhase);
      setExtractedFrames(frames);
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
        body: JSON.stringify({ analysisId: analysisRow.id, profile, selfDescription }),
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
  }, [videoFile, matchId, userId, accessToken, profile, selfDescription]);

  return (
    <div style={{ background: "#f9f9f8", borderRadius: 10, padding: 14, marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        ※ 音と動きから打球タイミングを自動検出して分析します(ベータ機能・完全な精度ではありません)
      </div>

      {phase === "idle" && (
        <>
          <input type="file" accept="video/*" onChange={handleFileChange} style={{ fontSize: 12 }} />
          {videoFile && (
            <>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                  動画の中で、どちらが自分か教えてください(例:「手前側です」「黒いシャツです」)
                </div>
                <input
                  type="text"
                  value={selfDescription}
                  onChange={(e) => setSelfDescription(e.target.value)}
                  placeholder="例: 手前側、黒いシャツを着ている方"
                  style={{ width: "100%", padding: "7px 10px", fontSize: 13, border: "0.5px solid #ccc", borderRadius: 6 }}
                />
              </div>
              <button onClick={runAnalysis} style={{ marginTop: 10, width: "100%", padding: 9, background: "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
                分析を開始
              </button>
            </>
          )}
        </>
      )}

      {phase === "uploading" && <p style={{ fontSize: 13, color: "#666" }}>動画をアップロード中...</p>}
      {phase === "detecting" && <p style={{ fontSize: 13, color: "#666" }}>打球タイミングを検出中...</p>}
      {phase === "extracting" && <p style={{ fontSize: 13, color: "#666" }}>フレームを抽出中...</p>}
      {phase === "analyzing" && (
        <p style={{ fontSize: 13, color: "#666" }}>
          AIが分析中... ({progress.current}/{progress.total})
        </p>
      )}
      {phase === "error" && <p style={{ fontSize: 13, color: "#A32D2D" }}>エラー: {errorMessage}</p>}

      {extractedFrames.length > 0 && (phase === "analyzing" || phase === "done") && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "#666" }}>
            抽出されたスナップショット({extractedFrames.length}枚)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {extractedFrames.map((f, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img
                  src={f.dataUrl}
                  alt={`${f.timestamp}秒`}
                  style={{ width: 90, borderRadius: 4, border: "1px solid #ddd", display: "block" }}
                />
                <span style={{ position: "absolute", bottom: 2, right: 2, fontSize: 9, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "1px 4px", borderRadius: 3 }}>
                  {f.timestamp}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === "done" && report && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>分析レポート</div>
          <p style={{ fontSize: 13, color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{report}</p>
        </div>
      )}
    </div>
  );
}
