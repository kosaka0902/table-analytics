import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";

const SERVE_TYPES = ["下回転", "横回転", "ナックル", "上回転", "巻き込み"];
const COURSES = ["フォア前", "フォア深", "ミドル", "バック前", "バック深"];
const RECEIVES = ["ツッツキ", "フリック", "チキータ", "ストップ", "ループ"];
const SERVE_COLORS = { 下回転: "#1D9E75", 横回転: "#378ADD", ナックル: "#EF9F27", 上回転: "#E24B4A", 巻き込み: "#7F77DD" };

function PillGroup({ items, selected, onSelect, colorMap }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
      {items.map((item) => {
        const isSelected = selected === item;
        const color = colorMap?.[item] || "#1D9E75";
        return (
          <button key={item} onClick={() => onSelect(item)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 13, border: isSelected ? `1.5px solid ${color}` : "0.5px solid #ccc", background: isSelected ? color + "22" : "#fff", color: isSelected ? color : "#666", fontWeight: isSelected ? 500 : 400, cursor: "pointer" }}>
            {item}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: "#f4f4f2", borderRadius: 8, padding: "14px 12px" }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, color: "#1a1a18", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function App() {
  // ---- 認証まわりの状態 ----
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  // ---- 既存の試合記録まわりの状態 ----
  const [tab, setTab] = useState("record");
  const [myScore, setMyScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [setNum, setSetNum] = useState(1);
  const [serve, setServe] = useState(null);
  const [course, setCourse] = useState(null);
  const [receive, setReceive] = useState(null);
  const [rallies, setRallies] = useState([]);
  const [playerName, setPlayerName] = useState("自分");
  const [oppName, setOppName] = useState("相手選手");
  const [aiReport, setAiReport] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const reportRef = useRef();

  const recordRally = useCallback((win) => {
    if (!serve || !course || !receive) { alert("サービス・コース・レシーブをすべて選択してください"); return; }
    const rally = { id: Date.now(), rallyNum: rallies.length + 1, serve, course, receive, win };
    setRallies((prev) => [rally, ...prev]);
    if (win) setMyScore((s) => s + 1); else setOppScore((s) => s + 1);
    const newMy = win ? myScore + 1 : myScore;
    const newOpp = win ? oppScore : oppScore + 1;
    if (newMy >= 11 && newMy - newOpp >= 2) { setTimeout(() => { alert(`セット${setNum}終了！`); setSetNum((n) => n + 1); setMyScore(0); setOppScore(0); }, 100); }
    supabase.from("rallies").insert({
      player_name: playerName,
      opp_name: oppName,
      serve_type: serve,
      course: course,
      receive: receive,
      win: win,
      set_num: setNum,
      user_id: session?.user?.id,
    }).then(({ error }) => { if (error) console.error(error); });
    setServe(null); setCourse(null); setReceive(null);
  }, [serve, course, receive, rallies, myScore, oppScore, setNum, session]);

  const generateAiReport = async () => {
    const total = rallies.length;
    if (total === 0) { alert("記録がまだありません"); return; }
    const wins = rallies.filter((r) => r.win).length;
    const serveStats = SERVE_TYPES.map((s) => { const rs = rallies.filter((r) => r.serve === s); return rs.length ? `${s}: ${rs.length}球, 得点率${Math.round(rs.filter((r) => r.win).length / rs.length * 100)}%` : null; }).filter(Boolean).join(", ");
    const prompt = `卓球コーチとして以下の試合データを分析してください。\n選手:${playerName} vs ${oppName}\n総ポイント:${total}, 得点率:${Math.round(wins / total * 100)}%\nサービス別:${serveStats}\n\n以下の4項目で日本語レポートを作成:\n1. 試合全体の評価\n2. 得点パターン分析\n3. 弱点・改善ポイント3つ\n4. 次の練習への提案3つ`;
    setAiLoading(true); setAiReport("");
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, stream: true, messages: [{ role: "user", content: prompt }] }),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try { const json = JSON.parse(data); if (json.type === "content_block_delta" && json.delta?.text) { setAiReport((prev) => prev + json.delta.text); } } catch (_) {}
          }
        }
      }
    } catch (err) { setAiReport("エラーが発生しました: " + err.message); }
    finally { setAiLoading(false); }
  };

  const serveData = SERVE_TYPES.map((s, i) => { const rs = rallies.filter((r) => r.serve === s); return { label: s, total: rs.length, value: rs.length ? Math.round(rs.filter((r) => r.win).length / rs.length * 100) : 0, color: Object.values(SERVE_COLORS)[i] }; }).filter((d) => d.total > 0);

  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "sans-serif", color: "#666" }}>
        読み込み中...
      </div>
    );
  }

  if (!session) {
    return <Auth />;
  }

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 600, margin: "0 auto", background: "#f4f4f2", minHeight: "100vh" }}>
      <style>{`.tab{background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#666;border-bottom:2px solid transparent;} .tab.active{color:#1D9E75;border-bottom-color:#1D9E75;font-weight:500;} .rbtn{cursor:pointer;font-size:15px;font-weight:500;border-radius:8px;padding:12px;display:flex;align-items:center;justify-content:center;gap:8px;border:none;width:100%;}`}</style>
      <div style={{ background: "#fff", borderBottom: "0.5px solid #ddd", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#1D9E75", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 18 }}>🏓</div>
          <span style={{ fontSize: 16, fontWeight: 500 }}>TableAnalytics</span>
        </div>
        <span style={{ fontSize: 12, background: "#E1F5EE", color: "#0F6E56", padding: "3px 10px", borderRadius: 20, fontWeight: 500 }}>{rallies.length}球記録済</span>
      </div>
      <div style={{ display: "flex", borderBottom: "0.5px solid #ddd", background: "#fff", padding: "0 20px" }}>
        {[["record", "記録"], ["report", "レポート"], ["settings", "設定"]].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "record" && (
          <div>
            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{playerName}</div><div style={{ fontSize: 36, fontWeight: 500, color: "#1D9E75" }}>{myScore}</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, color: "#ccc" }}>—</div><div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>第{setNum}セット</div></div>
              <div style={{ textAlign: "center" }}><div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{oppName}</div><div style={{ fontSize: 36, fontWeight: 500, color: "#E24B4A" }}>{oppScore}</div></div>
            </div>
            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
              {[["サービスの種類", SERVE_TYPES, serve, setServe, SERVE_COLORS], ["コース", COURSES, course, setCourse, null], ["レシーブの型", RECEIVES, receive, setReceive, null]].map(([label, items, sel, setSel, colors]) => (
                <div key={label}><div style={{ fontSize: 11, fontWeight: 500, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{label}</div><PillGroup items={items} selected={sel} onSelect={setSel} colorMap={colors} /></div>
              ))}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                <button className="rbtn" onClick={() => recordRally(true)} style={{ background: "#E1F5EE", color: "#0F6E56" }}>✓ 得点</button>
                <button className="rbtn" onClick={() => recordRally(false)} style={{ background: "#FCEBEB", color: "#A32D2D" }}>✗ 失点</button>
              </div>
            </div>
            {rallies.length > 0 && (
              <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px", marginTop: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>直近の記録</div>
                {rallies.slice(0, 8).map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "0.5px solid #eee", fontSize: 13 }}>
                    <span style={{ fontSize: 11, color: "#999", width: 24 }}>#{r.rallyNum}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: r.win ? "#E1F5EE" : "#FCEBEB", color: r.win ? "#0F6E56" : "#A32D2D" }}>{r.win ? "得点" : "失点"}</span>
                    <span style={{ color: "#666", flex: 1 }}>{r.serve} → {r.course} → {r.receive}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === "report" && (
          <div>
            {rallies.length === 0 ? (
              <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>まだ記録がありません</div>
                <div style={{ fontSize: 13, color: "#666" }}>「記録」タブでラリーを記録してください</div>
              </div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 16 }}>
                  <StatCard label="総ポイント" value={rallies.length} sub="球記録" />
                  <StatCard label="得点率" value={`${Math.round(rallies.filter((r) => r.win).length / rallies.length * 100)}%`} sub={`${rallies.filter((r) => r.win).length}/${rallies.length}`} />
                </div>
                {serveData.length > 0 && (
                  <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px", marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14 }}>サービス種別 得点率</div>
                    {serveData.map((d) => (
                      <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, color: "#666", width: 72, textAlign: "right" }}>{d.label}</span>
                        <div style={{ flex: 1, height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${d.value}%`, background: d.color, borderRadius: 4 }} />
                        </div>
                        <span style={{ fontSize: 12, color: "#666", width: 36 }}>{d.value}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <span style={{ fontSize: 16 }}>✨</span>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>AI 試合レポート</span>
                  </div>
                  {aiReport ? (
                    <div ref={reportRef} style={{ fontSize: 13, color: "#444", lineHeight: 1.75, whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto" }}>{aiReport}</div>
                  ) : (
                    <div style={{ fontSize: 13, color: "#666", padding: "8px 0" }}>{aiLoading ? "AIが分析中..." : "ボタンを押すとAIがレポートを生成します"}</div>
                  )}
                  <button onClick={generateAiReport} disabled={aiLoading} style={{ marginTop: 14, width: "100%", padding: 10, background: aiLoading ? "#ccc" : "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: aiLoading ? "default" : "pointer" }}>
                    {aiLoading ? "生成中..." : aiReport ? "レポートを再生成" : "AIレポートを生成"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 14 }}>選手情報</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[["自分の名前", playerName, setPlayerName], ["対戦相手", oppName, setOppName]].map(([label, val, setter]) => (
                  <div key={label}><div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{label}</div><input type="text" value={val} onChange={(e) => setter(e.target.value)} style={{ background: "#fff", color: "#1a1a18", border: "0.5px solid #ccc", borderRadius: 6, padding: "7px 10px", fontSize: 13, width: "100%" }} /></div>
                ))}
              </div>
            </div>
            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>データ管理</div>
              <button onClick={() => { const data = JSON.stringify({ rallies, playerName, oppName }, null, 2); const blob = new Blob([data], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `match_${new Date().toISOString().slice(0, 10)}.json`; a.click(); }} style={{ width: "100%", padding: 9, background: "#f4f4f2", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>データをエクスポート</button>
              <button onClick={() => { if (confirm("記録をすべて削除しますか？")) { setRallies([]); setMyScore(0); setOppScore(0); setSetNum(1); setAiReport(""); } }} style={{ width: "100%", padding: 9, background: "#FCEBEB", border: "0.5px solid #E24B4A", borderRadius: 8, fontSize: 13, cursor: "pointer", color: "#A32D2D", marginTop: 8 }}>リセット</button>
            </div>
            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>アカウント</div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>{session.user.email}</div>
              <button onClick={() => supabase.auth.signOut()} style={{ width: "100%", padding: 9, background: "#f4f4f2", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>ログアウト</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
