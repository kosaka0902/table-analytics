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
