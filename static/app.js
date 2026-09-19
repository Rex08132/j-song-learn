/**
 * J-Song Learn - Frontend Application Logic
 */

// Application State
const state = {
  player: null,
  isPlayerReady: false,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  currentSong: {
    id: 'lemon',
    title: 'Lemon',
    artist: '米津玄師',
    youtubeId: 'SX_ViT4Ra7k',
    offset: 0.0,
    source: 'NetEase'
  },
  lyrics: [], // [{ time: number, text: string, translation: string }]
  activeLineIndex: -1,
  offset: 0.0,
  autoScroll: true,
  selectedText: '',
  selectedLineContext: '',
  surroundingContext: [],
  lastAiResponse: '',
  lastQueryType: 'grammar',
  apiKey: localStorage.getItem('GEMINI_API_KEY') || '',
  model: localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash',
  customPrompt: localStorage.getItem('GEMINI_CUSTOM_PROMPT') || '',
  library: [],
  notes: []
};

const DEFAULT_PERSONA_PROMPT = `你是一位精通日語教學、語法分析與 J-POP 歌詞賞析的頂級日語家教老師。
你的目標是以親切、專業、結構清晰的【繁體中文】向日語學習者（程度約在 N4~N1）解釋歌詞中的日文。`;

const PROMPT_PRESETS = {
  'gentle': `你是一位溫柔親切、充滿耐心且鼓勵學生的日語家教老師。
請多用溫暖活潑的語氣，以淺顯易懂的繁體中文說明，並給予學習者滿滿的讚賞與鼓勵！`,
  'strict': `你是一位專攻 JLPT 日檢（N1/N2）的資深專業日語教授。
請以嚴謹、精準且具學術深度的方式拆解語法結構、文語古語源流、近義句型對比與文體層次。`,
  'culture': `你是一位對日本流行文化、J-POP 樂壇歷史、次文化與動漫深度熱愛的音樂日語嚮導。
在解析歌詞文法的同時，請特別著重於歌詞的押韻修辭、隱喻意境、作詞者的情感心境以及日本音樂文化背景。`
};

// Preset Songs for instant 1-click test
const PRESETS = {
  'lemon': {
    title: 'Lemon',
    artist: '米津玄師',
    youtubeId: 'SX_ViT4Ra7k',
    offset: 0.0
  },
  'idol': {
    title: 'アイドル',
    artist: 'YOASOBI',
    youtubeId: 'ZRtdQ81jPUQ',
    offset: 0.0
  },
  'pretender': {
    title: 'Pretender',
    artist: 'Official髭男dism',
    youtubeId: 'TQ8WlA2GXbk',
    offset: 0.0
  },
  'first-love': {
    title: 'First Love',
    artist: '宇多田ヒカル',
    youtubeId: 'o1sUaVJUeB0',
    offset: 0.0
  }
};

// =================== YouTube Player Integration ===================

// YouTube IFrame API Callback
window.onYouTubeIframeAPIReady = function() {
  state.player = new YT.Player('youtube-player', {
    height: '100%',
    width: '100%',
    videoId: state.currentSong.youtubeId,
    playerVars: {
      playsinline: 1,
      modestbranding: 1,
      rel: 0
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange
    }
  });
};

function onPlayerReady(event) {
  state.isPlayerReady = true;
  document.getElementById('player-placeholder')?.classList.add('hidden');
  
  // Start playback sync loop
  setInterval(updatePlaybackSync, 80);

  // Load initial lyrics for default song
  loadSongLyrics(state.currentSong.title, state.currentSong.artist);
}

function onPlayerStateChange(event) {
  const playIcon = document.getElementById('play-icon');
  if (event.data === YT.PlayerState.PLAYING) {
    state.isPlaying = true;
    if (playIcon) playIcon.setAttribute('data-lucide', 'pause');
  } else {
    state.isPlaying = false;
    if (playIcon) playIcon.setAttribute('data-lucide', 'play');
  }
  lucide.createIcons();
}

function togglePlay() {
  if (!state.player || !state.isPlayerReady) return;
  if (state.isPlaying) {
    state.player.pauseVideo();
  } else {
    state.player.playVideo();
  }
}

