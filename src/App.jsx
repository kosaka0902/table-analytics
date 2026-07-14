import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "./supabaseClient";
import Auth from "./Auth";
import VideoAnalysis from "./VideoAnalysis";

const SERVE_TYPES = ["真下回転(強)", "順横下回転", "順横回転", "順横上回転", "アップサーブ", "逆横上回転", "逆横回転", "逆横下回転", "ナックル", "下ナックル", "上ナックル"];
const SERVE_LENGTHS = ["ショートサーブ", "ハーフロングサーブ", "ロングサーブ"];
const COURSES = ["フォア前", "フォア深", "ミドル前", "ミドル深", "バック前", "バック深"];
const RECEIVES = ["ツッツキ", "フリック", "チキータ", "ストップ", "ループドライブ", "ドライブ", "スマッシュ", "逆チキータ"];

const SERVE_PALETTE = ["#1D9E75", "#378ADD", "#EF9F27", "#E24B4A", "#7F77DD", "#2CA6A4", "#D65DB1", "#845EC2", "#FF9671", "#0089BA", "#B39CD0", "#4B7BEC"];
const SERVE_COLORS = Object.fromEntries(SERVE_TYPES.map((s, i) => [s, SERVE_PALETTE[i % SERVE_PALETTE.length]]));

const DOMINANT_HANDS = ["右利き", "左利き"];
const RACKET_TYPES = ["シェークハンド", "ペンホルダー"];
const RUBBER_TYPES = ["裏ソフト", "表ソフト", "粒高", "アンチ"];
const PLAY_STYLES = ["ドライブ攻撃型", "前陣速攻型", "カット主戦型(カットマン)", "異質攻守型(ブロック主戦型)", "オールラウンド型", "守備型"];
const YEARS_PLAYING_OPTIONS = ["1年未満", "1〜3年", "3年〜7年", "7年以上"];
const SKILL_LEVELS = ["初級", "中級", "上級", "超級", "プロ級"];

const EMPTY_PROFILE = {
  nickname: "",
  age: "",
  dominant_hand: "",
  racket_type: "",
  forehand_rubber_type: "",
  backhand_rubber_type: "",
  play_style: "",
  racket_name: "",
  forehand_rubber_name: "",
  backhand_rubber_name: "",
  years_playing: "",
  skill_level: "",
};

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

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{label}</div>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "#fff", color: "#1a1a18", border: "0.5px solid #ccc", borderRadius: 6, padding: "7px 10px", fontSize: 13, width: "100%" }}
      >
        <option value="">未設定</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

function TextField({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>{label}</div>
      <input
        type={type}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ background: "#fff", color: "#1a1a18", border: "0.5px solid #ccc", borderRadius: 6, padding: "7px 10px", fontSize: 13, width: "100%" }}
      />
    </div>
  );
}

