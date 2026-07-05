(function () {
  const app = document.getElementById("tomato-app");
  if (!app) return;

  const apiBase = (app.dataset.apiBase || "").replace(/\/+$/, "");
  const t = app.dataset;
  const TOKEN_KEY = "tomatoTespitToken";

  const loginPanel = document.getElementById("tomato-login");
  const detectPanel = document.getElementById("tomato-detect");
  const passwordInput = document.getElementById("tomato-password");
  const loginBtn = document.getElementById("tomato-login-btn");
  const loginStatus = document.getElementById("tomato-login-status");
  const imageInput = document.getElementById("tomato-image-input");
  const sampleBtn = document.getElementById("tomato-sample-btn");
  const statusEl = document.getElementById("tomato-status");
  const canvas = document.getElementById("tomato-canvas");
  const ctx = canvas.getContext("2d");

  const CLASS_COLORS = {
    "Tomurcuk": "#8D6E63",
    "Çiçek": "#FFF176",
    "Yeşil": "#00E676",
    "Turuncu": "#FF9100",
    "Kırmızı": "#FF1744",
  };

  function setLoginStatus(msg) {
    loginStatus.textContent = msg || "";
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  }

  function clearToken() {
    sessionStorage.removeItem(TOKEN_KEY);
  }

  function showDetectPanel() {
    loginPanel.hidden = true;
    detectPanel.hidden = false;
    setStatus(t.tStatusReady);
  }

  function showLoginPanel(message) {
    detectPanel.hidden = true;
    loginPanel.hidden = false;
    setLoginStatus(message || "");
  }

  async function login() {
    const password = passwordInput.value;
    if (!password) return;

    loginBtn.disabled = true;
    setLoginStatus("...");
    const wakeTimer = setTimeout(() => setLoginStatus(t.tStatusWaking), 4000);

    try {
      const resp = await fetch(`${apiBase}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      clearTimeout(wakeTimer);

      if (resp.status === 429) {
        setLoginStatus(t.tStatusLockedOut);
        return;
      }
      if (resp.status === 401) {
        setLoginStatus(t.tStatusWrongPassword);
        return;
      }
      if (!resp.ok) {
        setLoginStatus(t.tStatusNetworkError);
        return;
      }

      const data = await resp.json();
      setToken(data.token);
      passwordInput.value = "";
      showDetectPanel();
    } catch (err) {
      clearTimeout(wakeTimer);
      setLoginStatus(t.tStatusNetworkError);
    } finally {
      loginBtn.disabled = false;
    }
  }

  function drawImage(img) {
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function drawDetections(detections) {
    ctx.lineWidth = Math.max(2, canvas.width / 400);
    ctx.font = `${Math.max(14, canvas.width / 60)}px sans-serif`;
    ctx.textBaseline = "top";

    for (const d of detections) {
      const color = CLASS_COLORS[d.label] || "#2196F3";
      const [x1, y1, x2, y2] = d.box;
      ctx.strokeStyle = color;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const label = `${d.label} ${(d.confidence * 100).toFixed(0)}%`;
      const textWidth = ctx.measureText(label).width;
      const textHeight = Math.max(14, canvas.width / 60) + 6;
      ctx.fillStyle = color;
      ctx.fillRect(x1, Math.max(0, y1 - textHeight), textWidth + 8, textHeight);
      ctx.fillStyle = "#0b0d11";
      ctx.fillText(label, x1 + 4, Math.max(0, y1 - textHeight) + 3);
    }
  }

  async function runDetection(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    drawImage(img);
    URL.revokeObjectURL(url);

    const token = getToken();
    if (!token) {
      showLoginPanel(t.tStatusSessionExpired);
      return;
    }

    setStatus(t.tStatusAnalyzing);
    const wakeTimer = setTimeout(() => setStatus(t.tStatusWaking), 4000);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const resp = await fetch(`${apiBase}/detect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      clearTimeout(wakeTimer);

      if (resp.status === 401) {
        clearToken();
        showLoginPanel(t.tStatusSessionExpired);
        return;
      }
      if (!resp.ok) {
        setStatus(t.tStatusNetworkError);
        return;
      }

      const data = await resp.json();
      drawDetections(data.detections);
      setStatus(
        data.detections.length
          ? `${data.detections.length} ${t.tObjectsDetectedSuffix}`
          : t.tNoObjectsDetected
      );
    } catch (err) {
      clearTimeout(wakeTimer);
      setStatus(t.tStatusNetworkError);
    }
  }

  loginBtn.addEventListener("click", login);
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) runDetection(file);
  });

  sampleBtn.addEventListener("click", async () => {
    setStatus(t.tStatusAnalyzing);
    const resp = await fetch("/images/domates-ornek.jpg");
    const blob = await resp.blob();
    await runDetection(new File([blob], "ornek.jpg", { type: blob.type }));
  });

  if (getToken()) {
    showDetectPanel();
  }
})();
