// --- Main button ---
document.getElementById("fill").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: startFakeFill,
  });
});

function startFakeFill() {
  window.dispatchEvent(new CustomEvent("fakeFiller:run"));
}


// --- Settings ---
const autoRunCheckbox = document.getElementById("auto-run");

// Load settings on popup open
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(["autoRun"], (result) => {
    autoRunCheckbox.checked = !!result.autoRun;
  });
});

// Save settings on change
autoRunCheckbox.addEventListener("change", () => {
  chrome.storage.sync.set({ autoRun: autoRunCheckbox.checked });
});
