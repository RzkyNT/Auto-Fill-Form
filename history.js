document.addEventListener("DOMContentLoaded", () => {
  const backButton = document.getElementById("back-button");
  const clearHistoryButton = document.getElementById("clear-history");
  const searchInput = document.getElementById("search-history");
  const historyContainer = document.getElementById("history-container");
  const htmlRoot = document.documentElement;

  let allHistoryEntries = [];

  // --- Theme Application ---
  function applyTheme(isDark) {
    htmlRoot.classList.toggle("light", !isDark);
  }

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
    const isLightTheme = htmlRoot.classList.contains('light');

    Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Yes, delete it!',
      background: isLightTheme ? '#ffffff' : '#0B0F14',
      color: isLightTheme ? '#2b2b2b' : '#F2F4F6',
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6'
    }).then((result) => {
      if (result.isConfirmed) {
        chrome.storage.local.set({ smartFillHistory: [] }, () => {
          allHistoryEntries = [];
          renderHistory(allHistoryEntries, searchInput.value);
          Swal.fire({
            title: 'Deleted!',
            text: 'Your history has been deleted.',
            icon: 'success',
            background: isLightTheme ? '#ffffff' : '#0B0F14',
            color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
          });
        });
      }
    });
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
        
        // Question Cell (with choices)
        const qCell = document.createElement('td');
        const qText = document.createTextNode(entry.question || "N/A");
        qCell.appendChild(qText);

        if (entry.choices && entry.choices.length > 0) {
            const choicesContainer = document.createElement('div');
            choicesContainer.style.marginTop = '10px';
            choicesContainer.style.opacity = '0.8';

            const choicesTitle = document.createElement('small');
            const titleItalic = document.createElement('i');
            titleItalic.textContent = 'Pilihan:';
            choicesTitle.appendChild(titleItalic);
            choicesContainer.appendChild(choicesTitle);

            const choicesList = document.createElement('ol');
            choicesList.style.margin = '5px 0 0 18px';
            choicesList.style.padding = '0';

            entry.choices.forEach(choiceText => {
                const choiceItem = document.createElement('li');
                choiceItem.textContent = choiceText;
                choicesList.appendChild(choiceItem);
            });
            
            choicesContainer.appendChild(choicesList);
            qCell.appendChild(choicesContainer);
        }
        row.appendChild(qCell);

        // Answer Cell
        const aCell = document.createElement('td');
        aCell.textContent = entry.answer || "N/A";
        row.appendChild(aCell);

        // Status Cell
        const sCell = document.createElement('td');
        sCell.textContent = entry.status;
        row.appendChild(sCell);

        // Timestamp Cell
        const tCell = document.createElement('td');
        tCell.textContent = new Date(entry.timestamp).toLocaleString();
        row.appendChild(tCell);

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      tableContainer.appendChild(table);
      card.appendChild(tableContainer);
      historyContainer.appendChild(card);
    }
  }

  // --- Initial Load ---
  chrome.storage.local.get(["smartFillHistory", "themeMode"], (result) => {
    // Apply theme first
    const themeMode = result.themeMode || "light";
    applyTheme(themeMode === "dark");
    
    // Then render history
    allHistoryEntries = result.smartFillHistory || [];
    renderHistory(allHistoryEntries);
  });
});