function seekTo(timeInSeconds) {
  if (!state.player || !state.isPlayerReady) return;
  state.player.seekTo(Math.max(0, timeInSeconds), true);
  if (!state.isPlaying) {
    state.player.playVideo();
  }
}

// Format seconds into mm:ss
function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Playback Sync & Active Lyric Highlighter
function updatePlaybackSync() {
  if (!state.player || !state.isPlayerReady) return;
  try {
    const curr = state.player.getCurrentTime() || 0;
    const dur = state.player.getDuration() || 0;
    state.currentTime = curr;
    state.duration = dur;

    const timeDisplay = document.getElementById('time-display');
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(curr)} / ${formatTime(dur)}`;
    }

    if (!state.lyrics || state.lyrics.length === 0) return;

    // Apply offset fine-tuning
    const syncTime = curr + state.offset;

    // Find current active lyric line
    let activeIdx = -1;
    for (let i = 0; i < state.lyrics.length; i++) {
      if (syncTime >= state.lyrics[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== state.activeLineIndex) {
      state.activeLineIndex = activeIdx;
      highlightActiveLyric(activeIdx);
    }
  } catch (err) {
    // Player might not be ready yet
  }
}

function highlightActiveLyric(index) {
  const container = document.getElementById('lyrics-container');
  if (!container) return;

  const lines = container.querySelectorAll('.lyric-line');
  lines.forEach((line, idx) => {
    if (idx === index) {
      line.classList.add('active');
      if (state.autoScroll) {
        // Scroll active line smoothly into center of lyrics container
        const lineTop = line.offsetTop;
        const lineHeight = line.offsetHeight;
        const containerHeight = container.clientHeight;
        const targetScroll = lineTop - (containerHeight / 2) + (lineHeight / 2);
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    } else {
      line.classList.remove('active');
    }
  });
}

// =================== Lyrics Management ===================

async function loadSongLyrics(title, artist = '') {
  const emptyView = document.getElementById('lyrics-empty');
  const countDisplay = document.getElementById('lyric-count-display');
  const badge = document.getElementById('lyrics-source-badge');

  if (countDisplay) countDisplay.textContent = '搜尋歌詞中...';

  try {
    const query = `${title} ${artist}`.trim();
    const res = await fetch(`/api/search-lyrics?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Lyrics not found');
    
    const data = await res.json();
    state.lyrics = data.lines || [];
    state.currentSong.title = data.title || title;
    state.currentSong.artist = data.artist || artist;
    state.currentSong.source = data.source || 'NetEase';

    if (badge) badge.textContent = data.source;

    renderLyrics();
    saveCurrentSongToLibrary();
  } catch (err) {
    console.warn('Could not auto-fetch lyrics:', err);
    if (countDisplay) countDisplay.textContent = '未找到自動歌詞';
    // If empty, show fallback hint
    if (emptyView) {
      emptyView.innerHTML = `
        <i data-lucide="help-circle" class="w-10 h-10 mb-2 text-slate-500"></i>
        <p class="text-sm text-slate-300 font-medium">未自動搜尋到對應歌詞</p>
        <p class="text-xs text-slate-500 mt-1">您可以點擊右上角「編輯歌詞」手動貼上</p>
      `;
      emptyView.classList.remove('hidden');
      lucide.createIcons();
    }
  }
}

