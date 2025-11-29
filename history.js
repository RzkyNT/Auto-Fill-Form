document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-button");
  const clearHistoryButton = document.getElementById("clear-history");
  const searchInput = document.getElementById("search-history");
  const historyContainer = document.getElementById("history-container");

  let allHistoryEntries = [];

  // --- Event Listeners ---

  // Handle Back button click
  backButton.addEventListener("click", () => {
    window.close();
  });

  // Handle search input
  searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value;
    renderHistory(allHistoryEntries, searchTerm);
  });

  // Handle Clear History button click
  clearHistoryButton.addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all history? This cannot be undone.")) {
      chrome.storage.local.set({ smartFillHistory: [] }, () => {
        allHistoryEntries = [];
        renderHistory(allHistoryEntries, searchInput.value); // Re-render with current search term (which will show empty)
      });
    }
  });

  // --- Functions ---

  function renderHistory(history, filter = '') {
    if (!historyContainer) return;

    let filteredHistory = history;
    if (filter) {
      const lowercasedFilter = filter.toLowerCase();
      filteredHistory = history.filter(entry => 
        (entry.question && entry.question.toLowerCase().includes(lowercasedFilter)) ||
        (entry.answer && entry.answer.toLowerCase().includes(lowercasedFilter)) ||
        (entry.formUrl && entry.formUrl.toLowerCase().includes(lowercasedFilter))
      );
    }

    historyContainer.innerHTML = "";
    if (!filteredHistory || filteredHistory.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No history found" + (filter ? " for your search." : ".");
      empty.className = "history-empty";
      historyContainer.appendChild(empty);
      return;
    }

    const groupedByHostname = filteredHistory.reduce((acc, entry) => {
      try {
        const hostname = new URL(entry.formUrl).hostname;
        if (!acc[hostname]) acc[hostname] = [];
        acc[hostname].push(entry);
      } catch (e) {
        const invalidHost = "Other History";
        if (!acc[invalidHost]) acc[invalidHost] = [];
        acc[invalidHost].push(entry);
      }
      return acc;
    }, {});

    for (const hostname in groupedByHostname) {
      const entries = groupedByHostname[hostname];
      const card = document.createElement('details');
      card.className = 'history-group-card';
      card.open = true; // Keep all cards open when searching

      const summary = document.createElement('summary');
      summary.className = 'history-group-summary';
      summary.textContent = hostname;
      card.appendChild(summary);

      const tableContainer = document.createElement('div');
      tableContainer.className = 'history-table-container';
      const table = document.createElement('table');
      table.innerHTML = `<thead><tr><th>Question</th><th>Answer</th><th>Status</th><th>Timestamp</th></tr></thead>`;
      
      const tbody = document.createElement('tbody');
      entries.sort((a, b) => b.timestamp - a.timestamp).forEach(entry => {
        const row = document.createElement('tr');
        ['question', 'answer', 'status'].forEach(key => {
          const cell = document.createElement('td');
          cell.textContent = entry[key] || "N/A";
          row.appendChild(cell);
        });
        const timeCell = document.createElement('td');
        timeCell.textContent = new Date(entry.timestamp).toLocaleString();
        row.appendChild(timeCell);
        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      tableContainer.appendChild(table);
      card.appendChild(tableContainer);
      historyContainer.appendChild(card);
    }
  }

  // --- Initial Load ---
  chrome.storage.local.get("smartFillHistory", (result) => {
    allHistoryEntries = result.smartFillHistory || [];
    renderHistory(allHistoryEntries);
  });
});