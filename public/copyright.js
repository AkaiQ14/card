// public/copyright.js
window.addEventListener("DOMContentLoaded", () => {
  // --- Set favicon dynamically ---
  const favicon = document.createElement("link");
  favicon.rel = "icon";
  favicon.type = "image/png";
  favicon.href = "/images/qg14-Card-Clash-logo.png"; // <-- your logo path
  document.head.appendChild(favicon);

  // --- Load Cairo font dynamically ---
  const link = document.createElement("link");
  link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap";
  link.rel = "stylesheet";
  document.head.appendChild(link);

  // --- Apply Cairo font globally ---
  document.body.style.fontFamily = '"Cairo", sans-serif';

  // --- Force background image globally ---
  document.body.style.backgroundImage = "url('/images/QG14Background.png')";
  document.body.style.backgroundSize = "cover";
  document.body.style.backgroundRepeat = "no-repeat";
  document.body.style.backgroundAttachment = "fixed";
  document.body.style.backgroundPosition = "center";
  document.body.style.backgroundColor = "#4B0E1F"; // fallback color

  // --- Add copyright watermark ---
  const copyright = document.createElement("div");
  copyright.textContent = "© Raven4x4";
  copyright.style.position = "fixed";
  copyright.style.bottom = "10px";
  copyright.style.left = "10px";
  copyright.style.fontSize = "14px";
  copyright.style.fontWeight = "600";
  copyright.style.fontFamily = '"Cairo", sans-serif';
  copyright.style.color = "#ccc";
  copyright.style.opacity = "0.5";
  copyright.style.zIndex = "9999";
  copyright.style.direction = "ltr";
  copyright.style.textAlign = "left";
  copyright.dir = "ltr";

  document.body.appendChild(copyright);
});
