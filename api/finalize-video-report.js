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

    const { analysisId, profile, selfDescription } = req.body;
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

    let profileSection = "選手プロフィール情報なし";
    if (profile) {
      const lines = [];
      if (profile.nickname) lines.push(`ニックネーム: ${profile.nickname}`);
      if (profile.age) lines.push(`年齢: ${profile.age}歳`);
      if (profile.dominant_hand) lines.push(`利き手: ${profile.dominant_hand}`);
      if (profile.racket_type) lines.push(`ラケット種類: ${profile.racket_type}`);
      if (profile.forehand_rubber_type) lines.push(`フォアラバー種類: ${profile.forehand_rubber_type}`);
      if (profile.backhand_rubber_type) lines.push(`バックラバー種類: ${profile.backhand_rubber_type}`);
      if (profile.play_style) lines.push(`プレースタイル: ${profile.play_style}`);
      if (profile.racket_name) lines.push(`ラケット名: ${profile.racket_name}`);
      if (profile.forehand_rubber_name) lines.push(`フォアラバー名: ${profile.forehand_rubber_name}`);
      if (profile.backhand_rubber_name) lines.push(`バックラバー名: ${profile.backhand_rubber_name}`);
      if (profile.years_playing) lines.push(`卓球歴: ${profile.years_playing}`);
      if (profile.skill_level) lines.push(`実力レベル: ${profile.skill_level}`);
      if (lines.length > 0) profileSection = lines.join("\n");
    }

    const selfNote = selfDescription
      ? `分析対象の選手は「${selfDescription}」として指定されています。区間ごとの所見は、この指定をもとに判断された内容です。`
      : "分析対象の選手の見分け方(服装など)は指定されていません。区間ごとの所見は、一般的な観察に基づくものです。";

    const prompt = `卓球コーチとして、以下の選手プロフィールと試合動画の分析所見をもとにレポートを作成してください。

【選手プロフィール】
${profileSection}

【自分の見分け方】
${selfNote}

【動画分析の前提】
以下は、卓球の試合動画から断続的に抽出したスナップショット(合計${analysis.frame_count}枚)を
時系列の区間ごとに分析した所見です。1点ごとの正確な分析ではなく、断続的なスナップショットに基づく
推測であることを踏まえてください。

【区間ごとの所見】
${combinedNotes}

選手プロフィール(利き手・ラケット/ラバーの種類・プレースタイル・卓球歴・実力レベルなど)を踏まえて、
その選手の特性に合った、より的確なアドバイスを意識してください。
例えば初心者と上級者では指摘すべきポイントの深さを変え、プレースタイルに合わない戦術を提案しないようにしてください。

【注意事項】
- これは断続的なスナップショットに基づく推測であり、1点ごとの正確な分析ではないことを、
  レポートの冒頭で簡潔に触れてください。
- 断定的すぎる表現は避け、「〜の傾向が見られます」「〜の可能性があります」といった
  控えめな言い回しを使ってください。

以下の4項目で日本語レポートを作成してください(AI試合レポートと同じ形式です):
1. 試合全体の評価
2. 得点パターン分析(見て取れる範囲での傾向)
3. 弱点・改善ポイント3つ
4. 次の練習への提案3つ`;

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
