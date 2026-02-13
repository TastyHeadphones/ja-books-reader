import "./style.css";

const BOOK_DATA_PATH = "/data/book.json";

const STORAGE_KEYS = {
  apiKey: "ja-reader-google-tts-key",
  voice: "ja-reader-google-tts-voice",
  speed: "ja-reader-google-tts-speed",
  chapter: "ja-reader-chapter-index"
};

const VOICES = [
  { value: "ja-JP-Neural2-B", label: "Neural2 B (female)" },
  { value: "ja-JP-Neural2-C", label: "Neural2 C (male)" },
  { value: "ja-JP-Neural2-D", label: "Neural2 D (female)" },
  { value: "ja-JP-Standard-A", label: "Standard A" },
  { value: "ja-JP-Wavenet-B", label: "Wavenet B" }
];

const state = {
  book: null,
  chapterIndex: 0,
  renderToken: 0,
  apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || "",
  voice: localStorage.getItem(STORAGE_KEYS.voice) || VOICES[0].value,
  speed: Number(localStorage.getItem(STORAGE_KEYS.speed) || "1"),
  playbackToken: 0,
  audio: new Audio(),
  activeSentenceButton: null,
  audioCache: new Map()
};

const elements = {
  bookTitle: document.querySelector("#book-title"),
  bookSubtitle: document.querySelector("#book-subtitle"),
  chapterCount: document.querySelector("#chapter-count"),
  chapterList: document.querySelector("#chapter-list"),
  chapterTitle: document.querySelector("#chapter-title"),
  readerContent: document.querySelector("#reader-content"),
  statusText: document.querySelector("#status-text"),
  apiKeyInput: document.querySelector("#api-key-input"),
  voiceSelect: document.querySelector("#voice-select"),
  speedRange: document.querySelector("#speed-range"),
  speedValue: document.querySelector("#speed-value"),
  stopButton: document.querySelector("#stop-button")
};

bootstrap().catch((error) => {
  console.error(error);
  setStatus(`初始化失败: ${error.message}`);
});

async function bootstrap() {
  initControls();
  setStatus("正在加载书籍...");

  const book = await loadBookData();
  state.book = book;

  elements.bookTitle.textContent = book.title;
  const creatorText = book.creators?.length ? book.creators.join(" / ") : "未知作者";
  elements.bookSubtitle.textContent = `${creatorText} · ${book.language || "ja"}`;
  elements.chapterCount.textContent = `${book.chapterCount} 节`;

  renderChapterList();

  const savedChapter = Number(localStorage.getItem(STORAGE_KEYS.chapter) || "0");
  const initialChapter = Number.isInteger(savedChapter) && savedChapter >= 0 ? savedChapter : 0;
  await renderChapter(clamp(initialChapter, 0, book.chapters.length - 1));

  setStatus("已就绪。点击任意句子即可朗读。");
}

function initControls() {
  elements.apiKeyInput.value = state.apiKey;
  elements.apiKeyInput.addEventListener("input", (event) => {
    state.apiKey = event.target.value.trim();
    localStorage.setItem(STORAGE_KEYS.apiKey, state.apiKey);
  });

  for (const voice of VOICES) {
    const option = document.createElement("option");
    option.value = voice.value;
    option.textContent = voice.label;
    elements.voiceSelect.appendChild(option);
  }

  elements.voiceSelect.value = state.voice;
  elements.voiceSelect.addEventListener("change", (event) => {
    state.voice = event.target.value;
    localStorage.setItem(STORAGE_KEYS.voice, state.voice);
  });

  const safeSpeed = clamp(Number.isFinite(state.speed) ? state.speed : 1, 0.75, 1.25);
  state.speed = safeSpeed;
  elements.speedRange.value = String(safeSpeed);
  elements.speedValue.textContent = `${safeSpeed.toFixed(2)}x`;
  elements.speedRange.addEventListener("input", (event) => {
    state.speed = clamp(Number(event.target.value), 0.75, 1.25);
    elements.speedValue.textContent = `${state.speed.toFixed(2)}x`;
    localStorage.setItem(STORAGE_KEYS.speed, String(state.speed));
  });

  elements.stopButton.addEventListener("click", () => {
    stopPlayback();
    setStatus("播放已停止。");
  });

  state.audio.preload = "auto";
  state.audio.addEventListener("ended", () => {
    clearSentenceHighlight();
    setStatus("播放完成。");
  });
  state.audio.addEventListener("error", () => {
    clearSentenceHighlight();
    setStatus("音频播放失败，请重试。");
  });
}

async function loadBookData() {
  const response = await fetch(BOOK_DATA_PATH);
  if (!response.ok) {
    throw new Error(`读取 book.json 失败 (${response.status})`);
  }

  return response.json();
}

function renderChapterList() {
  elements.chapterList.replaceChildren();

  state.book.chapters.forEach((chapter, index) => {
    const button = document.createElement("button");
    button.className = "chapter-button";
    button.type = "button";
    button.textContent = chapter.title;
    button.dataset.index = String(index);
    button.addEventListener("click", () => {
      renderChapter(index).catch((error) => {
        setStatus(`章节渲染失败: ${error.message}`);
      });
    });
    elements.chapterList.appendChild(button);
  });
}

