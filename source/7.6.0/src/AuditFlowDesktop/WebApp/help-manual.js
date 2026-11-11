(() => {
  "use strict";

  const VERSION = "7.6.0";
  const englishOnly = window.AuditFlowEnglishOnly === true || window.AuditFlowEnglishOnly === "true";
  const languageKey = "auditflow-manual-language";

  function workspaceLanguage() {
    try {
      const stored = JSON.parse(localStorage.getItem("auditflow-ai-workspace-v1") || "null");
      return stored?.settings?.language === "en" ? "en" : "zh-CN";
    } catch (_) {
      return "zh-CN";
    }
  }

  function languageFromStorage() {
    if (englishOnly) return "en";
    try {
      const stored = localStorage.getItem(languageKey);
      if (stored === "en" || stored === "zh-CN") return stored;
    } catch (_) {
      // A restricted browser storage context should still render the manual.
    }
    return workspaceLanguage();
  }

  function applyLanguage(language) {
    const value = englishOnly ? "en" : language === "en" ? "en" : "zh-CN";
    document.documentElement.lang = value;
    document.documentElement.classList.toggle("manual-lang-en", value === "en");
    document.querySelectorAll("[data-manual-lang]").forEach(button => {
      const active = button.dataset.manualLang === value;
      button.setAttribute("aria-pressed", String(active));
      button.disabled = englishOnly;
    });
    document.title = value === "en"
      ? `JEAuditFlow ${VERSION} Assessor User Manual`
      : `JEAuditFlow ${VERSION} 操作手册`;
    try {
      if (!englishOnly) localStorage.setItem(languageKey, value);
    } catch (_) {
      // Keep switching functional when persistence is unavailable.
    }
  }

  function setupSearch() {
    const input = document.getElementById("manualSearch");
    const clear = document.getElementById("clearManualSearch");
    const navLinks = [...document.querySelectorAll(".manual-nav a")];
    const sections = [...document.querySelectorAll("main section[id]")];
    const update = () => {
      const query = String(input?.value || "").trim().toLowerCase();
      sections.forEach(section => {
        section.hidden = !!query && !section.textContent.toLowerCase().includes(query);
      });
      navLinks.forEach(link => {
        const section = document.querySelector(link.getAttribute("href"));
        link.hidden = !!query && !!section?.hidden;
      });
    };
    input?.addEventListener("input", update);
    clear?.addEventListener("click", () => {
      if (!input) return;
      input.value = "";
      update();
      input.focus();
    });
  }

  function setupNavigation() {
    const links = [...document.querySelectorAll(".manual-nav a")];
    const sections = [...document.querySelectorAll("main section[id]")];
    const markActive = () => {
      const offset = window.scrollY + 110;
      let active = sections[0]?.id;
      sections.forEach(section => {
        if (section.offsetTop <= offset) active = section.id;
      });
      links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${active}`));
    };
    window.addEventListener("scroll", markActive, { passive: true });
    window.addEventListener("hashchange", markActive);
    markActive();
  }

  function init() {
    document.querySelectorAll("[data-manual-lang]").forEach(button => {
      button.addEventListener("click", () => applyLanguage(button.dataset.manualLang));
    });
    applyLanguage(languageFromStorage());
    setupSearch();
    setupNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