function renderLyrics() {
  const container = document.getElementById('lyrics-container');
  const countDisplay = document.getElementById('lyric-count-display');
  if (!container) return;

  container.innerHTML = '';
  if (!state.lyrics || state.lyrics.length === 0) {
    if (countDisplay) countDisplay.textContent = '0 行歌詞';
    return;
  }

  if (countDisplay) countDisplay.textContent = `${state.lyrics.length} 行歌詞`;

  state.lyrics.forEach((item, idx) => {
    const lineEl = document.createElement('div');
    lineEl.className = 'lyric-line flex items-center justify-between space-x-2 group';
    lineEl.dataset.index = idx;
    lineEl.dataset.time = item.time;

    lineEl.innerHTML = `
      <div class="flex items-start space-x-3 flex-1 min-w-0">
        <span class="time-badge text-slate-500 group-hover:text-brand-400 font-mono text-[11px] mt-1 select-none tabular-nums opacity-60 group-hover:opacity-100 transition" 
              title="點擊跳轉播放">
          ${formatTime(item.time)}
        </span>
        <div class="flex-1 min-w-0">
          <p class="jp-lyric text-slate-300 text-sm md:text-base font-medium leading-relaxed tracking-wide transition select-text">
            ${escapeHtml(item.text)}
          </p>
          ${item.translation ? `
            <p class="trans-lyric text-slate-400 text-xs mt-0.5 select-text opacity-70 group-hover:opacity-100 transition">
              ${escapeHtml(item.translation)}
            </p>
          ` : ''}
        </div>
      </div>
      <button class="btn-ask-ai flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-md shrink-0 ml-2 transition border border-brand-400/30"
              title="點擊將此句填入聊天室向 AI 發問">
        <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
        <span>詢問 AI</span>
      </button>
    `;

    // Click on entire line to seek & select
    lineEl.addEventListener('click', (e) => {
      container.querySelectorAll('.lyric-line.selected').forEach(el => el.classList.remove('selected'));
      lineEl.classList.add('selected');
      seekTo(item.time - state.offset);
    });

    // "詢問 AI" button click: pastes text to chat input
    const askBtn = lineEl.querySelector('.btn-ask-ai');
    askBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.lyric-line.selected').forEach(el => el.classList.remove('selected'));
      lineEl.classList.add('selected');
      pasteLineToChat(idx);
    });

    container.appendChild(lineEl);
  });

  lucide.createIcons();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Automatically paste selected line to AI chat input
function pasteLineToChat(index) {
  const item = state.lyrics[index];
  if (!item) return;

  const text = item.text.trim();
  state.selectedText = text;
  state.selectedLineContext = text;
  
  // Surrounding 2 lines before and after as context
  const start = Math.max(0, index - 2);
  const end = Math.min(state.lyrics.length, index + 3);
  state.surroundingContext = state.lyrics.slice(start, end).map(l => l.text);

  // Automatically paste into right panel input
  const input = document.getElementById('custom-ask-input');
  if (input) {
    input.value = text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.classList.add('input-flash');
    setTimeout(() => input.classList.remove('input-flash'), 800);
  }

  // Update AI Context Box on the right
  const contextBox = document.getElementById('ai-context-box');
  const phraseEl = document.getElementById('ai-selected-phrase');
  const lineContextEl = document.getElementById('ai-line-context');
  const typeBadge = document.getElementById('ai-query-type');
  const chips = document.getElementById('ai-quick-chips');

  if (contextBox) contextBox.classList.remove('hidden');
  if (phraseEl) phraseEl.textContent = text;
  if (lineContextEl) lineContextEl.textContent = item.translation ? `中譯：${item.translation}` : `歌曲：《${state.currentSong.title}》`;
  if (typeBadge) typeBadge.textContent = '已填入聊天室';
  if (chips) chips.classList.remove('hidden');
}

// Preset prompt triggers
function askPresetPrompt(type) {
  const input = document.getElementById('custom-ask-input');
  const text = (input ? input.value : '') || state.selectedText;
  if (!text) {
    alert('請先點擊某句歌詞旁的「詢問 AI」！');
    return;
  }
  askGemini(type);
}

