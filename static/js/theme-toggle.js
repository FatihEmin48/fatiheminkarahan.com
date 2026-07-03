(function () {
  var STORAGE_KEY = "colorscheme";
  var body = document.body;
  var toggle = document.getElementById("theme-toggle");
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  function applyScheme(scheme) {
    body.classList.remove("colorscheme-light", "colorscheme-dark", "colorscheme-auto");
    body.classList.add("colorscheme-" + scheme);
  }

  var stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    applyScheme(stored);
  }

  media.addEventListener("change", function () {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyScheme("auto");
    }
  });

  if (toggle) {
    toggle.addEventListener("click", function () {
      var isDark = body.classList.contains("colorscheme-dark") ||
        (body.classList.contains("colorscheme-auto") && media.matches);
      var next = isDark ? "light" : "dark";
      applyScheme(next);
      localStorage.setItem(STORAGE_KEY, next);
    });
  }
})();
