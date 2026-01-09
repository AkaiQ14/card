async function loadBottom() {
  try {
    const res = await fetch("/api/leaderboard/bottom?limit=20");
    const data = await res.json();
    const rows = Array.isArray(data.bottom) ? data.bottom : [];
    const tbody = document.getElementById("lbBottomBody");
    tbody.innerHTML = "";

    rows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="font-bold">${r.name}</td>
        <td>${r.games}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td>${r.lossRate}%</td>
        <td>${r.points}</td>
      `;
      tbody.appendChild(tr);
    });

    if (!rows.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="opacity-80 py-6">لا توجد بيانات بعد.</td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    console.error("Failed to load bottom leaderboard", e);
  }
}

loadBottom();
setInterval(loadBottom, 20000);