async function askGemini(type = 'grammar', customQuestion = '') {
  const customInput = document.getElementById('custom-ask-input');
  const queryText = customQuestion || (customInput ? customInput.value.trim() : '') || state.selectedText;
  if (!queryText) {
    alert('請先點擊某句歌詞旁的「詢問 AI」或在下方聊天室輸入問題！');
    return;
  }
  if (!state.selectedText) {
    state.selectedText = queryText;
    state.selectedLineContext = queryText;
  }

  state.lastQueryType = type;
  
  // Update Context UI box
  const contextBox = document.getElementById('ai-context-box');
  const phraseEl = document.getElementById('ai-selected-phrase');
  const lineContextEl = document.getElementById('ai-line-context');
  const typeBadge = document.getElementById('ai-query-type');
  const welcomeView = document.getElementById('ai-welcome');
  const responseBox = document.getElementById('ai-response-content');
  const loading = document.getElementById('ai-loading');
  const saveBtn = document.getElementById('btn-save-note');

  const typeLabels = {
    grammar: '文法剖析',
    reading: '假名發音',
    nuance: '歌詞意境',
    custom: '自訂提問'
  };

  if (contextBox) contextBox.classList.remove('hidden');
  if (welcomeView) welcomeView.classList.add('hidden');
  if (phraseEl) phraseEl.textContent = state.selectedText || customQuestion;
  if (lineContextEl) lineContextEl.textContent = `原句：${state.selectedLineContext || '無'}`;
  if (typeBadge) typeBadge.textContent = typeLabels[type] || '解析';

  if (responseBox) {
    responseBox.classList.remove('hidden');
    responseBox.innerHTML = '';
  }
  if (loading) loading.classList.remove('hidden');
  if (saveBtn) saveBtn.classList.add('hidden');

  state.lastAiResponse = '';

  const payload = {
    apiKey: state.apiKey,
    model: state.model || 'gemini-2.5-flash',
    customPrompt: state.customPrompt || '',
    songTitle: state.currentSong.title,
    artist: state.currentSong.artist,
    selectedText: state.selectedText || customQuestion,
    currentLine: state.selectedLineContext,
    contextLines: state.surroundingContext,
    questionType: type,
    customQuestion: customQuestion
  };

  try {
    const response = await fetch('/api/ai/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || 'Gemini API 請求失敗');
    }

    if (loading) loading.classList.add('hidden');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') break;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.text) {
              state.lastAiResponse += parsed.text;
              responseBox.innerHTML = marked.parse(state.lastAiResponse);
            } else if (parsed.error) {
              renderGeminiError(parsed.error, responseBox);
            }
          } catch (e) {
            // ignore partial json
          }
        }
      }
    }

    if (saveBtn && state.lastAiResponse) saveBtn.classList.remove('hidden');
  } catch (err) {
    if (loading) loading.classList.add('hidden');
    renderGeminiError(err.message, responseBox);
  }
}

function renderGeminiError(errorMsg, container) {
  const is403 = /PERMISSION_DENIED|403|denied access/i.test(errorMsg);

  if (is403) {
    container.innerHTML = `
      <div class="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/70 text-amber-200 text-xs space-y-3 shadow-lg">
        <div class="flex items-center space-x-2 font-bold text-amber-300 text-sm">
          <span>⚠️</span>
          <span>Google 帳號權限遭拒 (403 PERMISSION_DENIED)</span>
        </div>
        <p class="leading-relaxed text-slate-300">
          此錯誤是 Google 官方回傳的專案存取限制，通常有以下常見原因：
        </p>
        <div class="space-y-2 text-[11px] leading-relaxed text-slate-300 pl-1">
          <p><strong>1. 使用了公司或學校的 Google 帳號：</strong><br>
             企業/學校網域預設會封鎖外部 AI 專案權限。<br>
             👉 <strong class="text-white">解決方式</strong>：請改用您個人的 <span class="text-brand-400 font-mono">@gmail.com</span> 一般帳號登入申請。</p>
          <p><strong>2. 金鑰專案選錯或無權限：</strong><br>
             👉 <strong class="text-white">解決方式</strong>：請前往 <a href="https://aistudio.google.com/app/apikey" target="_blank" class="text-brand-400 underline font-semibold">Google AI Studio</a>，點擊「Create API key」，務必選擇<strong>「Create API key in new project」（在全新專案中建立金鑰）</strong>。</p>
          <p><strong>3. 嘗試切換其他模型：</strong><br>
             有時部分專案尚未開放特定預覽版模型，可以切換為 <code>Gemini 2.0 Flash</code> 或 <code>Gemini 1.5 Flash</code> 試試。</p>
        </div>
        <div class="pt-1">
          <button onclick="toggleModal('modal-settings', true)" class="w-full py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow transition">
            點此開啟設定更換 API Key 或切換模型
          </button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/50 text-rose-300 text-xs space-y-2">
        <p class="font-semibold text-sm flex items-center space-x-1.5 text-rose-200">
          <span>⚠️</span><span>呼叫 Gemini 發生錯誤</span>
        </p>
        <p class="text-rose-400 font-mono text-[11px]">${escapeHtml(errorMsg)}</p>
        ${!state.apiKey ? `
          <button onclick="toggleModal('modal-settings', true)" class="mt-2 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-medium">
            點此設定 Gemini API Key
          </button>
        ` : ''}
      </div>
    `;
  }
}

