// /api/finalize-video-report.js
import { createClient } from "@supabase/supabase-js";

function getSupabaseForUser(accessToken) {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
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

    const { analysisId } = req.body;
    if (!analysisId) {
      return res.status(400).json({ error: "analysisId は必須です" });
    }

    const { data: analysis, error: fetchError } = await supabase
      .from("video_analyses")
      .select("batch_summaries, frame_count")
      .eq("id", analysisId)
      .single();
    if (fetchError) throw fetchError;

    const sortedSummaries = [...(analysis.batch_summaries || [])].sort(
      (a, b) => a.batchIndex - b.batchIndex
    );

    const combinedNotes = sortedSummaries
      .map(
        (s, i) =>
          `--- 区間${i + 1}(${s.timestamps.join("秒, ")}秒付近) ---\n${s.summary}`
      )
      .join("\n\n");

    const prompt = `
以下は、卓球の試合動画から断続的に抽出したスナップショット(合計${analysis.frame_count}枚)を
時系列の区間ごとに分析した所見です。これらを踏まえて、試合全体を通じた傾向・特徴・
気になる点(弱点になりうる部分)を、選手へのフィードバックとして読みやすい形にまとめてください。

【注意事項】
- これは断続的なスナップショットに基づく推測であり、1点ごとの正確な分析ではないことを
  読者が理解できるよう、レポートの冒頭で簡潔に触れてください。
- 個々の区間の所見を単純に並べるのではなく、試合全体を通じた傾向として統合してください。
- 断定的すぎる表現は避け、「〜の傾向が見られます」「〜の可能性があります」といった
  控えめな言い回しを使ってください。

【区間ごとの所見】
${combinedNotes}
`.trim();

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      throw new Error(`Anthropic API error: ${errText}`);
    }

    const data = await anthropicRes.json();
    const report = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    const { error: updateError } = await supabase
      .from("video_analyses")
      .update({ report, status: "completed" })
      .eq("id", analysisId);
    if (updateError) throw updateError;

    return res.status(200).json({ report });
  } catch (err) {
    console.error("finalize-video-report error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
