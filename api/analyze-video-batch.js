// /api/analyze-video-batch.js
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getSupabaseForUser(accessToken) {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const accessToken = authHeader.replace("Bearer ", "");
    if (!accessToken) {
      return res.status(401).json({ error: "認証情報がありません" });
    }
    const supabase = getSupabaseForUser(accessToken);

    const { analysisId, batchIndex, frames } = req.body;
    if (!analysisId || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: "analysisId と frames は必須です" });
    }

    const imageBlocks = frames.map((f) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: dataUrlToBase64(f.dataUrl),
      },
    }));

    const timestampLabel = frames.map((f) => `${f.timestamp}秒`).join(", ");

    const prompt = `
これらは卓球の試合動画から${frames.length}枚、時刻(${timestampLabel})でスナップショットとして抽出した静止画です。
連続した映像ではなく、断片的なスナップショットであることに注意してください。

このバッチの画像から読み取れる範囲で、以下の観点を簡潔に箇条書きで述べてください:
- 選手の立ち位置やフォームの傾向(わかる範囲で)
- ボールやラリーの見え方から推測できる特徴(コース、姿勢など)
- 気になる点・弱点として言及できそうな要素

不確かな場合は「推測」であることを明示し、断定的な表現は避けてください。
画像に写っていないことを創作しないでください。
`.trim();

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [...imageBlocks, { type: "text", text: prompt }],
        },
      ],
    });

    const summaryText = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    // RLSにより、自分の video_analyses しか読み書きできない
    const { data: current, error: fetchError } = await supabase
      .from("video_analyses")
      .select("batch_summaries")
      .eq("id", analysisId)
      .single();
    if (fetchError) throw fetchError;

    const updatedSummaries = [
      ...(current.batch_summaries || []),
      { batchIndex, timestamps: frames.map((f) => f.timestamp), summary: summaryText },
    ];

    const { error: updateError } = await supabase
      .from("video_analyses")
      .update({ batch_summaries: updatedSummaries })
      .eq("id", analysisId);
    if (updateError) throw updateError;

    return res.status(200).json({ summary: summaryText });
  } catch (err) {
    console.error("analyze-video-batch error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