// =================== Song Library & Loading ===================

function loadPresetSong(key) {
  const preset = PRESETS[key];
  if (!preset) return;

  state.currentSong = {
    id: key,
    title: preset.title,
    artist: preset.artist,
    youtubeId: preset.youtubeId,
    offset: preset.offset || 0.0,
    source: 'NetEase'
  };
  state.offset = preset.offset || 0.0;
  updateOffsetDisplay();

  // Update UI metadata
  const titleEl = document.getElementById('current-song-title');
  const artistEl = document.getElementById('current-song-artist');
  if (titleEl) titleEl.textContent = preset.title;
  if (artistEl) artistEl.textContent = preset.artist;

  // Load video into player
  if (state.player && state.isPlayerReady) {
    state.player.loadVideoById(preset.youtubeId);
  }

  // Load lyrics
  loadSongLyrics(preset.title, preset.artist);
}

async function handleSearchLoad() {
  const input = document.getElementById('search-input');
  const query = input.value.trim();
  if (!query) return;

  // Check if it's a YouTube URL
  const isYouTube = /(?:youtu\.be\/|youtube\.com\/)/.test(query);

  if (isYouTube) {
    try {
      const res = await fetch('/api/youtube/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: query })
      });
      if (!res.ok) throw new Error('無法讀取 YouTube 影片資訊');
      const data = await res.json();
      
      const videoId = data.videoId;
      const title = data.title || 'YouTube 歌曲';
      const artist = data.author || '';

      state.currentSong = {
        id: videoId,
        title: title,
        artist: artist,
        youtubeId: videoId,
        offset: 0.0,
        source: 'NetEase'
      };
      state.offset = 0.0;
      updateOffsetDisplay();

      document.getElementById('current-song-title').textContent = title;
      document.getElementById('current-song-artist').textContent = artist;

      if (state.player && state.isPlayerReady) {
        state.player.loadVideoById(videoId);
      }

      // Try searching lyrics based on video title cleaned up
      const cleanedTitle = cleanYouTubeTitle(title);
      loadSongLyrics(cleanedTitle, artist);
    } catch (err) {
      alert(err.message);
    }
  } else {
    // Pure song title search - Unified Search (YouTube Video + Lyrics)
    const btn = document.getElementById('btn-search-load');
    const origBtnText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>搜尋中...</span>`;
    lucide.createIcons();

    try {
      const res = await fetch(`/api/search-song?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('歌曲搜尋失敗');
      const data = await res.json();

      let videoId = '';
      let songTitle = query;
      let songArtist = '';

      if (data.youtube && data.youtube.videoId) {
        videoId = data.youtube.videoId;
        songTitle = data.youtube.title || query;
        songArtist = data.youtube.author || '';

        state.currentSong.youtubeId = videoId;
        state.currentSong.id = videoId;
        state.offset = 0.0;
        updateOffsetDisplay();

        if (state.player && state.isPlayerReady) {
          state.player.loadVideoById(videoId);
        }
      }

      if (data.lyrics && data.lyrics.lines && data.lyrics.lines.length > 0) {
        state.lyrics = data.lyrics.lines;
        state.currentSong.title = data.lyrics.title || songTitle;
        state.currentSong.artist = data.lyrics.artist || songArtist;
        state.currentSong.source = data.lyrics.source || 'NetEase';

        const badge = document.getElementById('lyrics-source-badge');
        if (badge) badge.textContent = data.lyrics.source;
        renderLyrics();
      } else {
        // Fallback search lyrics
        await loadSongLyrics(query, '');
      }

      document.getElementById('current-song-title').textContent = state.currentSong.title || query;
      document.getElementById('current-song-artist').textContent = state.currentSong.artist || '';

      saveCurrentSongToLibrary();
    } catch (err) {
      console.error('Unified search error:', err);
      // Fallback
      loadSongLyrics(query, '');
      document.getElementById('current-song-title').textContent = query;
    } finally {
      if (btn) {
        btn.innerHTML = origBtnText;
        lucide.createIcons();
      }
    }
  }
}

