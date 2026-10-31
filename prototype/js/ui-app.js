/* 入口：读设置，切换「完整一局」和「战斗沙盒」两种模式。 */
(function () {
  "use strict";
  const QW = window.QW;
  const U = QW.ui;
  U.S.set = U.loadSettings();

  function setMode(mode) {
    U.S.set.mode = mode;
    U.saveSettings();
    document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    if (mode === "run") QW.ui.run.show(); else QW.ui.sandbox.show();
    window.scrollTo(0, 0);
  }

  document.querySelector(".modes").addEventListener("click", ev => {
    const b = ev.target.closest("[data-mode]");
    if (b && b.getAttribute("aria-pressed") !== "true") setMode(b.dataset.mode);
  });
  setMode(U.S.set.mode);
})();
