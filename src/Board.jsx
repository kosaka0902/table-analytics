import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";

const BOARD_CATEGORIES = [
  { id: "practice", label: "練習・戦術相談", icon: "🏓" },
  { id: "match_talk", label: "大会・試合の感想", icon: "🏆" },
  { id: "gear", label: "用具・ラバー・ラケット雑談", icon: "🔧" },
  { id: "local", label: "地域の練習会・対戦相手募集", icon: "📍" },
];

const boardLabel = (id) => BOARD_CATEGORIES.find((b) => b.id === id)?.label || id;
const boardIcon = (id) => BOARD_CATEGORIES.find((b) => b.id === id)?.icon || "💬";

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}日前`;
  return new Date(dateStr).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

// 試合データを1〜2行の引用テキストに変換する
function matchToSnippet(m) {
  const total = m.stats?.total ?? 0;
  const wins = m.stats?.wins ?? 0;
  const rate = total > 0 ? Math.round((wins / total) * 100) : null;
  const base = `【試合データ引用】${m.player_name} vs ${m.opp_name}${rate !== null ? ` / 得点率${rate}%(${wins}/${total}球)` : ""}`;
  return base;
}

export default function Board({ session, profile }) {
  const [view, setView] = useState("categories"); // categories | threads | thread | newThread
  const [activeBoard, setActiveBoard] = useState(null);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [activeThread, setActiveThread] = useState(null);
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newSubmitting, setNewSubmitting] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [replySubmitting, setReplySubmitting] = useState(false);

  const [myMatches, setMyMatches] = useState([]);
  const [citePickerOpen, setCitePickerOpen] = useState(false);
  const [pendingSnippet, setPendingSnippet] = useState(null); // { text, matchId }

  const nickname = profile?.nickname || session?.user?.email?.split("@")[0] || "名無しさん";

  const loadThreads = useCallback(async (boardId) => {
    setThreadsLoading(true);
    try {
      const { data: threadsData, error: threadsError } = await supabase
        .from("threads")
        .select("*")
        .eq("board", boardId)
        .order("created_at", { ascending: false });
      if (threadsError) throw threadsError;

      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("thread_id");
      if (postsError) throw postsError;

      const countByThread = {};
      (postsData || []).forEach((p) => {
        countByThread[p.thread_id] = (countByThread[p.thread_id] || 0) + 1;
      });

      setThreads((threadsData || []).map((t) => ({ ...t, replyCount: countByThread[t.id] || 0 })));
    } catch (err) {
      console.error("スレッド読み込みエラー:", err);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  const loadPosts = useCallback(async (threadId) => {
    setPostsLoading(true);
    try {
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setPosts(data || []);
    } catch (err) {
      console.error("投稿読み込みエラー:", err);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const loadMyMatches = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const { data: matchesData, error: matchesError } = await supabase
        .from("matches")
        .select("*")
        .eq("user_id", session.user.id)
        .order("started_at", { ascending: false })
        .limit(15);
      if (matchesError) throw matchesError;

      const { data: ralliesData, error: ralliesError } = await supabase
        .from("rallies")
        .select("match_id, win")
        .eq("user_id", session.user.id);
      if (ralliesError) throw ralliesError;

      const statsByMatch = {};
      (ralliesData || []).forEach((r) => {
        if (!r.match_id) return;
        if (!statsByMatch[r.match_id]) statsByMatch[r.match_id] = { total: 0, wins: 0 };
        statsByMatch[r.match_id].total += 1;
        if (r.win) statsByMatch[r.match_id].wins += 1;
      });

      setMyMatches((matchesData || []).map((m) => ({ ...m, stats: statsByMatch[m.id] || { total: 0, wins: 0 } })));
    } catch (err) {
      console.error("試合データ読み込みエラー:", err);
    }
  }, [session]);

  useEffect(() => {
    if (activeBoard && view === "threads") loadThreads(activeBoard);
  }, [activeBoard, view, loadThreads]);

  useEffect(() => {
    if (activeThread && view === "thread") loadPosts(activeThread.id);
  }, [activeThread, view, loadPosts]);

  const openBoard = (boardId) => {
    setActiveBoard(boardId);
    setView("threads");
  };

  const openThread = (thread) => {
    setActiveThread(thread);
    setView("thread");
  };

  const openNewThread = () => {
    setNewTitle("");
    setNewBody("");
    setPendingSnippet(null);
    setView("newThread");
    loadMyMatches();
  };

  const createThread = async () => {
    if (!newTitle.trim() || !newBody.trim()) {
      alert("タイトルと本文を入力してください");
      return;
    }
    setNewSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("threads")
        .insert({
          board: activeBoard,
          title: newTitle.trim(),
          user_id: session.user.id,
          author_nickname: nickname,
          shared_match_id: pendingSnippet?.matchId || null,
          shared_snippet: pendingSnippet?.text || null,
        })
        .select()
        .single();
      if (error) throw error;

      // 本文自体もposts側に最初の投稿として作る(スレ主の本文)
      const { error: postError } = await supabase.from("posts").insert({
        thread_id: data.id,
        user_id: session.user.id,
        author_nickname: nickname,
        body: newBody.trim(),
        shared_match_id: pendingSnippet?.matchId || null,
        shared_snippet: pendingSnippet?.text || null,
      });
      if (postError) throw postError;

      setActiveThread(data);
      setView("thread");
      loadThreads(activeBoard);
    } catch (err) {
      alert("スレッドの作成に失敗しました: " + err.message);
    } finally {
      setNewSubmitting(false);
    }
  };

  const createReply = async () => {
    if (!replyBody.trim()) return;
    setReplySubmitting(true);
    try {
      const { error } = await supabase.from("posts").insert({
        thread_id: activeThread.id,
        user_id: session.user.id,
        author_nickname: nickname,
        body: replyBody.trim(),
        shared_match_id: pendingSnippet?.matchId || null,
        shared_snippet: pendingSnippet?.text || null,
      });
      if (error) throw error;
      setReplyBody("");
      setPendingSnippet(null);
      loadPosts(activeThread.id);
    } catch (err) {
      alert("返信の投稿に失敗しました: " + err.message);
    } finally {
      setReplySubmitting(false);
    }
  };

  const pickMatchForCite = (m) => {
    setPendingSnippet({ text: matchToSnippet(m), matchId: m.id });
    setCitePickerOpen(false);
  };

  const cardStyle = { background: "#fff", border: "0.5px solid #ddd", borderRadius: 12, padding: "16px 20px" };
  const btnPrimary = { padding: "10px 16px", background: "#1D9E75", color: "white", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: "pointer" };
  const btnGhost = { padding: "8px 14px", background: "#f4f4f2", border: "0.5px solid #ddd", borderRadius: 8, fontSize: 13, cursor: "pointer" };

  // ---------- カテゴリ一覧 ----------
  if (view === "categories") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {BOARD_CATEGORIES.map((b) => (
          <button
            key={b.id}
            onClick={() => openBoard(b.id)}
            style={{ ...cardStyle, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14 }}
          >
            <span style={{ fontSize: 24 }}>{b.icon}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{b.label}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }

  // ---------- スレッド一覧 ----------
  if (view === "threads") {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={() => setView("categories")} style={{ background: "none", border: "none", color: "#1D9E75", fontSize: 13, cursor: "pointer" }}>← カテゴリ一覧</button>
          <button onClick={openNewThread} style={btnPrimary}>+ 新規スレッド</button>
        </div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>{boardIcon(activeBoard)} {boardLabel(activeBoard)}</div>
        {threadsLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>読み込み中...</div>
        ) : threads.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>まだスレッドがありません</div>
            <div style={{ fontSize: 13, color: "#666" }}>最初のスレッドを立ててみましょう</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {threads.map((t) => (
              <button key={t.id} onClick={() => openThread(t)} style={{ ...cardStyle, textAlign: "left", cursor: "pointer" }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{t.title}</div>
                {t.shared_snippet && (
                  <div style={{ fontSize: 11, color: "#0F6E56", background: "#E1F5EE", borderRadius: 6, padding: "4px 8px", display: "inline-block", marginBottom: 6 }}>
                    📊 {t.shared_snippet}
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#666", display: "flex", gap: 10 }}>
                  <span>{t.author_nickname || "名無しさん"}</span>
                  <span>{timeAgo(t.created_at)}</span>
                  <span>返信{t.replyCount}件</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- 新規スレッド作成 ----------
  if (view === "newThread") {
    return (
      <div>
        <button onClick={() => setView("threads")} style={{ background: "none", border: "none", color: "#1D9E75", fontSize: 13, cursor: "pointer", marginBottom: 14 }}>← {boardLabel(activeBoard)}に戻る</button>
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>新規スレッド ({boardLabel(activeBoard)})</div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>タイトル</div>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", border: "0.5px solid #ccc", borderRadius: 6, fontSize: 13, marginBottom: 12 }}
            placeholder="例: バック側への深い球への対処法"
          />
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>本文</div>
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            rows={6}
            style={{ width: "100%", padding: "8px 10px", border: "0.5px solid #ccc", borderRadius: 6, fontSize: 13, marginBottom: 10, fontFamily: "inherit", resize: "vertical" }}
            placeholder="内容を書いてください"
          />
          <CiteBlock
            pendingSnippet={pendingSnippet}
            onClear={() => setPendingSnippet(null)}
            citePickerOpen={citePickerOpen}
            setCitePickerOpen={setCitePickerOpen}
            myMatches={myMatches}
            onPick={pickMatchForCite}
          />
          <button onClick={createThread} disabled={newSubmitting} style={{ ...btnPrimary, width: "100%", marginTop: 12, background: newSubmitting ? "#ccc" : "#1D9E75" }}>
            {newSubmitting ? "投稿中..." : "スレッドを立てる"}
          </button>
        </div>
      </div>
    );
  }

  // ---------- スレッド詳細 ----------
  if (view === "thread") {
    return (
      <div>
        <button onClick={() => setView("threads")} style={{ background: "none", border: "none", color: "#1D9E75", fontSize: 13, cursor: "pointer", marginBottom: 14 }}>← {boardLabel(activeBoard)}に戻る</button>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>{activeThread?.title}</div>
        {postsLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#666", fontSize: 13 }}>読み込み中...</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {posts.map((p, i) => (
              <div key={p.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#1D9E75" }}>#{i + 1} {p.author_nickname || "名無しさん"}</span>
                  <span style={{ fontSize: 11, color: "#999" }}>{timeAgo(p.created_at)}</span>
                </div>
                {p.shared_snippet && (
                  <div style={{ fontSize: 11, color: "#0F6E56", background: "#E1F5EE", borderRadius: 6, padding: "4px 8px", display: "inline-block", marginBottom: 8 }}>
                    📊 {p.shared_snippet}
                  </div>
                )}
                <div style={{ fontSize: 13, color: "#444", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{p.body}</div>
              </div>
            ))}
          </div>
        )}
        <div style={cardStyle}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>返信する</div>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={4}
            style={{ width: "100%", padding: "8px 10px", border: "0.5px solid #ccc", borderRadius: 6, fontSize: 13, marginBottom: 10, fontFamily: "inherit", resize: "vertical" }}
            placeholder="返信を書いてください"
          />
          <CiteBlock
            pendingSnippet={pendingSnippet}
            onClear={() => setPendingSnippet(null)}
            citePickerOpen={citePickerOpen}
            setCitePickerOpen={setCitePickerOpen}
            myMatches={myMatches}
            onPick={pickMatchForCite}
            onOpenPicker={loadMyMatches}
          />
          <button onClick={createReply} disabled={replySubmitting} style={{ ...btnPrimary, width: "100%", marginTop: 12, background: replySubmitting ? "#ccc" : "#1D9E75" }}>
            {replySubmitting ? "送信中..." : "返信を送信"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// 「自分の試合データを引用」ボタン + ピッカー
function CiteBlock({ pendingSnippet, onClear, citePickerOpen, setCitePickerOpen, myMatches, onPick, onOpenPicker }) {
  return (
    <div>
      {pendingSnippet ? (
        <div style={{ fontSize: 12, color: "#0F6E56", background: "#E1F5EE", borderRadius: 8, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>📊 {pendingSnippet.text}</span>
          <button onClick={onClear} style={{ background: "none", border: "none", color: "#0F6E56", cursor: "pointer", fontSize: 12 }}>✕</button>
        </div>
      ) : (
        <button
          onClick={() => { setCitePickerOpen((v) => !v); if (onOpenPicker) onOpenPicker(); }}
          style={{ fontSize: 12, background: "#f4f4f2", border: "0.5px solid #ddd", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}
        >
          📊 自分の試合データを引用
        </button>
      )}
      {citePickerOpen && !pendingSnippet && (
        <div style={{ marginTop: 8, border: "0.5px solid #ddd", borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
          {myMatches.length === 0 ? (
            <div style={{ fontSize: 12, color: "#666", padding: 12 }}>引用できる試合データがありません</div>
          ) : (
            myMatches.map((m) => (
              <button
                key={m.id}
                onClick={() => onPick(m)}
                style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12, background: "#fff", border: "none", borderBottom: "0.5px solid #eee", cursor: "pointer" }}
              >
                {m.player_name} vs {m.opp_name}{m.stats.total > 0 ? ` (得点率${Math.round((m.stats.wins / m.stats.total) * 100)}%)` : ""}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