async function renderChapter(chapterIndex) {
  const chapter = state.book.chapters[chapterIndex];
  if (!chapter) {
    return;
  }

  state.chapterIndex = chapterIndex;
  localStorage.setItem(STORAGE_KEYS.chapter, String(chapterIndex));
  clearSentenceHighlight();
  stopPlayback(false);

  elements.chapterTitle.textContent = chapter.title;
  elements.readerContent.replaceChildren();

  for (const button of elements.chapterList.querySelectorAll(".chapter-button")) {
    button.classList.toggle("active", Number(button.dataset.index) === chapterIndex);
  }

  const renderToken = ++state.renderToken;
  setStatus(`正在渲染章节：${chapter.title}`);

  const paragraphRows = getParagraphRows(chapter);
  const chunkSize = 8;

  for (let start = 0; start < paragraphRows.length; start += chunkSize) {
    if (renderToken !== state.renderToken) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const end = Math.min(start + chunkSize, paragraphRows.length);

    for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
      const row = paragraphRows[rowIndex];
      if (row.length === 0) {
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.className = "paragraph";

      for (const sentence of row) {
        const sentenceButton = document.createElement("button");
        sentenceButton.className = "sentence";
        sentenceButton.type = "button";
        sentenceButton.dataset.text = sentence.text;
        sentenceButton.innerHTML = sentence.rubyHtml || escapeHtml(sentence.text);
        sentenceButton.addEventListener("click", () =>
          handleSentenceClick(sentenceButton, sentence.text)
        );
        paragraph.appendChild(sentenceButton);
      }

      fragment.appendChild(paragraph);
    }

    elements.readerContent.appendChild(fragment);
    await nextFrame();
  }

  if (renderToken === state.renderToken) {
    setStatus(`已加载章节：${chapter.title}`);
  }
}

function getParagraphRows(chapter) {
  const fromData = chapter.paragraphSentences;
  if (
    Array.isArray(fromData) &&
    fromData.length === chapter.paragraphs.length &&
    fromData.every((row) => Array.isArray(row))
  ) {
    return fromData
      .map((row) =>
        row
          .map((sentence) => ({
            text: String(sentence?.text || "").trim(),
            rubyHtml: String(sentence?.rubyHtml || "").trim()
          }))
          .filter((sentence) => sentence.text)
      )
      .filter((row) => row.length > 0);
  }

  return chapter.paragraphs
    .map((paragraphText) =>
      splitSentences(paragraphText).map((sentenceText) => ({
        text: sentenceText,
        rubyHtml: escapeHtml(sentenceText)
      }))
    )
    .filter((row) => row.length > 0);
}

function splitSentences(paragraphText) {
  const normalized = String(paragraphText || "").trim();
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/[^。！？!?]+[。！？!?]?/g);
  if (!matches) {
    return [normalized];
  }

  return matches.map((sentence) => sentence.trim()).filter(Boolean);
}

async function handleSentenceClick(sentenceButton, sentenceText) {
  if (!state.apiKey) {
    elements.apiKeyInput.focus();
    setStatus("请先输入 Google Cloud API Key。");
    return;
  }

  const token = ++state.playbackToken;
  setSentenceHighlight(sentenceButton);
  sentenceButton.classList.add("loading");
  setStatus("正在请求 Google TTS...");

  try {
    const audioUrl = await getSentenceAudioUrl(sentenceText);
    if (token !== state.playbackToken) {
      return;
    }

    await playAudio(audioUrl);
    if (token === state.playbackToken) {
      setStatus(`正在播放：${truncate(sentenceText, 28)}`);
    }
  } catch (error) {
    if (token === state.playbackToken) {
      clearSentenceHighlight();
      setStatus(error.message || "朗读失败，请重试。");
    }
  } finally {
    sentenceButton.classList.remove("loading");
  }
}

async function getSentenceAudioUrl(sentenceText) {
  const cacheKey = `${state.voice}|${state.speed.toFixed(2)}|${sentenceText}`;
  if (state.audioCache.has(cacheKey)) {
    return state.audioCache.get(cacheKey);
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(state.apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        input: { text: sentenceText },
        voice: {
          languageCode: "ja-JP",
          name: state.voice
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: state.speed
        }
      })
    }
  );

  const payload = await response.json();
  if (!response.ok) {
    const apiMessage = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Google TTS 失败：${apiMessage}`);
  }

  if (!payload.audioContent) {
    throw new Error("Google TTS 未返回音频内容。");
  }

  const audioUrl = base64Mp3ToObjectUrl(payload.audioContent);
  state.audioCache.set(cacheKey, audioUrl);
  trimAudioCache();
  return audioUrl;
}

async function playAudio(audioUrl) {
  state.audio.pause();
  state.audio.currentTime = 0;
  state.audio.src = audioUrl;
  await state.audio.play();
}

function stopPlayback(clearHighlight = true) {
  state.playbackToken += 1;
  state.audio.pause();
  state.audio.currentTime = 0;

  if (clearHighlight) {
    clearSentenceHighlight();
  }
}

function setSentenceHighlight(sentenceButton) {
  clearSentenceHighlight();
  state.activeSentenceButton = sentenceButton;
  sentenceButton.classList.add("active");
}

function clearSentenceHighlight() {
  if (!state.activeSentenceButton) {
    return;
  }

  state.activeSentenceButton.classList.remove("active");
  state.activeSentenceButton.classList.remove("loading");
  state.activeSentenceButton = null;
}

function trimAudioCache(maxItems = 72) {
  while (state.audioCache.size > maxItems) {
    const oldestKey = state.audioCache.keys().next().value;
    const oldUrl = state.audioCache.get(oldestKey);
    state.audioCache.delete(oldestKey);
    URL.revokeObjectURL(oldUrl);
  }
}

function base64Mp3ToObjectUrl(base64Content) {
  const binaryString = atob(base64Content);
  const length = binaryString.length;
  const bytes = new Uint8Array(length);

  for (let index = 0; index < length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  const blob = new Blob([bytes], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

