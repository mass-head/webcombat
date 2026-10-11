// TravelGuard AI shared frontend script (Phase 2).
// Mobile navigation, sticky header, scroll reveal,
// footer backend status, and copyright year. Vanilla JS only.
document.addEventListener("DOMContentLoaded", () => {
  // Mobile navigation toggle.
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    });
    links.addEventListener("click", (event) => {
      if (event.target.closest("a") && links.classList.contains("open")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
      }
    });
  }

  // Sticky header shadow on scroll.
  const header = document.getElementById("site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // Scroll-reveal animations (graceful fallback when unsupported).
  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealItems.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealItems.forEach((el) => observer.observe(el));
  } else {
    revealItems.forEach((el) => el.classList.add("visible"));
  }

  // Copyright year.
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  // Footer backend status indicator (loading -> online/offline).
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  if (dot && text) {
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then((data) => {
        dot.classList.add("online");
        text.textContent = "Backend online (" + data.service + " " + data.version + ")";
      })
      .catch(() => {
        dot.classList.add("offline");
        text.textContent = "Backend offline — some features may be unavailable.";
      });
  }
});