function cleanYouTubeTitle(title) {
  // Remove brackets like [MV], (Official Music Video), 【OFFICIAL MUSIC VIDEO】
  return title
    .replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
    .replace(/official\s*music\s*video|mv|music\s*video/gi, ' ')
    .trim();
}

// Offset Fine Tuning
function updateOffsetDisplay() {
  const el = document.getElementById('offset-display');
  if (el) {
    const sign = state.offset > 0 ? '+' : '';
    el.textContent = `${sign}${state.offset.toFixed(1)}s`;
  }
}

function adjustOffset(delta) {
  state.offset = Math.round((state.offset + delta) * 10) / 10;
  updateOffsetDisplay();
  saveCurrentSongToLibrary();
}

function resetOffset() {
  state.offset = 0.0;
  updateOffsetDisplay();
  saveCurrentSongToLibrary();
}

// Save current song & lyrics to local library
async function saveCurrentSongToLibrary() {
  try {
    await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: state.currentSong.id,
        title: state.currentSong.title,
        artist: state.currentSong.artist,
        youtubeId: state.currentSong.youtubeId,
        offset: state.offset,
        lyrics: state.lyrics
      })
    });
    fetchLibrary();
  } catch (e) {
    console.error('Error saving to library:', e);
  }
}

async function fetchLibrary() {
  try {
    const res = await fetch('/api/library');
    if (res.ok) {
      state.library = await res.json();
      renderLibraryDrawer();
    }
  } catch (e) {}
}

function renderLibraryDrawer() {
  const listEl = document.getElementById('library-list');
  if (!listEl) return;

  if (!state.library || state.library.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">尚無歌曲記錄</p>';
    return;
  }

  listEl.innerHTML = state.library.map(song => `
    <div class="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-brand-500/50 transition flex items-center justify-between group">
      <div class="flex-1 min-w-0 cursor-pointer" onclick="selectLibrarySong('${song.id}')">
        <h4 class="font-semibold text-xs text-white truncate jp-text">${escapeHtml(song.title)}</h4>
        <p class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(song.artist || '未知歌手')}</p>
      </div>
      <button onclick="deleteLibrarySong('${song.id}', event)" class="p-1.5 text-slate-500 hover:text-rose-400 transition" title="從歌庫刪除">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
      </button>
    </div>
  `).join('');

  lucide.createIcons();
}

function selectLibrarySong(id) {
  const song = state.library.find(s => s.id === id);
  if (!song) return;

  state.currentSong = song;
  state.offset = song.offset || 0.0;
  updateOffsetDisplay();

  document.getElementById('current-song-title').textContent = song.title;
  document.getElementById('current-song-artist').textContent = song.artist || '';

  if (state.player && state.isPlayerReady && song.youtubeId) {
    state.player.loadVideoById(song.youtubeId);
  }

  if (song.lyrics && song.lyrics.length > 0) {
    state.lyrics = song.lyrics;
    renderLyrics();
  } else {
    loadSongLyrics(song.title, song.artist);
  }

  toggleDrawer('drawer-library', false);
}

async function deleteLibrarySong(id, event) {
  event.stopPropagation();
  try {
    await fetch(`/api/library/${id}`, { method: 'DELETE' });
    fetchLibrary();
  } catch (e) {}
}

// =================== Vocab Notes Management ===================

async function fetchNotes() {
  try {
    const res = await fetch('/api/notes');
    if (res.ok) {
      state.notes = await res.json();
      updateNotesBadge();
      renderNotesDrawer();
    }
  } catch (e) {}
}

function updateNotesBadge() {
  const badge = document.getElementById('notes-badge');
  const total = document.getElementById('notes-total-count');
  const count = state.notes ? state.notes.length : 0;
  if (badge) badge.textContent = count;
  if (total) total.textContent = `已收藏 ${count} 個項目`;
}

