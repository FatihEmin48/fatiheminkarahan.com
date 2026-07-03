(function () {
  var STORAGE_KEY = "preferredLang";
  if (localStorage.getItem(STORAGE_KEY)) return;

  var langs = navigator.languages || [navigator.language || navigator.userLanguage || ""];
  var wantsTr = langs.some(function (l) { return /^tr\b/i.test(l); });

  if (wantsTr) {
    localStorage.setItem(STORAGE_KEY, "tr");
    window.location.replace("/tr/");
  } else {
    localStorage.setItem(STORAGE_KEY, "en");
  }
})();
