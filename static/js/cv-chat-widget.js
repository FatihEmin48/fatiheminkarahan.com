import { pipeline, cos_sim, env } from "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

env.allowLocalModels = false;

const CATEGORY_KEYWORDS = {
  "İletişim": ["iletişim", "telefon", "e-posta", "eposta", "email", "mail", "linkedin", "github", "ulaş", "scholar", "medium"],
  "Eğitim": ["eğitim", "okul", "üniversite", "lisans", "yüksek lisans", "mezun", "formasyon", "okuyor", "okudu"],
  "Teknik Yetenekler": ["beceri", "yetenek", "teknoloji", "araç", "programlama dil", "hangi dil", "kullandığı dil", "hakim"],
  "Mesleki Deneyim": ["deneyim", "iş yeri", "şirket", "firma", "kariyer", "staj", "işe girdi"],
  "Projeler": ["proje", "geliştirdiği proje", "hangi projelerde"],
  "Yayınlar": ["yayın", "makale", "publication", "dergi", "doi", "bilimsel"],
  "Referans": ["referans", "danışman", "tavsiye mektubu"],
  "Hakkımda": ["hakkında kim", "kimdir", "kendini tanıt", "biyografi"],
};

function matchCategories(question) {
  const q = question.toLocaleLowerCase("tr-TR");
  return Object.entries(CATEGORY_KEYWORDS)
    .filter(([, keywords]) => keywords.some((k) => q.includes(k)))
    .map(([category]) => category);
}

const LINK_PATTERN =
  /(https?:\/\/[^\s)]+|(?:www\.)?(?:linkedin\.com|github\.com|scholar\.google\.com|medium\.com|doi\.org)\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+|\+\d[\d\s]{8,}\d)/g;

function renderMessageContent(el, text) {
  el.textContent = "";
  let lastIndex = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const offset = match.index;
    if (offset > lastIndex) {
      el.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
    }
    const raw = match[0];
    const trimmed = raw.replace(/[.,;:)]+$/, "");
    const trailing = raw.slice(trimmed.length);

    const a = document.createElement("a");
    a.textContent = trimmed;
    a.target = "_blank";
    a.rel = "noopener";
    if (/^https?:\/\//.test(trimmed)) {
      a.href = trimmed;
    } else if (/^(www\.)?(linkedin\.com|github\.com|scholar\.google\.com|medium\.com|doi\.org)\//.test(trimmed)) {
      a.href = `https://${trimmed}`;
    } else if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(trimmed)) {
      a.href = `mailto:${trimmed}`;
    } else if (/^\+\d/.test(trimmed)) {
      a.href = `tel:${trimmed.replace(/\s+/g, "")}`;
    } else {
      a.href = `https://${trimmed}`;
    }
    el.appendChild(a);
    if (trailing) el.appendChild(document.createTextNode(trailing));
    lastIndex = offset + raw.length;
  }
  if (lastIndex < text.length) {
    el.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

const toggleBtn = document.getElementById("cv-chat-toggle");
const closeBtn = document.getElementById("cv-chat-close");
const panel = document.getElementById("cv-chat-panel");
const statusEl = document.getElementById("cv-chat-status");
const messagesEl = document.getElementById("cv-chat-messages");
const formEl = document.getElementById("cv-chat-form");
const inputEl = document.getElementById("cv-chat-input");
const submitBtn = formEl.querySelector("button");

let extractor;
let kb = [];
let kbEmbeddings = [];
let initStarted = false;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `cv-chat-msg ${role}`;
  if (role === "bot") {
    renderMessageContent(div, text);
  } else {
    div.textContent = text;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function embed(text) {
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function init() {
  if (initStarted) return;
  initStarted = true;
  try {
    setStatus("CV bilgi tabanı yükleniyor...");
    const res = await fetch("/data/cv-kb.json");
    kb = await res.json();

    setStatus("Yapay zeka modeli tarayıcınıza indiriliyor (ilk seferde ~25MB, sonrasında önbellekten anında yüklenir)...");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

    setStatus("CV içeriği analiz ediliyor...");
    kbEmbeddings = [];
    for (const item of kb) {
      kbEmbeddings.push(await embed(`${item.category}. ${item.text}`));
    }

    setStatus("Hazır. Benimle ilgili bir soru sorabilirsin.");
    inputEl.disabled = false;
    submitBtn.disabled = false;
    inputEl.focus();
  } catch (err) {
    console.error(err);
    setStatus("Model yüklenirken bir sorun oluştu. Sayfayı yenilemeyi deneyin.");
  }
}

async function answer(question) {
  const matchedCats = matchCategories(question);

  if (matchedCats.length === 0) {
    return "Bu konuyla ilgili CV'de bir bilgi bulamadım. Eğitim, iş deneyimi, projeler, teknik beceriler, yayınlar veya iletişim hakkında soru sorabilirsin.";
  }

  const qVec = await embed(question);
  const pool = kb.map((item, i) => ({ item, i })).filter(({ item }) => matchedCats.includes(item.category));

  const scored = pool.map(({ item, i }) => ({
    item,
    score: cos_sim(qVec, kbEmbeddings[i]),
  }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, Math.min(scored.length, 4));

  const groups = new Map();
  for (const s of top) {
    if (!groups.has(s.item.category)) groups.set(s.item.category, []);
    groups.get(s.item.category).push(s.item.text);
  }

  return [...groups.entries()]
    .map(([category, texts]) => `${category.toUpperCase()}\n${texts.map((t) => `• ${t}`).join("\n\n")}`)
    .join("\n\n");
}

async function handleQuestion(question) {
  addMessage("user", question);
  const pending = addMessage("bot", "Düşünüyorum...");
  try {
    const reply = await answer(question);
    renderMessageContent(pending, reply);
  } catch (err) {
    console.error(err);
    renderMessageContent(pending, "Bir hata oluştu, tekrar dener misin?");
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const question = inputEl.value.trim();
  if (!question) return;
  inputEl.value = "";
  handleQuestion(question);
});

document.querySelectorAll("#cv-chat-panel .cv-chat-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (inputEl.disabled) return;
    handleQuestion(chip.dataset.q);
  });
});

toggleBtn.addEventListener("click", () => {
  const isOpen = panel.classList.toggle("open");
  toggleBtn.setAttribute("aria-expanded", String(isOpen));
  panel.hidden = !isOpen;
  if (isOpen) {
    init();
  }
});

closeBtn.addEventListener("click", () => {
  panel.classList.remove("open");
  panel.hidden = true;
  toggleBtn.setAttribute("aria-expanded", "false");
});
