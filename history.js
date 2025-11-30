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

  // Handle Clear All History button click
  clearHistoryButton.addEventListener("click", () => {
    const isLightTheme = htmlRoot.classList.contains('light');

    Swal.fire({
      title: 'Are you sure?',
      text: "This will permanently delete ALL your history. You won't be able to revert this!",
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
            text: 'All history has been deleted.',
            icon: 'success',
            background: isLightTheme ? '#ffffff' : '#0B0F14',
            color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
          });
        });
      }
    });
  });

  // Event delegation for hostname-specific actions (Delete and Export)
  historyContainer.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('delete-btn')) {
      const hostname = target.dataset.hostname;
      if (hostname) handleDeleteHostname(hostname);
    } else if (target.classList.contains('export-btn')) {
      const hostname = target.dataset.hostname;
      if (hostname) handleExportHostname(hostname);
    }
  });

  // --- New Functions for Hostname Actions ---

  const handleDeleteHostname = (hostname) => {
    const isLightTheme = htmlRoot.classList.contains('light');

    Swal.fire({
      title: 'Are you sure?',
      text: `This will permanently delete all history for ${hostname}. You won't be able to revert this!`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#3085d6',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!',
      background: isLightTheme ? '#ffffff' : '#0B0F14',
      color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
    }).then((result) => {
      if (result.isConfirmed) {
        chrome.storage.local.get('smartFillHistory', (res) => {
          const updatedHistory = (res.smartFillHistory || []).filter(item => {
            try {
              return new URL(item.formUrl).hostname !== hostname;
            } catch {
              // Keep items with invalid URLs if their hostname can't be determined
              return true; 
            }
          });
          chrome.storage.local.set({ smartFillHistory: updatedHistory }, () => {
            allHistoryEntries = updatedHistory; // Update local copy
            renderHistory(allHistoryEntries, searchInput.value); // Re-render with current search filter
            Swal.fire({
              title: 'Deleted!',
              text: `History for ${hostname} has been deleted.`,
              icon: 'success',
              background: isLightTheme ? '#ffffff' : '#0B0F14',
              color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
            });
          });
        });
      }
    });
  };

  const handleExportHostname = (hostname) => {
    // Ensure XLSX is available
    if (typeof XLSX === 'undefined') {
        Swal.fire('Error', 'XLSX library not loaded. Please check your internet connection or manifest.', 'error');
        console.error('XLSX library (SheetJS) is not loaded.');
        return;
    }

    const dataToExport = allHistoryEntries.filter(item => {
        try {
            return new URL(item.formUrl).hostname === hostname;
        } catch {
            return false; // Exclude items with invalid URLs from export
        }
    }).map(item => ({ 
        Question: item.question || "N/A", 
        Choices: (item.choices && item.choices.length > 0) ? item.choices.join(', ') : '',
        Answer: item.answer || "N/A", 
        Status: item.status || "N/A",
        URL: item.formUrl || "N/A",
        Timestamp: new Date(item.timestamp).toLocaleString() || "N/A"
    }));

    if (dataToExport.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "History_Data");
        XLSX.writeFile(workbook, `history_${hostname}.xlsx`);
    } else {
        const isLightTheme = htmlRoot.classList.contains('light');
        Swal.fire({
          title: 'No Data', 
          text: `There is no history data to export for ${hostname}.`, 
          icon: 'info',
          background: isLightTheme ? '#ffffff' : '#0B0F14',
          color: isLightTheme ? '#2b2b2b' : '#F2F4F6'
        });
    }
  };


  // --- Original Functions ---

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
        const invalidHost = "Other History"; // Group entries with invalid URLs
        if (!acc[invalidHost]) acc[invalidHost] = [];
        acc[invalidHost].push(entry);
      }
      return acc;
    }, {});

    for (const hostname in groupedByHostname) {
      const entries = groupedByHostname[hostname];
      const card = document.createElement('details');
      card.className = 'history-group-card';
      card.open = true; // Keep all cards open when searching or initially loading

      const summary = document.createElement('summary');
      summary.className = 'history-group-summary';
      // Add hostname text and the new buttons
      summary.innerHTML = `
          <span class="hostname-text">${hostname} (${entries.length})</span>
          <span class="hostname-actions">
              <button class="export-btn" data-hostname="${hostname}">Export XLSX</button>
              <button class="delete-btn" data-hostname="${hostname}">Delete</button>
          </span>
      `;
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