async function saveCurrentNote() {
  if (!state.selectedText || !state.lastAiResponse) return;

  const payload = {
    word: state.selectedText,
    reading: '',
    explanation: state.lastAiResponse,
    songTitle: state.currentSong.title,
    lineContext: state.selectedLineContext
  };

  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const saveBtn = document.getElementById('btn-save-note');
      if (saveBtn) {
        saveBtn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-400"></i><span>已收藏！</span>`;
        lucide.createIcons();
        setTimeout(() => {
          saveBtn.innerHTML = `<i data-lucide="bookmark-plus" class="w-3.5 h-3.5"></i><span>收藏筆記</span>`;
          lucide.createIcons();
        }, 2000);
      }
      fetchNotes();
    }
  } catch (e) {
    alert('儲存生詞失敗: ' + e.message);
  }
}

function renderNotesDrawer() {
  const listEl = document.getElementById('notes-list');
  if (!listEl) return;

  if (!state.notes || state.notes.length === 0) {
    listEl.innerHTML = '<p class="text-xs text-slate-500 text-center py-6">尚未加入生詞與筆記</p>';
    return;
  }

  listEl.innerHTML = state.notes.map(note => `
    <div class="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs">
      <div class="flex items-center justify-between">
        <h4 class="font-bold text-sm text-brand-300 jp-text">${escapeHtml(note.word)}</h4>
        <div class="flex items-center space-x-1">
          <span class="text-[10px] text-slate-500 font-mono">${escapeHtml(note.songTitle)}</span>
          <button onclick="deleteNote('${note.id}')" class="p-1 text-slate-500 hover:text-rose-400 transition">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
      ${note.lineContext ? `<div class="p-1.5 rounded bg-slate-900 text-slate-400 italic text-[11px] jp-text">「${escapeHtml(note.lineContext)}」</div>` : ''}
      <div class="markdown-body text-slate-300 text-xs max-h-40 overflow-y-auto pr-1">
        ${marked.parse(note.explanation)}
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

async function deleteNote(id) {
  try {
    await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    fetchNotes();
  } catch (e) {}
}

function exportNotesToAnki() {
  if (!state.notes || state.notes.length === 0) {
    alert('目前生詞本中沒有任何項目！');
    return;
  }

  // Generate CSV format: Front, Back, Tags
  let csvContent = "\uFEFF"; // UTF-8 BOM
  csvContent += "單字,解析與上下文,歌曲名稱\n";

  state.notes.forEach(note => {
    const front = `"${note.word.replace(/"/g, '""')}"`;
    const back = `"${note.explanation.replace(/"/g, '""')}\n\n[歌詞出處] ${note.lineContext.replace(/"/g, '""')}"`;
    const tag = `"${note.songTitle.replace(/"/g, '""')}"`;
    csvContent += `${front},${back},${tag}\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `JSong_Notes_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// =================== Modal / Drawer Handlers ===================

function toggleModal(modalId, show) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  if (show) modal.classList.remove('hidden');
  else modal.classList.add('hidden');
}

function toggleDrawer(drawerId, show) {
  const drawer = document.getElementById(drawerId);
  if (!drawer) return;
  if (show) drawer.classList.remove('hidden');
  else drawer.classList.add('hidden');
}

// =================== Initialization ===================

