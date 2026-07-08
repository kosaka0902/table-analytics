export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
      const { playerName, oppName, total, wins, serveStats, lengthStats, courseStats, receiveStats } = req.body;

    if (!total) {
      return res.status(400).json({ error: "試合データが必要です" });
    }

    const winRate = Math.round((wins / total) * 100);
    const prompt = `卓球コーチとして以下の試合データを分析してください。
選手:${playerName} vs ${oppName}
総ポイント:${total}, 得点率:${winRate}%

サービスの回転別:${serveStats || "データなし"}
サービスの長さ別:${lengthStats || "データなし"}
コース別:${courseStats || "データなし"}
レシーブの型別:${receiveStats || "データなし"}

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
        max_tokens: 1000,
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
