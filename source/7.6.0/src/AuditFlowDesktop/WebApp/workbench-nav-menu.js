(() => {
  "use strict";

  const groups = [...document.querySelectorAll("[data-nav-menu]")];
  if (!groups.length) return;

  const header = document.getElementById("sidebar");
  const parts = group => ({
    trigger: group.querySelector("[data-nav-menu-trigger]"),
    panel: group.querySelector("[data-nav-menu-panel]")
  });
  const links = panel => [...(panel?.querySelectorAll("a[data-nav]") || [])];
  const isOpen = group => parts(group).trigger?.getAttribute("aria-expanded") === "true";

  function setOpen(group, open, focusFirst = false) {
    const { trigger, panel } = parts(group);
    if (!trigger || !panel) return;
    if (open) {
      groups.forEach(candidate => {
        if (candidate !== group) setOpen(candidate, false);
      });
    }
    panel.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    group.classList.toggle("is-open", open);
    if (open && focusFirst) links(panel)[0]?.focus();
  }

  function closeMenus(restoreFocus = false) {
    const openGroup = groups.find(isOpen);
    groups.forEach(group => setOpen(group, false));
    if (restoreFocus && openGroup) parts(openGroup).trigger?.focus();
  }

  function syncActiveGroups() {
    groups.forEach(group => {
      const active = links(parts(group).panel).some(link => link.classList.contains("active"));
      group.classList.toggle("has-active", active);
      parts(group).trigger?.classList.toggle("active", active);
    });
  }

  groups.forEach(group => setOpen(group, false));

  groups.forEach(group => {
    const { trigger, panel } = parts(group);
    if (!trigger || !panel) return;

    trigger.addEventListener("click", () => {
      setOpen(group, !isOpen(group));
    });
    trigger.addEventListener("keydown", event => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      setOpen(group, true);
      const menuLinks = links(panel);
      menuLinks[event.key === "ArrowUp" ? menuLinks.length - 1 : 0]?.focus();
    });
    panel.addEventListener("keydown", event => {
      const menuLinks = links(panel);
      const index = menuLinks.indexOf(event.target);
      let next = -1;
      if (event.key === "ArrowDown") next = (index + 1) % menuLinks.length;
      else if (event.key === "ArrowUp") next = (index - 1 + menuLinks.length) % menuLinks.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = menuLinks.length - 1;
      if (next >= 0 && menuLinks.length) {
        event.preventDefault();
        menuLinks[next].focus();
      }
    });
    group.addEventListener("click", event => {
      if (!event.target.closest("a[data-nav]")) return;
      closeMenus();
      header?.classList.remove("open");
    });
  });

  document.addEventListener("pointerdown", event => {
    if (!event.target?.closest("[data-nav-menu]")) closeMenus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && groups.some(isOpen)) {
      event.preventDefault();
      closeMenus(true);
    } else if (event.key === "Tab") {
      closeMenus();
    }
  });
  window.addEventListener("hashchange", syncActiveGroups);
  syncActiveGroups();
})();