export default function App() {
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

  const [currentMatchId, setCurrentMatchId] = useState(null);
  const [matchStarting, setMatchStarting] = useState(false);

  const [matchHistory, setMatchHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedMatchId, setExpandedMatchId] = useState(null);

  const [tab, setTab] = useState("record");
  const [myScore, setMyScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [setNum, setSetNum] = useState(1);
  const [serve, setServe] = useState(null);
  const [serveLength, setServeLength] = useState(null);
  const [course, setCourse] = useState(null);
  const [receive, setReceive] = useState(null);
  const [rallies, setRallies] = useState([]);
  const [playerName, setPlayerName] = useState("自分");
  const [oppName, setOppName] = useState("相手選手");
  const [aiReport, setAiReport] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const reportRef = useRef();

  // ---- プロフィールまわりの状態 ----
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedAt, setProfileSavedAt] = useState(null);

  const loadProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setProfile({ ...EMPTY_PROFILE, ...data });
      }
    } catch (err) {
      console.error("プロフィール読み込みエラー:", err);
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) loadProfile();
  }, [session, loadProfile]);

  const updateProfileField = (field, value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const saveProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    setProfileSaving(true);
    try {
      const payload = {
        user_id: session.user.id,
        ...profile,
        age: profile.age ? parseInt(profile.age, 10) : null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      setProfileSavedAt(new Date());
    } catch (err) {
      alert("プロフィールの保存に失敗しました: " + err.message);
    } finally {
      setProfileSaving(false);
    }
  }, [session, profile]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select("*")
        .order("started_at", { ascending: false });
      if (matchesError) throw matchesError;

      const { data: ralliesData, error: ralliesError } = await supabase
        .from("rallies")
        .select("match_id, win");
      if (ralliesError) throw ralliesError;

      const statsByMatch = {};
      (ralliesData || []).forEach((r) => {
        if (!r.match_id) return;
        if (!statsByMatch[r.match_id]) statsByMatch[r.match_id] = { total: 0, wins: 0 };
        statsByMatch[r.match_id].total += 1;
        if (r.win) statsByMatch[r.match_id].wins += 1;
      });

      const merged = (matchesData || []).map((m) => ({
        ...m,
        stats: statsByMatch[m.id] || { total: 0, wins: 0 },
      }));
      setMatchHistory(merged);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  const startMatch = useCallback(async () => {
    setMatchStarting(true);
    try {
      const { data, error } = await supabase
        .from("matches")
        .insert({ user_id: session?.user?.id, player_name: playerName, opp_name: oppName })
        .select()
        .single();
      if (error) throw error;
      setCurrentMatchId(data.id);
      setMyScore(0);
      setOppScore(0);
      setSetNum(1);
      setRallies([]);
      setAiReport("");
    } catch (err) {
      alert("試合の開始に失敗しました: " + err.message);
    } finally {
      setMatchStarting(false);
    }
  }, [session, playerName, oppName]);

  const endMatch = useCallback(async () => {
    if (!currentMatchId) return;
    if (!confirm("この試合を終了しますか？")) return;
    try {
      const { error } = await supabase
        .from("matches")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", currentMatchId);
      if (error) throw error;
      setCurrentMatchId(null);
    } catch (err) {
      alert("試合の終了に失敗しました: " + err.message);
    }
  }, [currentMatchId]);

  const recordRally = useCallback((win) => {
    if (!currentMatchId) { alert("先に「試合を開始」してください"); return; }
    if (!serve || !serveLength || !course || !receive) { alert("サービスの回転・長さ・コース・レシーブをすべて選択してください"); return; }
    const rally = { id: Date.now(), rallyNum: rallies.length + 1, serve, serveLength, course, receive, win };
    setRallies((prev) => [rally, ...prev]);
    if (win) setMyScore((s) => s + 1); else setOppScore((s) => s + 1);
    const newMy = win ? myScore + 1 : myScore;
    const newOpp = win ? oppScore : oppScore + 1;
    if (newMy >= 11 && newMy - newOpp >= 2) { setTimeout(() => { alert(`セット${setNum}終了！`); setSetNum((n) => n + 1); setMyScore(0); setOppScore(0); }, 100); }
    supabase.from("rallies").insert({
      player_name: playerName,
      opp_name: oppName,
      serve_type: serve,
      serve_length: serveLength,
      course: course,
      receive: receive,
      win: win,
      set_num: setNum,
      user_id: session?.user?.id,
      match_id: currentMatchId,
    }).then(({ error }) => { if (error) console.error(error); });
    setServe(null); setServeLength(null); setCourse(null); setReceive(null);
  }, [serve, serveLength, course, receive, rallies, myScore, oppScore, setNum, session, currentMatchId, playerName, oppName]);

  const generateAiReport = async () => {
    const total = rallies.length;
    if (total === 0) { alert("記録がまだありません"); return; }
    const wins = rallies.filter((r) => r.win).length;
    const serveStats = SERVE_TYPES.map((s) => { const rs = rallies.filter((r) => r.serve === s); return rs.length ? `${s}: ${rs.length}球, 得点率${Math.round(rs.filter((r) => r.win).length / rs.length * 100)}%` : null; }).filter(Boolean).join(", ");
    const lengthStats = SERVE_LENGTHS.map((s) => { const rs = rallies.filter((r) => r.serveLength === s); return rs.length ? `${s}: ${rs.length}球, 得点率${Math.round(rs.filter((r) => r.win).length / rs.length * 100)}%` : null; }).filter(Boolean).join(", ");
    const courseStats = COURSES.map((c) => { const rs = rallies.filter((r) => r.course === c); return rs.length ? `${c}: ${rs.length}球, 得点率${Math.round(rs.filter((r) => r.win).length / rs.length * 100)}%` : null; }).filter(Boolean).join(", ");
    const receiveStats = RECEIVES.map((rv) => { const rs = rallies.filter((r) => r.receive === rv); return rs.length ? `${rv}: ${rs.length}球, 得点率${Math.round(rs.filter((r) => r.win).length / rs.length * 100)}%` : null; }).filter(Boolean).join(", ");
    setAiLoading(true); setAiReport("");
    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, oppName, total, wins, serveStats, lengthStats, courseStats, receiveStats, profile }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "レポート生成に失敗しました");
      }
      const data = await response.json();
      setAiReport(data.report);
      if (currentMatchId) {
        supabase.from("matches").update({ ai_report: data.report }).eq("id", currentMatchId)
          .then(({ error }) => { if (error) console.error("AIレポート保存エラー:", error); });
      }
    } catch (err) { setAiReport("エラーが発生しました: " + err.message); }
    finally { setAiLoading(false); }
  };

  const serveData = SERVE_TYPES.map((s, i) => { const rs = rallies.filter((r) => r.serve === s); return { label: s, total: rs.length, value: rs.length ? Math.round(rs.filter((r) => r.win).length / rs.length * 100) : 0, color: SERVE_COLORS[s] }; }).filter((d) => d.total > 0);

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
        {[["record", "記録"], ["history", "履歴"], ["report", "レポート"], ["settings", "設定"]].map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div style={{ padding: 20 }}>
        {tab === "record" && (
          <div>
            {!currentMatchId ? (
              <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: 30, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🏓</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>試合がまだ開始されていません</div>
                <div style={{ fontSize: 13, color: "#666", marginBottom: 18 }}>「設定」タブで選手名を確認してから、試合を開始してください</div>
                <button onClick={startMatch} disabled={matchStarting} style={{ padding: "12px 24px", background: matchStarting ? "#ccc" : "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: matchStarting ? "default" : "pointer" }}>
                  {matchStarting ? "開始中..." : "試合を開始"}
                </button>
              </div>
            ) : (
              <>
                <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{playerName}</div><div style={{ fontSize: 36, fontWeight: 500, color: "#1D9E75" }}>{myScore}</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, color: "#ccc" }}>—</div><div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>第{setNum}セット</div></div>
                  <div style={{ textAlign: "center" }}><div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>{oppName}</div><div style={{ fontSize: 36, fontWeight: 500, color: "#E24B4A" }}>{oppScore}</div></div>
                </div>
                <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
                  {[["サービスの回転", SERVE_TYPES, serve, setServe, SERVE_COLORS], ["サービスの長さ", SERVE_LENGTHS, serveLength, setServeLength, null], ["コース", COURSES, course, setCourse, null], ["レシーブの型", RECEIVES, receive, setReceive, null]].map(([label, items, sel, setSel, colors]) => (
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
                        <span style={{ color: "#666", flex: 1 }}>{r.serve}({r.serveLength}) → {r.course} → {r.receive}</span>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={endMatch} style={{ width: "100%", marginTop: 14, padding: 10, background: "#fff", border: "0.5px solid #E24B4A", borderRadius: 8, fontSize: 13, cursor: "pointer", color: "#A32D2D" }}>
                  試合を終了
                </button>
              </>
            )}
          </div>
        )}
        {tab === "history" && (
          <div>
            {historyLoading ? (
              <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>読み込み中...</div>
            ) : matchHistory.length === 0 ? (
              <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: 40, textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🗂️</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>まだ試合がありません</div>
                <div style={{ fontSize: 13, color: "#666" }}>「記録」タブで試合を開始してください</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {matchHistory.map((m) => {
                  const winRate = m.stats.total > 0 ? Math.round((m.stats.wins / m.stats.total) * 100) : null;
                  const dateLabel = new Date(m.started_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  const isExpanded = expandedMatchId === m.id;
                  return (
                    <div key={m.id} style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{m.player_name} vs {m.opp_name}</span>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: m.ended_at ? "#f0f0f0" : "#E1F5EE", color: m.ended_at ? "#666" : "#0F6E56" }}>
                          {m.ended_at ? "終了" : "進行中"}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#666" }}>{dateLabel}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                        {m.stats.total > 0 ? `${m.stats.total}球記録・得点率${winRate}%` : "まだラリー記録なし"}
                      </div>
                      {m.ai_report && (
                        <div style={{ marginTop: 10, background: "#f9f9f8", borderRadius: 8, padding: 12 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6, color: "#666" }}>AI試合レポート(保存済み)</div>
                          <p style={{ fontSize: 12, color: "#444", whiteSpace: "pre-wrap", lineHeight: 1.6, maxHeight: 200, overflowY: "auto" }}>{m.ai_report}</p>
                        </div>
                      )}
                      <button
                        onClick={() => setExpandedMatchId(isExpanded ? null : m.id)}
                        style={{ marginTop: 10, width: "100%", padding: 8, background: "#f4f4f2", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 12, cursor: "pointer" }}
                      >
                        {isExpanded ? "動画分析を閉じる" : "🎥 動画を分析"}
                      </button>
                      {isExpanded && (
                        <VideoAnalysis
                          matchId={m.id}
                          userId={session.user.id}
                          accessToken={session.access_token}
                          profile={profile}
                        />
                      )}
                    </div>
                  );
                })}
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
                        <span style={{ fontSize: 12, color: "#666", width: 90, textAlign: "right" }}>{d.label}</span>
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
              {currentMatchId && (
                <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 10 }}>※ 試合中は名前を変更しても、今の試合には反映されません</div>
              )}
            </div>

            <div style={{ background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>自己プロフィール</div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 14 }}>
                ここで登録した情報は、AIレポート生成時に参考情報として使われます
              </div>

              {profileLoading ? (
                <div style={{ fontSize: 13, color: "#666" }}>読み込み中...</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <TextField label="ニックネーム" value={profile.nickname} onChange={(v) => updateProfileField("nickname", v)} />
                    <TextField label="年齢" value={profile.age} onChange={(v) => updateProfileField("age", v)} type="number" />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SelectField label="利き手" value={profile.dominant_hand} onChange={(v) => updateProfileField("dominant_hand", v)} options={DOMINANT_HANDS} />
                    <SelectField label="ラケット種類" value={profile.racket_type} onChange={(v) => updateProfileField("racket_type", v)} options={RACKET_TYPES} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SelectField label="フォアラバー種類" value={profile.forehand_rubber_type} onChange={(v) => updateProfileField("forehand_rubber_type", v)} options={RUBBER_TYPES} />
                    <SelectField label="バックラバー種類" value={profile.backhand_rubber_type} onChange={(v) => updateProfileField("backhand_rubber_type", v)} options={RUBBER_TYPES} />
                  </div>

                  <SelectField label="プレースタイル" value={profile.play_style} onChange={(v) => updateProfileField("play_style", v)} options={PLAY_STYLES} />

                  <TextField label="ラケット名" value={profile.racket_name} onChange={(v) => updateProfileField("racket_name", v)} />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <TextField label="フォアラバー名" value={profile.forehand_rubber_name} onChange={(v) => updateProfileField("forehand_rubber_name", v)} />
                    <TextField label="バックラバー名" value={profile.backhand_rubber_name} onChange={(v) => updateProfileField("backhand_rubber_name", v)} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <SelectField label="卓球歴" value={profile.years_playing} onChange={(v) => updateProfileField("years_playing", v)} options={YEARS_PLAYING_OPTIONS} />
                    <SelectField label="実力" value={profile.skill_level} onChange={(v) => updateProfileField("skill_level", v)} options={SKILL_LEVELS} />
                  </div>

                  <button
                    onClick={saveProfile}
                    disabled={profileSaving}
                    style={{ marginTop: 6, width: "100%", padding: 10, background: profileSaving ? "#ccc" : "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: profileSaving ? "default" : "pointer" }}
                  >
                    {profileSaving ? "保存中..." : "プロフィールを保存"}
                  </button>
                  {profileSavedAt && (
                    <div style={{ fontSize: 11, color: "#0F6E56", textAlign: "center" }}>
                      保存しました({profileSavedAt.toLocaleTimeString("ja-JP")})
                    </div>
                  )}
                </div>
              )}
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
