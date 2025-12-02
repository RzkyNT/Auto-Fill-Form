// latex.js

/**
 * Injects the KaTeX CSS into the page's head if it's not already there.
 */
function injectKatexCssOnce() {
  const cssId = 'katex-css-injected';
  if (document.getElementById(cssId)) {
    return;
  }

  const cssLink = document.createElement('link');
  cssLink.id = cssId;
  cssLink.rel = 'stylesheet';
  cssLink.href = chrome.runtime.getURL('vendor/katex/katex.min.css');
  document.head.appendChild(cssLink);
}

/**
 * Renders a raw string containing text, markdown, and LaTeX into a container element.
 * Assumes the KaTeX script has already been loaded via manifest.json.
 * @param {string} rawText The raw string to render.
 * @param {HTMLElement} container The DOM element to render the content into.
 */
function renderChatWithLatex(rawText, container) {
  // Inject the CSS required for KaTeX rendering
  injectKatexCssOnce();

  // Clear the container before rendering new content
  container.innerHTML = '';

  const lines = rawText.split('\n');

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      container.appendChild(document.createElement('br'));
    }

    // Regex to split by LaTeX delimiters ($...$ or $$...$$) while keeping the delimiters
    const parts = line.split(/(\$\$[\$\$][\s\S]*?\$\$[\$\$]|\$[\$][\s\S]*?\$[\$])/g);

    parts.forEach(part => {
      if (part.startsWith('$$') && part.endsWith('$$')) {
        const span = document.createElement('span');
        try {
          // The 'katex' global is available because katex.min.js was loaded via content_scripts
          katex.render(part.slice(2, -2).trim(), span, { displayMode: true, throwOnError: false });
        } catch (e) {
          console.error('KaTeX display-mode error:', e);
          span.textContent = part; // Fallback for this part
        }
        container.appendChild(span);
      } else if (part.startsWith('$') && part.endsWith('$')) {
        const span = document.createElement('span');
        try {
          // The 'katex' global is available here as well
          katex.render(part.slice(1, -1).trim(), span, { displayMode: false, throwOnError: false });
        } catch (e) {
          console.error('KaTeX inline-mode error:', e);
          span.textContent = part; // Fallback for this part
        }
        container.appendChild(span);
      } else if (part) {
        // Handle simple markdown (**bold**, *italic*) within the plain text parts
        renderMarkdownText(part, container);
      }
    });
  });
}

/**
 * Renders a string with simple markdown into a container element.
 * @param {string} text The text with markdown.
 * @param {HTMLElement} container The DOM element to append the nodes to.
 */
function renderMarkdownText(text, container) {
    // Regex to split by **bold** and *italic* while keeping them
    const mdParts = text.split(/(\$\*\*.*\*\*|\*.*\*)/g);
    
    mdParts.forEach(mdPart => {
        if (mdPart.startsWith('**') && mdPart.endsWith('**')) {
            const strong = document.createElement('strong');
            strong.textContent = mdPart.slice(2, -2);
            container.appendChild(strong);
        } else if (mdPart.startsWith('*') && mdPart.endsWith('*')) {
            const em = document.createElement('em');
            em.textContent = mdPart.slice(1, -1);
            container.appendChild(em);
        } else if (mdPart) {
            container.appendChild(document.createTextNode(mdPart));
        }
    });
}