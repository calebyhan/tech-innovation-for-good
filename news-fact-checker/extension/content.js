// Global variables
let factCheckOverlay = null;
let toggleButton = null;

function extractMainText() {
  // Try to find article-specific containers first
  const selectors = [
    'article', 'main', '[role="main"]',
    '.article-body', '.post-content', '.entry-content',
    '.content', '.story-body', '.article-content'
  ];
  
  let el = null;
  for (const s of selectors) {
    const cand = document.querySelector(s);
    if (cand && cand.innerText && cand.innerText.length > 500) { 
      el = cand; 
      break; 
    }
  }
  
  // If no specific container found, use body but filter out common UI elements
  if (!el) {
    el = document.body;
  }
  
  let text = (el.innerText || "").trim();
  
  // Clean up the text
  text = cleanText(text);
  
  return text.replace(/\s+/g, ' ').slice(0, 100000); // cap size
}

function cleanText(text) {
  // Remove common navigation and UI patterns
  const lines = text.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim().toLowerCase();
    
    // Skip empty lines
    if (!trimmed) return false;
    
    // Skip navigation elements
    if (trimmed.includes('menu') || trimmed.includes('navigation')) return false;
    if (trimmed.includes('skip to content') || trimmed.includes('skip to main')) return false;
    if (trimmed.includes('search') && trimmed.length < 50) return false;
    
    // Skip social media and sharing
    if (trimmed.includes('share') && trimmed.length < 50) return false;
    if (trimmed.includes('facebook') || trimmed.includes('twitter') || trimmed.includes('linkedin')) return false;
    
    // Skip subscription/newsletter prompts
    if (trimmed.includes('newsletter') || trimmed.includes('subscribe')) return false;
    if (trimmed.includes('sign up') && trimmed.length < 100) return false;
    
    // Skip cookie notices
    if (trimmed.includes('cookie') && trimmed.includes('accept')) return false;
    
    // Skip very short lines that are likely UI elements
    if (trimmed.length < 10) return false;
    
    // Skip lines that are just timestamps or metadata
    if (/^\d+\s+(minutes?|hours?|days?|months?)\s+ago$/i.test(trimmed)) return false;
    if (/^(updated|published):\s*\d/i.test(trimmed)) return false;
    
    return true;
  });
  
  return cleanedLines.join('\n');
}

function createFactCheckOverlay() {
  // Create toggle button
  toggleButton = document.createElement('button');
  toggleButton.className = 'fact-check-toggle';
  toggleButton.innerHTML = '✓';
  toggleButton.title = 'Show Fact Check Results';
  
  // Create overlay
  factCheckOverlay = document.createElement('div');
  factCheckOverlay.className = 'fact-check-overlay';
  factCheckOverlay.innerHTML = `
    <div class="fact-check-header">
      <h2 class="fact-check-title">Fact Check</h2>
      <button class="fact-check-close">×</button>
    </div>
    <div class="fact-check-content">
      <div class="fact-check-status">
        <div class="fact-check-loading"></div>
        Analyzing page content...
      </div>
    </div>
  `;
  
  // Add event listeners
  toggleButton.addEventListener('click', showOverlay);
  factCheckOverlay.querySelector('.fact-check-close').addEventListener('click', hideOverlay);
  
  // Add to page
  document.body.appendChild(toggleButton);
  document.body.appendChild(factCheckOverlay);
}

function showOverlay() {
  if (factCheckOverlay) {
    factCheckOverlay.classList.add('visible');
    toggleButton.classList.add('hidden');
  }
}

function hideOverlay() {
  if (factCheckOverlay) {
    factCheckOverlay.classList.remove('visible');
    toggleButton.classList.remove('hidden');
  }
}

function updateOverlayContent(data) {
  if (!factCheckOverlay) return;
  
  const content = factCheckOverlay.querySelector('.fact-check-content');
  
  if (data.error) {
    content.innerHTML = `
      <div class="fact-check-status">
        <span style="color: #e74c3c;">Error: ${data.error}</span>
      </div>
    `;
    return;
  }
  
  // Build the content HTML
  let html = '';
  
  // Page Type
  if (data.page_type) {
    html += `
      <div class="fact-check-section">
        <h3>Page Type</h3>
        <span class="page-type-badge">${data.page_type.label || 'unknown'}</span>
        <span class="confidence-score">(conf: ${(data.page_type.score || 0).toFixed(2)})</span>
      </div>
    `;
  }
  
  // Consensus
  if (data.consensus) {
    html += `
      <div class="fact-check-section">
        <h3>Consensus</h3>
        <div class="consensus-text">${data.consensus.summary || '—'}</div>
        <div class="consensus-disclaimer">${data.consensus.disclaimer || ''}</div>
      </div>
    `;
  }
  
  // Claims
  if (data.claims && data.claims.length > 0) {
    html += `
      <div class="fact-check-section">
        <h3>Top Claims</h3>
    `;
    
    data.claims.forEach(claim => {
      const emoji = claim.consensus === 'supported' ? '✅' :
                   claim.consensus === 'contested' ? '⚠️' :
                   claim.consensus === 'refuted' ? '❌' : '❓';
      
      html += `
        <div class="claim-item">
          <div class="claim-text">
            <span class="claim-emoji">${emoji}</span>
            <span class="claim-content">${claim.text}</span>
          </div>
          <div class="claim-scores">
            E: ${claim.entail_score.toFixed(2)} | C: ${claim.contra_score.toFixed(2)}
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  // Sources
  if (data.sources && data.sources.length > 0) {
    html += `
      <div class="fact-check-section">
        <h3>Sources</h3>
    `;
    
    data.sources.forEach(source => {
      html += `
        <div class="source-item">
          <a href="${source.url}" target="_blank" class="source-link">
            ${source.title || source.url}
          </a>
          ${source.publisher ? `<div class="source-publisher">${source.publisher}</div>` : ''}
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  content.innerHTML = html;
}

// Listen for results from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FACTCHECK_RESULT') {
    updateOverlayContent(message.data);
    // Auto-show overlay when results are ready
    setTimeout(showOverlay, 500);
  }
});

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  createFactCheckOverlay();
});

// Also initialize if DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFactCheckOverlay);
} else {
  createFactCheckOverlay();
}

// Send page content for analysis
chrome.runtime.sendMessage({
  type: "PAGE_CONTENT",
  payload: {
    url: location.href,
    title: document.title,
    text: extractMainText()
  }
});