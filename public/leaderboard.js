async function loadTop() {
  try {
    const res = await fetch("/api/leaderboard/top?limit=20");
    const data = await res.json();
    const rows = Array.isArray(data.top) ? data.top : [];
    const tbody = document.getElementById("lbBody");
    tbody.innerHTML = "";

    // fill podium
    const [first, second, third] = rows;
    const podium1 = document.getElementById("podium-1");
    const podium2 = document.getElementById("podium-2");
    const podium3 = document.getElementById("podium-3");

    if (first) {
      podium1.children[0].textContent = first.name;
      podium1.children[1].innerHTML = `<span>نقاط: </span><b>${first.points}</b>`;
    } else {
      podium1.children[0].textContent = "—";
      podium1.children[1].innerHTML = `<span>نقاط: </span><b>0</b>`;
    }

    if (second) {
      podium2.children[0].textContent = second.name;
      podium2.children[1].innerHTML = `<span>نقاط: </span><b>${second.points}</b>`;
    } else {
      podium2.children[0].textContent = "—";
      podium2.children[1].innerHTML = `<span>نقاط: </span><b>0</b>`;
    }

    if (third) {
      podium3.children[0].textContent = third.name;
      podium3.children[1].innerHTML = `<span>نقاط: </span><b>${third.points}</b>`;
    } else {
      podium3.children[0].textContent = "—";
      podium3.children[1].innerHTML = `<span>نقاط: </span><b>0</b>`;
    }

    // fill table
    rows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="font-bold">${r.name}</td>
        <td>${r.games}</td>
        <td>${r.wins}</td>
        <td>${r.losses}</td>
        <td>${r.winRate}%</td>
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
    console.error("Failed to load leaderboard", e);
  }
}

loadTop();
setInterval(loadTop, 20000);
