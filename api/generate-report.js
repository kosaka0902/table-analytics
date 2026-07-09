// /api/generate-report.js
// ブラウザからではなく、サーバー側でAnthropic APIキーを使ってAIレポートを生成する。
// これにより、APIキーがブラウザ(誰でも見れる場所)に露出しなくなる。
// 選手プロフィール情報も踏まえて、より的確なアドバイスを生成する。

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { playerName, oppName, total, wins, serveStats, lengthStats, courseStats, receiveStats, profile } = req.body;

    if (!total) {
      return res.status(400).json({ error: "試合データが必要です" });
    }

    const winRate = Math.round((wins / total) * 100);

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

    const prompt = `卓球コーチとして以下の選手データ・試合データを分析してください。

【選手プロフィール】
${profileSection}

【試合データ】
選手:${playerName} vs ${oppName}
総ポイント:${total}, 得点率:${winRate}%

サービスの回転別:${serveStats || "データなし"}
サービスの長さ別:${lengthStats || "データなし"}
コース別:${courseStats || "データなし"}
レシーブの型別:${receiveStats || "データなし"}

選手プロフィール(利き手・ラケット/ラバーの種類・プレースタイル・卓球歴・実力レベルなど)を踏まえて、
その選手の特性に合った、より的確なアドバイスを意識してください。
例えば初心者と上級者では指摘すべきポイントの深さを変え、プレースタイルに合わない戦術を提案しないようにしてください。

以下の4項目で日本語レポートを作成:
1. 試合全体の評価
2. 得点パターン分析(サービス・コース・レシーブそれぞれの傾向に触れる)
3. 弱点・改善ポイント3つ
4. 次の練習への提案3つ`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${errText}`);
    }

    const data = await response.json();
    const report = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return res.status(200).json({ report });
  } catch (err) {
    console.error("generate-report error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}