document.addEventListener('DOMContentLoaded', () => {
  fetchLibrary();
  fetchNotes();

  // Search Load Button
  document.getElementById('btn-search-load')?.addEventListener('click', handleSearchLoad);
  document.getElementById('search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearchLoad();
  });

  // Play/Pause Button
  document.getElementById('btn-toggle-play')?.addEventListener('click', togglePlay);

  // Offset Buttons
  document.getElementById('btn-offset-plus')?.addEventListener('click', () => adjustOffset(0.5));
  document.getElementById('btn-offset-minus')?.addEventListener('click', () => adjustOffset(-0.5));
  document.getElementById('btn-offset-reset')?.addEventListener('click', resetOffset);

  // Auto Scroll checkbox
  document.getElementById('chk-autoscroll')?.addEventListener('change', (e) => {
    state.autoScroll = e.target.checked;
  });

  // Drawer / Modal buttons
  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    const input = document.getElementById('input-api-key');
    const select = document.getElementById('select-model');
    const promptInput = document.getElementById('input-custom-prompt');
    if (input) input.value = state.apiKey;
    if (select) select.value = state.model || 'gemini-2.5-flash';
    if (promptInput) promptInput.value = state.customPrompt || DEFAULT_PERSONA_PROMPT;
    toggleModal('modal-settings', true);
  });

  // Prompt Preset Badges
  document.querySelectorAll('.prompt-preset-badge').forEach(btn => {
    btn.addEventListener('click', () => {
      const styleKey = btn.dataset.style;
      const promptInput = document.getElementById('input-custom-prompt');
      if (promptInput && PROMPT_PRESETS[styleKey]) {
        promptInput.value = PROMPT_PRESETS[styleKey];
      }
    });
  });

  // Reset Prompt Button
  document.getElementById('btn-reset-prompt')?.addEventListener('click', () => {
    const promptInput = document.getElementById('input-custom-prompt');
    if (promptInput) {
      promptInput.value = DEFAULT_PERSONA_PROMPT;
    }
  });

  document.getElementById('btn-save-api-key')?.addEventListener('click', () => {
    const input = document.getElementById('input-api-key');
    const select = document.getElementById('select-model');
    const promptInput = document.getElementById('input-custom-prompt');
    state.apiKey = input ? input.value.trim() : '';
    state.model = select ? select.value : 'gemini-2.5-flash';
    state.customPrompt = promptInput ? promptInput.value.trim() : '';
    localStorage.setItem('GEMINI_API_KEY', state.apiKey);
    localStorage.setItem('GEMINI_MODEL', state.model);
    localStorage.setItem('GEMINI_CUSTOM_PROMPT', state.customPrompt);
    toggleModal('modal-settings', false);
    alert('Gemini API Key、模型與自訂人設已成功儲存！');
  });

  document.getElementById('btn-open-notes')?.addEventListener('click', () => {
    toggleDrawer('drawer-notes', true);
  });

  document.getElementById('btn-open-library')?.addEventListener('click', () => {
    toggleDrawer('drawer-library', true);
  });

  document.getElementById('btn-export-anki')?.addEventListener('click', exportNotesToAnki);
  document.getElementById('btn-save-note')?.addEventListener('click', saveCurrentNote);

  // Custom question send button
  document.getElementById('btn-custom-send')?.addEventListener('click', () => {
    const input = document.getElementById('custom-ask-input');
    const q = input.value.trim();
    if (!q) return;
    askGemini('custom', q);
    input.value = '';
  });

  document.getElementById('custom-ask-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        // Shift + Enter 保持預設行為（插入換行）
        return;
      }
      // 單純 Enter 則送出訊息
      e.preventDefault();
      const q = e.target.value.trim();
      if (!q) return;
      askGemini('custom', q);
      e.target.value = '';
    }
  });

  // Manual Lyrics Modal
  document.getElementById('btn-manual-lyrics')?.addEventListener('click', () => {
    const textarea = document.getElementById('input-manual-lyrics');
    // Fill with current lyrics in LRC format if available
    if (state.lyrics && state.lyrics.length > 0) {
      textarea.value = state.lyrics.map(l => `[${formatTime(l.time)}]${l.text}`).join('\n');
    }
    toggleModal('modal-manual-lyrics', true);
  });

  document.getElementById('btn-apply-manual-lyrics')?.addEventListener('click', () => {
    const text = document.getElementById('input-manual-lyrics').value.trim();
    if (!text) return;
    
    // Parse text (LRC format or lines)
    const lines = text.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]/;

    let autoTime = 0;
    for (const line of lines) {
      const m = line.match(timeRegex);
      if (m) {
        const min = parseInt(m[1], 10);
        const sec = parseFloat(m[2]);
        const clean = line.replace(timeRegex, '').trim();
        parsed.push({ time: Math.round((min * 60 + sec) * 100) / 100, text: clean, translation: '' });
      } else if (line.trim()) {
        // Plain text line with estimated timestamp
        parsed.push({ time: autoTime, text: line.trim(), translation: '' });
        autoTime += 3.5;
      }
    }

    if (parsed.length > 0) {
      state.lyrics = parsed;
      renderLyrics();
      saveCurrentSongToLibrary();
      toggleModal('modal-manual-lyrics', false);
    }
  });
});
