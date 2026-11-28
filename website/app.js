(function () {
  "use strict";

  // --------------------------------------------------------------------------
  // 1. 主题模式：默认完全跟随浏览器 prefers-color-scheme，支持手动切换（跟随系统 / 浅色 / 深色）
  // --------------------------------------------------------------------------
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme-btn");
  const themeIcon = document.getElementById("theme-icon");
  const themeText = document.getElementById("theme-text");

  const modes = ["system", "light", "dark"];
  const modeMeta = {
    system: { label: "跟随系统", icon: "#px-theme-auto" },
    light: { label: "浅色", icon: "#px-sun" },
    dark: { label: "深色", icon: "#px-moon" }
  };

  let currentMode = "system";

  try {
    localStorage.removeItem("rg-site-theme");
    const saved = localStorage.getItem("rg-theme-mode");
    if (saved === "light" || saved === "dark" || saved === "system") {
      currentMode = saved;
    }
  } catch {
    // 忽略本地存储受限场景
  }

  function applyThemeMode(mode) {
    currentMode = mode;
    if (mode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", mode);
    }

    const meta = modeMeta[mode] || modeMeta.system;
    if (themeText) themeText.textContent = meta.label;
    if (themeIcon) themeIcon.setAttribute("href", meta.icon);

    try {
      if (mode === "system") {
        localStorage.removeItem("rg-theme-mode");
      } else {
        localStorage.setItem("rg-theme-mode", mode);
      }
    } catch {
      // 忽略本地存储受限场景
    }
  }

  applyThemeMode(currentMode);

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const next = modes[(modes.indexOf(currentMode) + 1) % modes.length];
      applyThemeMode(next);
    });
  }

  // --------------------------------------------------------------------------
  // 2. 工作台界面预览切换与大图弹层
  // --------------------------------------------------------------------------
  const showcaseImg = document.getElementById("showcase-img");
  const showcaseTitle = document.getElementById("showcase-title");
  const showcaseDesc = document.getElementById("showcase-desc");
  const zoomShotBtn = document.getElementById("zoom-shot-btn");

  const lightbox = document.getElementById("lightbox");
  const lightboxMask = document.getElementById("lightbox-mask");
  const lightboxClose = document.getElementById("lightbox-close");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxTitle = document.getElementById("lightbox-title");

  document.querySelectorAll(".sc-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const shot = tab.getAttribute("data-shot");
      const title = tab.getAttribute("data-title");
      const desc = tab.getAttribute("data-desc");

      document.querySelectorAll(".sc-tab").forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", String(active));
      });

      if (showcaseImg && shot) {
        showcaseImg.src = shot;
        showcaseImg.alt = title || "Resume Grill 工作台截图";
      }
      if (showcaseTitle && title) showcaseTitle.textContent = title;
      if (showcaseDesc && desc) showcaseDesc.textContent = desc;
    });
  });

  function closeLightbox() {
    if (lightbox) lightbox.hidden = true;
  }

  if (zoomShotBtn && lightbox && lightboxImg) {
    zoomShotBtn.addEventListener("click", () => {
      if (showcaseImg) {
        lightboxImg.src = showcaseImg.src;
        lightboxImg.alt = showcaseImg.alt;
      }
      if (lightboxTitle && showcaseTitle) {
        lightboxTitle.textContent = showcaseTitle.textContent;
      }
      lightbox.hidden = false;
    });
  }

  if (lightboxClose) lightboxClose.addEventListener("click", closeLightbox);
  if (lightboxMask) lightboxMask.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox && !lightbox.hidden) {
      closeLightbox();
    }
  });

  // --------------------------------------------------------------------------
  // 3. 安装说明与 MCP 配置标签页切换
  // --------------------------------------------------------------------------
  document.querySelectorAll(".inst-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const paneKey = tab.getAttribute("data-pane");
      document.querySelectorAll(".inst-tab").forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".inst-body").forEach((body) => {
        const isMatch = body.id === `pane-${paneKey}`;
        body.classList.toggle("active", isMatch);
        body.hidden = !isMatch;
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. 代码块一键复制
  // --------------------------------------------------------------------------
  const toast = document.getElementById("copy-toast");
  let toastTimer = null;

  function showCopyToast(text) {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2000);
  }

  document.querySelectorAll(".copy-trigger").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-target");
      const pre = targetId ? document.getElementById(targetId) : null;
      if (!pre) return;
      const content = (pre.textContent || "").trim();

      try {
        await navigator.clipboard.writeText(content);
        showCopyToast("已复制到剪贴板");
      } catch {
        const area = document.createElement("textarea");
        area.value = content;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        showCopyToast("已复制到剪贴板");
      }
    });
  });
})();
