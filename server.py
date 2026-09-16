import os
import re
import json
import uuid
import time
import urllib.parse
from typing import Optional, List, Dict, Any
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Initialize FastAPI App
app = FastAPI(title="J-Song Learn API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
SONGS_FILE = DATA_DIR / "songs.json"
NOTES_FILE = DATA_DIR / "notes.json"

DATA_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# ----------------- Data Persistence Helpers -----------------
def load_json(filepath: Path, default_val: Any) -> Any:
    if filepath.exists():
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading {filepath}: {e}")
    return default_val

def save_json(filepath: Path, data: Any):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

DEFAULT_SONGS = [
    {
        "id": "lemon",
        "title": "Lemon",
        "artist": "米津玄師",
        "youtubeId": "SX_ViT4Ra7k",
        "offset": 0.0,
        "createdAt": "2026-09-10T12:00:00Z"
    },
    {
        "id": "idol",
        "title": "アイドル",
        "artist": "YOASOBI",
        "youtubeId": "ZRtdQ81jPUQ",
        "offset": 0.0,
        "createdAt": "2026-09-10T12:01:00Z"
    },
    {
        "id": "pretender",
        "title": "Pretender",
        "artist": "Official髭男dism",
        "youtubeId": "TQ8WlA2GXbk",
        "offset": 0.0,
        "createdAt": "2026-09-10T12:02:00Z"
    },
    {
        "id": "first-love",
        "title": "First Love",
        "artist": "宇多田ヒカル",
        "youtubeId": "o1sUaVJUeB0",
        "offset": 0.0,
        "createdAt": "2026-09-10T12:03:00Z"
    }
]

if not SONGS_FILE.exists():
    save_json(SONGS_FILE, DEFAULT_SONGS)

if not NOTES_FILE.exists():
    save_json(NOTES_FILE, [])

# ----------------- LRC Parser -----------------
def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
    lines = lrc_text.splitlines()
    entries = []
    time_regex = re.compile(r"\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]")
    for line in lines:
        matches = list(time_regex.finditer(line))
        if not matches:
            continue
        text = time_regex.sub("", line).strip()
        for m in matches:
            minutes = int(m.group(1))
            seconds = float(m.group(2))
            total_sec = round(minutes * 60 + seconds, 2)
            entries.append({"time": total_sec, "text": text})
    entries.sort(key=lambda x: x["time"])
    return entries

def merge_lrc_with_translation(orig_entries: List[Dict[str, Any]], trans_entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not trans_entries:
        return [{"time": e["time"], "text": e["text"], "translation": ""} for e in orig_entries]

    results = []
    for orig in orig_entries:
        closest_trans = ""
        orig_t = orig["time"]
        best_diff = 1.0
        for tr in trans_entries:
            diff = abs(tr["time"] - orig_t)
            if diff < best_diff and tr["text"].strip():
                best_diff = diff
                closest_trans = tr["text"].strip()
        results.append({
            "time": orig["time"],
            "text": orig["text"],
            "translation": closest_trans
        })
    return results

# ----------------- Lyrics Fetcher -----------------
def fetch_from_netease(query: str) -> Optional[Dict[str, Any]]:
    try:
        search_url = f"https://music.163.com/api/search/get/web?csrf_token=&type=1&offset=0&total=true&limit=5&s={urllib.parse.quote(query)}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://music.163.com/"
        }
        resp = requests.get(search_url, headers=headers, timeout=5)
        if resp.status_code == 200:
            result = resp.json().get("result", {})
            songs = result.get("songs", [])
            if songs:
                song = songs[0]
                song_id = song["id"]
                song_name = song["name"]
                artists = ", ".join([a["name"] for a in song.get("artists", [])])
                
                lyric_url = f"https://music.163.com/api/song/lyric?os=pc&id={song_id}&lv=-1&kv=-1&tv=-1"
                lresp = requests.get(lyric_url, headers=headers, timeout=5)
                if lresp.status_code == 200:
                    ldata = lresp.json()
                    lrc = ldata.get("lrc", {}).get("lyric", "")
                    tlrc = ldata.get("tlyric", {}).get("lyric", "")
                    if lrc:
                        parsed_orig = parse_lrc(lrc)
                        parsed_trans = parse_lrc(tlrc) if tlrc else []
                        merged = merge_lrc_with_translation(parsed_orig, parsed_trans)
                        return {
                            "source": "netease",
                            "title": song_name,
                            "artist": artists,
                            "lines": merged,
                            "rawLrc": lrc,
                            "rawTrans": tlrc
                        }
    except Exception as e:
        print(f"NetEase error: {e}")
    return None

def fetch_from_lrclib(query: str) -> Optional[Dict[str, Any]]:
    try:
        url = f"https://lrclib.net/api/search?q={urllib.parse.quote(query)}"
        headers = {"User-Agent": "JSongLearn/1.0"}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if data and isinstance(data, list):
                best = next((d for d in data if d.get("syncedLyrics")), data[0])
                synced = best.get("syncedLyrics") or ""
                if synced:
                    parsed = parse_lrc(synced)
                    merged = [{"time": p["time"], "text": p["text"], "translation": ""} for p in parsed]
                    return {
                        "source": "lrclib",
                        "title": best.get("trackName"),
                        "artist": best.get("artistName"),
                        "lines": merged,
                        "rawLrc": synced,
                        "rawTrans": ""
                    }
    except Exception as e:
        print(f"LRCLIB error: {e}")
    return None

# ----------------- YouTube Search -----------------
def search_youtube(query: str) -> Optional[Dict[str, str]]:
    """Searches YouTube and finds the most relevant video ID."""
    try:
        clean_q = query.strip()
        search_query = f"{clean_q} official MV" if "MV" not in clean_q and "mv" not in clean_q else clean_q
        url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(search_query)}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "ja,zh-TW;q=0.9,en;q=0.8"
        }
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code == 200:
            html = resp.text
            vids = re.findall(r"/watch\?v=([a-zA-Z0-9_-]{11})", html)
            if vids:
                seen = set()
                uniq_vids = []
                for v in vids:
                    if v not in seen:
                        seen.add(v)
                        uniq_vids.append(v)
                
                best_vid = uniq_vids[0]
                title = clean_q
                author = ""
                try:
                    oembed_res = requests.get(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={best_vid}&format=json", timeout=3)
                    if oembed_res.status_code == 200:
                        odata = oembed_res.json()
                        title = odata.get("title", clean_q)
                        author = odata.get("author_name", "")
                except Exception:
                    pass
                
                return {
                    "videoId": best_vid,
                    "title": title,
                    "author": author
                }
    except Exception as e:
        print(f"YouTube search error: {e}")
    return None

# ----------------- API Endpoints -----------------

@app.get("/api/search-lyrics")
def search_lyrics(q: str = Query(..., description="Song title or artist to search")):
    result = fetch_from_netease(q)
    if not result or not result.get("lines"):
        result = fetch_from_lrclib(q)
    if not result:
        raise HTTPException(status_code=404, detail="未找到該歌曲的同步歌詞")
    return result

@app.get("/api/search-song")
def search_song(q: str = Query(..., description="Song title or artist")):
    """Unified search: fetches matching YouTube video AND lyrics together."""
    clean_q = q.strip()
    
    # 1. Search YouTube
    yt_info = search_youtube(clean_q)
    
    # 2. Search Lyrics
    lyrics_info = fetch_from_netease(clean_q)
    if not lyrics_info or not lyrics_info.get("lines"):
        lyrics_info = fetch_from_lrclib(clean_q)
        
    return {
        "youtube": yt_info,
        "lyrics": lyrics_info
    }

class YouTubeInfoRequest(BaseModel):
    url: str

@app.post("/api/youtube/info")
def get_youtube_info(req: YouTubeInfoRequest):
    url = req.url.strip()
    match = re.search(r"(?:v=|\/embed\/|\/watch\?v=|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})", url)
    if not match:
        raise HTTPException(status_code=400, detail="無法識別有效的 YouTube 網址或影片 ID")
    video_id = match.group(1)
    
    title = ""
    author = ""
    try:
        oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        res = requests.get(oembed_url, timeout=4)
        if res.status_code == 200:
            data = res.json()
            title = data.get("title", "")
            author = data.get("author_name", "")
    except Exception as e:
        print(f"oEmbed error: {e}")

    return {
        "videoId": video_id,
        "title": title,
        "author": author
    }

class SongSaveRequest(BaseModel):
    id: Optional[str] = None
    title: str
    artist: str
    youtubeId: str
    offset: float = 0.0
    lyrics: Optional[List[Dict[str, Any]]] = None

@app.get("/api/library")
def get_library():
    return load_json(SONGS_FILE, DEFAULT_SONGS)

@app.post("/api/library")
def save_song_to_library(song: SongSaveRequest):
    songs = load_json(SONGS_FILE, [])
    song_id = song.id or str(uuid.uuid4())[:8]
    
    existing_idx = next((i for i, s in enumerate(songs) if s.get("id") == song_id or (s.get("youtubeId") == song.youtubeId and song.youtubeId)), None)
    
    song_data = {
        "id": song_id,
        "title": song.title,
        "artist": song.artist,
        "youtubeId": song.youtubeId,
        "offset": song.offset,
        "lyrics": song.lyrics,
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    
    if existing_idx is not None:
        songs[existing_idx] = song_data
    else:
        song_data["createdAt"] = song_data["updatedAt"]
        songs.insert(0, song_data)
        
    save_json(SONGS_FILE, songs)
    return {"status": "ok", "song": song_data}

@app.delete("/api/library/{song_id}")
def delete_song_from_library(song_id: str):
    songs = load_json(SONGS_FILE, [])
    new_songs = [s for s in songs if s.get("id") != song_id]
    save_json(SONGS_FILE, new_songs)
    return {"status": "ok"}

# ----------------- Vocabulary Notes -----------------
class NoteRequest(BaseModel):
    word: str
    reading: Optional[str] = ""
    explanation: str
    songTitle: str
    lineContext: str

@app.get("/api/notes")
def get_notes():
    return load_json(NOTES_FILE, [])

@app.post("/api/notes")
def add_note(note: NoteRequest):
    notes = load_json(NOTES_FILE, [])
    note_id = str(uuid.uuid4())[:8]
    new_entry = {
        "id": note_id,
        "word": note.word,
        "reading": note.reading,
        "explanation": note.explanation,
        "songTitle": note.songTitle,
        "lineContext": note.lineContext,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    notes.insert(0, new_entry)
    save_json(NOTES_FILE, notes)
    return new_entry

@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str):
    notes = load_json(NOTES_FILE, [])
    new_notes = [n for n in notes if n.get("id") != note_id]
    save_json(NOTES_FILE, new_notes)
    return {"status": "ok"}

# ----------------- Gemini AI Japanese Tutor -----------------
class AIAskRequest(BaseModel):
    apiKey: Optional[str] = None
    model: Optional[str] = "gemini-2.5-flash"
    songTitle: str
    artist: Optional[str] = ""
    selectedText: str
    currentLine: str
    contextLines: Optional[List[str]] = []
    questionType: str = "grammar"
    customQuestion: Optional[str] = ""

@app.post("/api/ai/ask")
def ask_gemini_tutor(req: AIAskRequest):
    api_key = req.apiKey or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="請在右上方設定您的 Google Gemini API Key，或在伺服器環境變數中設定 GEMINI_API_KEY。")

    try:
        from google import genai
        client = genai.Client(api_key=api_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"初始化 Gemini Client 失敗: {str(e)}")

    context_str = "\n".join([f"- {l}" for l in req.contextLines if l])
    
    question_instruction = ""
    if req.questionType == "grammar":
        question_instruction = """請專注於【文法與動詞變化拆解】：
1. 標出選取詞彙的原型（辞書形）、詞性與所屬類別（如五段動詞、一段動詞、サ變等）。
2. 詳細逐步拆解變化流程（例如：原型 -> 連用形/て形 -> 可能形/使役/被動/否定/縮約口語）。
3. 說明這個文法句型在歌詞與日常會話中的用法與語感差別。"""
    elif req.questionType == "reading":
        question_instruction = """請專注於【讀音、振假名與發音解析】：
1. 清楚標註完整平假名與片假名拼音，並標出羅馬拼音。
2. 說明音調（Pitch Accent / 高低音聲調）或發音重音。
3. 若此處歌詞有特殊借字/當字唱法（如漢字寫『宇宙』卻唱作『そら』，或外來語諧音），請特別詳細解說其文化背景與作詞者的用意。"""
    elif req.questionType == "nuance":
        question_instruction = """請專注於【歌詞意境、語氣與文化涵義】：
1. 分析這句話在整首歌的情感流動、受格對象是誰（對自己、對戀人、對聽眾？）。
2. 解釋語氣色彩（男性用語/女性用語、口語省略、倒裝、自言自語還是強烈願望？）。
3. 用優美親切的中文字句翻譯並體會作詞者想傳達的心境。"""
    elif req.questionType == "custom":
        question_instruction = f"""使用者提出了以下特定問題：
「{req.customQuestion}」
請圍繞該問題並結合歌詞上下文，給出詳細親切的解答。"""

    system_prompt = f"""你是一位精通日語教學、語法分析與 J-POP 歌詞賞析的頂級日語家教老師。
你的目標是以親切、專業、結構清晰的【繁體中文】向日語學習者（程度約在 N4~N1）解釋歌詞中的日文。

【當前學習資訊】
- 歌曲名稱：《{req.songTitle}》{' / ' + req.artist if req.artist else ''}
- 當前歌詞行：『{req.currentLine}』
- 前後相鄰歌詞段落：
{context_str}
- 學生框選詢問的部分：【{req.selectedText}】

【回答規範】
1. 使用清晰的 Markdown 格式，運用粗體、項目清單、代碼塊或引用讓版面一目了然。
2. 語氣溫柔鼓勵，善用教學範例。
3. 對於日文漢字請適時附上振假名標註（如：笑（わら）う 或 [笑う/わらう]）。
4. 針對學生的發問任務回答：
{question_instruction}
"""

    def event_stream():
        try:
            response = client.models.generate_content_stream(
                model=req.model,
                contents=f"老師好！我在聽《{req.songTitle}》時，對歌詞中的「{req.selectedText}」有疑問，請為我解析！",
                config={"system_instruction": system_prompt}
            )
            for chunk in response:
                if chunk.text:
                    yield f"data: {json.dumps({'text': chunk.text}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as err:
            err_msg = str(err)
            print(f"Gemini streaming error: {err_msg}")
            yield f"data: {json.dumps({'error': err_msg}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

# Mount static files
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("啟動 J-Song Learn 伺服器...")
    print("請打開瀏覽器造訪: http://localhost:8000")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
