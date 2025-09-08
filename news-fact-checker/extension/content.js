// Global variables
let factCheckOverlay = null;
let toggleButton = null;
let factCheckEnabled = true;
let currentPageType = null;
let isAnalyzing = false;
let pageData = {
  pageType: null,
  claims: [],
  sources: [],
  consensus: null,
  status: 'initializing'
};

// Initialize extension
async function initializeExtension() {
  // Load settings from storage
  try {
    const result = await chrome.storage.sync.get(['factCheckEnabled']);
    factCheckEnabled = result.factCheckEnabled !== false; // Default to true
  } catch (error) {
    console.log('Could not load settings, using defaults');
    factCheckEnabled = true;
  }
  
  // Detect page type
  currentPageType = await detectPageType();
  
  console.log('News Fact Checker initialized:', {
    enabled: factCheckEnabled,
    pageType: currentPageType,
    isNewsArticle: isNewsArticle()
  });
  
  // Only start analysis if both conditions are met
  if (factCheckEnabled && isNewsArticle()) {
    console.log('Starting automatic fact-check for news article');
    if (!factCheckOverlay) {
      createFactCheckOverlay();
    }
    startAnalysis();
  } else {
    console.log('Fact-checking disabled:', {
      enabled: factCheckEnabled,
      isNews: isNewsArticle(),
      reason: !factCheckEnabled ? 'User disabled' : 'Not a news article'
    });
  }
}

/**
 * Detect if current page is a news article
 */
function isNewsArticle() {
  if (!currentPageType) return false;
  
  // Check URL patterns first
  const url = window.location.href.toLowerCase();
  const newsUrlPatterns = [
    /\/news\//,
    /\/article\//,
    /\/story\//,
    /\/politics\//,
    /\/world\//,
    /\/business\//,
    /\/sports\//,
    /\/technology\//,
    /\/health\//,
    /\/science\//,
    /\/entertainment\//,
    /\/breaking\//,
    /cnn\.com\/\d{4}/,
    /bbc\.com\/news/,
    /reuters\.com\/.*\/news/,
    /nytimes\.com\/\d{4}/,
    /washingtonpost\.com\/.*\/\d{4}/,
    /theguardian\.com\/.*\/\d{4}/,
    /npr\.org\/\d{4}/,
    /bloomberg\.com\/news/,
    /apnews\.com\/article/
  ];
  
  const hasNewsUrl = newsUrlPatterns.some(pattern => pattern.test(url));
  
  // Check page content patterns
  const hasNewsContent = checkNewsContentPatterns();
  
  // Check meta tags
  const hasNewsMetadata = checkNewsMetadata();
  
  // Combined scoring
  let newsScore = 0;
  if (hasNewsUrl) newsScore += 3;
  if (hasNewsContent) newsScore += 2;
  if (hasNewsMetadata) newsScore += 1;
  
  console.log('News article detection:', {
    url: hasNewsUrl,
    content: hasNewsContent,
    metadata: hasNewsMetadata,
    score: newsScore,
    threshold: 2
  });
  
  return newsScore >= 2;
}

/**
 * Check for news content patterns
 */
function checkNewsContentPatterns() {
  const text = document.body.textContent || '';
  const lowerText = text.toLowerCase();
  
  // Look for news-specific elements
  const newsIndicators = [
    // Timestamps
    /\b(published|updated|posted|reported)\s+(on\s+)?(\w+\s+)?\d{1,2},?\s+\d{4}/i,
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i,
    /\d{1,2}\/\d{1,2}\/\d{2,4}/,
    
    // Bylines and attribution
    /\b(by\s+[A-Z][a-z]+\s+[A-Z][a-z]+|reporter|correspondent|staff writer)/i,
    /(according to|sources say|officials said|reports indicate)/i,
    
    // News-specific phrases
    /(breaking news|developing story|exclusive report|investigation finds)/i,
    /(the incident|the investigation|the announcement|the decision)/i,
    
    // Location datelines
    /^[A-Z][a-z]+,?\s+[A-Z][a-z]+\s+[–—-]/m
  ];
  
  const indicatorCount = newsIndicators.reduce((count, pattern) => {
    return count + (pattern.test(text) ? 1 : 0);
  }, 0);
  
  // Check for article structure
  const hasHeadline = document.querySelector('h1') !== null;
  const hasDateline = !!text.match(/\b\d{4}\b/) && !!text.match(/(published|updated|posted)/i);
  const hasAuthor = !!text.match(/\b(by\s+[A-Z][a-z]+|author|writer|reporter)/i);
  
  return indicatorCount >= 2 || (hasHeadline && hasDateline && hasAuthor);
}

/**
 * Check news-related metadata
 */
function checkNewsMetadata() {
  // Check meta tags
  const metaTags = document.querySelectorAll('meta');
  let newsMetaCount = 0;
  
  metaTags.forEach(meta => {
    const property = meta.getAttribute('property') || meta.getAttribute('name') || '';
    const content = meta.getAttribute('content') || '';
    
    if (property.includes('article:') || property.includes('news') || 
        content.includes('news') || content.includes('article')) {
      newsMetaCount++;
    }
  });
  
  // Check structured data
  const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
  let hasNewsSchema = false;
  
  jsonLdScripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      if (data['@type'] === 'NewsArticle' || data['@type'] === 'Article') {
        hasNewsSchema = true;
      }
    } catch (e) {
      // Ignore invalid JSON
    }
  });
  
  return newsMetaCount >= 2 || hasNewsSchema;
}

/**
 * Detect page type using multiple heuristics
 */
async function detectPageType() {
  const url = window.location.href;
  const domain = window.location.hostname;
  const title = document.title;
  const text = document.body.textContent || '';
  
  // Known news domains
  const newsDomains = [
    'cnn.com', 'bbc.com', 'reuters.com', 'apnews.com', 'nytimes.com',
    'washingtonpost.com', 'theguardian.com', 'npr.org', 'bloomberg.com',
    'wsj.com', 'foxnews.com', 'nbcnews.com', 'abcnews.go.com', 'cbsnews.com',
    'usatoday.com', 'latimes.com', 'nypost.com', 'politico.com', 'axios.com'
  ];
  
  const isNewsDomain = newsDomains.some(d => domain.includes(d));
  
  // URL pattern analysis
  const urlPatterns = {
    news: /\/(news|article|story|politics|world|business|sports|technology|health|science|entertainment|breaking)\//i,
    blog: /\/(blog|post)\//i,
    social: /\/(facebook|twitter|instagram|linkedin|reddit|youtube)\//i,
    shopping: /\/(shop|buy|cart|checkout|product)\//i
  };
  
  let detectedType = 'webpage';
  
  if (isNewsDomain || urlPatterns.news.test(url)) {
    detectedType = 'news';
  } else if (urlPatterns.blog.test(url)) {
    detectedType = 'blog';
  } else if (urlPatterns.social.test(url)) {
    detectedType = 'social';
  } else if (urlPatterns.shopping.test(url)) {
    detectedType = 'shopping';
  }
  
  return {
    type: detectedType,
    domain: domain,
    isNewsDomain: isNewsDomain,
    confidence: isNewsDomain ? 0.9 : 0.6
  };
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkPageType') {
    sendResponse({
      isNewsArticle: isNewsArticle(),
      pageType: currentPageType?.type || 'unknown',
      domain: window.location.hostname,
      url: window.location.href
    });
  } else if (request.action === 'updateSettings') {
    factCheckEnabled = request.factCheckEnabled;
    console.log('Settings updated:', { factCheckEnabled });
    
    if (factCheckEnabled && isNewsArticle() && !isAnalyzing) {
      if (!factCheckOverlay) {
        createFactCheckOverlay();
      }
      startAnalysis();
    } else if (!factCheckEnabled) {
      // Clear any existing overlays
      clearFactCheckOverlay();
    }
    sendResponse({ success: true });
  } else if (request.action === 'forceAnalyze') {
    console.log('Force analysis requested');
    if (!factCheckOverlay) {
      createFactCheckOverlay();
    }
    startAnalysis(true); // Pass true for force analysis
    sendResponse({ success: true });
  } else if (request.type === 'FACTCHECK_UPDATE') {
    handleStreamingUpdate(request.data);
  }
  
  return true; // Keep message channel open for async response
});

function startAnalysis(forceAnalysis = false) {
  if (isAnalyzing) {
    console.log('Analysis already in progress, skipping...');
    return;
  }
  
  isAnalyzing = true;
  
  // Ensure overlay exists
  if (!factCheckOverlay) {
    createFactCheckOverlay();
  }
  
  // Reset overlay state
  updateStatus('Starting analysis...');
  
  // Send page content for analysis
  chrome.runtime.sendMessage({
    type: "PAGE_CONTENT",
    payload: {
      url: location.href,
      title: document.title,
      text: extractMainText()
    },
    forceAnalysis: forceAnalysis // Add flag to distinguish manual vs automatic
  });
}

function clearFactCheckOverlay() {
  if (factCheckOverlay) {
    factCheckOverlay.remove();
    factCheckOverlay = null;
  }
  isAnalyzing = false;
  clearClaimDetails();
}

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
    if (trimmed.includes('instagram') || trimmed.includes('youtube') || trimmed.includes('tiktok')) return false;
    
    // Skip subscription/newsletter prompts
    if (trimmed.includes('newsletter') || trimmed.includes('subscribe')) return false;
    if (trimmed.includes('sign up') && trimmed.length < 100) return false;
    
    // Skip cookie notices
    if (trimmed.includes('cookie') && trimmed.includes('accept')) return false;
    
    // Skip advertising content
    if (trimmed.includes('advertisement') || trimmed.includes('sponsored')) return false;
    if (trimmed.includes('buy now') || trimmed.includes('shop now')) return false;
    if (trimmed.includes('sale') || trimmed.includes('discount')) return false;
    
    // Skip metadata
    if (/^(published|updated|edited|written|authored|by):/i.test(trimmed)) return false;
    if (/^(tags|categories|filed under):/i.test(trimmed)) return false;
    if (/^\d+ (min|minutes|hour|hours|second|seconds) read$/i.test(trimmed)) return false;
    if (/^(source|credit|photo by|image):/i.test(trimmed)) return false;
    if (/^\s*\d+\s*(comments?|replies?|views?|shares?)\s*$/i.test(trimmed)) return false;
    
    // Skip very short lines that are likely UI elements
    if (trimmed.length < 15) return false;
    
    // Skip lines that are just timestamps or metadata
    if (/^\d+\s+(minutes?|hours?|days?|months?)\s+ago$/i.test(trimmed)) return false;
    if (/^(updated|published):\s*\d/i.test(trimmed)) return false;
    
    // Skip navigation patterns
    if (/^(home|news|sports|politics|business|entertainment|technology)$/i.test(trimmed)) return false;
    if (/^(previous|next|page \d+|1 of \d+)$/i.test(trimmed)) return false;
    
    // Skip common UI text
    if (/^(click here|read more|show more|load more)$/i.test(trimmed)) return false;
    if (/^(toggle|expand|collapse|dropdown)$/i.test(trimmed)) return false;
    
    return true;
  });
  
  return cleanedLines.join('\n');
}

/**
 * Find and highlight claim text in the article with sources
 */
function findAndHighlightClaim(claimText, claimData = null) {
  // Clear any existing highlights first
  clearClaimDetails();
  
  // Get the main article container
  const selectors = [
    'article', 'main', '[role="main"]',
    '.article-body', '.post-content', '.entry-content',
    '.content', '.story-body', '.article-content'
  ];
  
  let articleContainer = null;
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText && element.innerText.length > 200) {
      articleContainer = element;
      break;
    }
  }
  
  if (!articleContainer) {
    articleContainer = document.body;
  }
  
  console.log('Article container found:', articleContainer.tagName, articleContainer.className);
  
  // Search for the claim text or similar text
  let result = searchForClaimInElement(articleContainer, claimText);
  
  // If no result, try searching in paragraphs directly
  if (!result) {
    console.log('No result from text walker, trying paragraph search');
    const paragraphs = articleContainer.querySelectorAll('p, div, span, h1, h2, h3, h4, h5, h6');
    const claimWords = claimText.toLowerCase().split(' ').filter(w => w.length > 3);
    
    let bestParagraph = null;
    let bestScore = 0;
    
    paragraphs.forEach(p => {
      if (p.classList?.contains('fact-check-overlay') || 
          p.classList?.contains('fact-check-sources-panel')) {
        return;
      }
      
      const text = p.textContent || '';
      if (text.length < 20) return;
      
      const cleanText = text.toLowerCase();
      const textWords = cleanText.split(' ').filter(w => w.length > 3);
      const matchingWords = claimWords.filter(word => textWords.includes(word));
      const score = matchingWords.length / Math.max(claimWords.length, 1);
      
      if (score > bestScore && score > 0.15) {
        bestScore = score;
        bestParagraph = p;
      }
    });
    
    if (bestParagraph) {
      console.log('Found paragraph match with score:', bestScore);
      result = {
        element: bestParagraph,
        text: bestParagraph.textContent,
        score: bestScore
      };
    }
  }
  
  if (result && claimData) {
    highlightAndShowSources(result.element, result.text, claimData);
    return true;
  } else if (result) {
    // Fallback for when no claim data is provided
    highlightAndShowSources(result.element, result.text, { text: claimText, verdict: 'unknown' });
    return true;
  }
  
  console.log('No match found for claim');
  return false;
}

/**
 * Search for claim text in an element and its children
 */
function searchForClaimInElement(element, claimText) {
  const cleanClaim = claimText.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const claimWords = cleanClaim.split(' ').filter(word => word.length > 3);
  
  console.log('Searching for claim:', claimText.slice(0, 100) + '...');
  console.log('Clean claim words:', claimWords);
  
  // Try multiple search strategies
  const strategies = [
    // Strategy 1: Look for key phrases (4+ words together)
    () => {
      const phrases = [];
      for (let i = 0; i <= claimWords.length - 4; i++) {
        phrases.push(claimWords.slice(i, i + 4).join(' '));
      }
      return phrases;
    },
    // Strategy 2: Look for shorter phrases (2-3 words)
    () => {
      const phrases = [];
      for (let i = 0; i <= claimWords.length - 2; i++) {
        phrases.push(claimWords.slice(i, i + 3).join(' '));
      }
      return phrases;
    }
  ];
  
  // Try exact match first
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentNode;
        return parent.tagName !== 'SCRIPT' && 
               parent.tagName !== 'STYLE' &&
               parent.tagName !== 'NOSCRIPT' &&
               !parent.classList?.contains('fact-check-overlay') &&
               !parent.classList?.contains('fact-check-sources-panel') &&
               !parent.classList?.contains('fact-check-highlight-wrapper') &&
               node.textContent.trim().length > 15 ? 
               NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    }
  );
  
  let bestMatch = null;
  let bestScore = 0;
  let allTextNodes = [];
  
  // Collect all text nodes first
  let node;
  while (node = walker.nextNode()) {
    allTextNodes.push(node);
  }
  
  console.log('Found', allTextNodes.length, 'text nodes to search');
  
  // Search through all text nodes
  for (const textNode of allTextNodes) {
    const text = textNode.textContent;
    const cleanText = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Strategy 1: Exact substring match (most lenient)
    if (cleanText.includes(cleanClaim.slice(0, 30))) {
      console.log('Found exact match:', text.slice(0, 100));
      return {
        element: textNode.parentNode,
        text: textNode.textContent,
        score: 1.0
      };
    }
    
    // Strategy 2: Try phrase matching
    for (const strategy of strategies) {
      const phrases = strategy();
      for (const phrase of phrases) {
        if (cleanText.includes(phrase)) {
          console.log('Found phrase match:', phrase, 'in:', text.slice(0, 100));
          return {
            element: textNode.parentNode,
            text: textNode.textContent,
            score: 0.9
          };
        }
      }
    }
    
    // Strategy 3: Word overlap scoring
    const textWords = cleanText.split(' ').filter(w => w.length > 3);
    const matchingWords = claimWords.filter(word => textWords.includes(word));
    const score = matchingWords.length / Math.max(claimWords.length, 1);
    
    if (score > 0.2 && score > bestScore && text.length > 20) {
      console.log('Potential match with score', score.toFixed(2), ':', text.slice(0, 100));
      bestMatch = {
        element: textNode.parentNode,
        text: textNode.textContent,
        score: score
      };
      bestScore = score;
    }
  }
  
  console.log('Best match found with score:', bestScore);
  return bestScore > 0.2 ? bestMatch : null;
}

/**
 * Highlight and show sources for the found element
 */
function highlightAndShowSources(element, text, claimData) {
  // Clear any existing claim details
  clearClaimDetails();
  
  // Create a persistent highlight wrapper
  const highlight = document.createElement('div');
  highlight.className = 'fact-check-highlight-wrapper persistent';
  highlight.style.cssText = `
    background: linear-gradient(45deg, rgba(255, 193, 7, 0.3), rgba(255, 193, 7, 0.1));
    border-left: 4px solid #ffc107;
    padding: 10px;
    margin: 5px 0;
    border-radius: 6px;
    box-shadow: 0 2px 8px rgba(255, 193, 7, 0.2);
    transition: all 0.3s ease;
    position: relative;
  `;
  
  // Insert the highlight wrapper
  element.parentNode.insertBefore(highlight, element);
  highlight.appendChild(element);
  
  // Create close button
  const closeButton = document.createElement('button');
  closeButton.className = 'fact-check-close-highlight';
  closeButton.innerHTML = '×';
  closeButton.style.cssText = `
    position: absolute;
    top: 5px;
    right: 5px;
    background: rgba(0, 0, 0, 0.1);
    border: none;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    cursor: pointer;
    font-size: 16px;
    color: #333;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
    z-index: 1000;
  `;
  
  closeButton.addEventListener('click', () => {
    clearClaimDetails();
  });
  
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.2)';
  });
  
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'rgba(0, 0, 0, 0.1)';
  });
  
  highlight.appendChild(closeButton);
  
  // Create sources panel
  const sourcesPanel = document.createElement('div');
  sourcesPanel.className = 'fact-check-sources-panel';
  sourcesPanel.style.cssText = `
    background: white;
    border: 1px solid #e1e5e9;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    margin-top: 10px;
    padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    animation: slideInPanel 0.3s ease-out;
  `;
  
  // Get relevant sources for this claim
  const relevantSources = getRelevantSourcesForClaim(claimData, pageData.sources || []);
  
  const verdict = claimData.verdict || claimData.consensus || 'unknown';
  const emoji = getClaimEmoji(verdict);
  const verdictColor = getVerdictColor(verdict);
  
  // Handle different claim data structures
  const supportScore = claimData.support || claimData.entail_score || 'N/A';
  const contraScore = claimData.contradiction || claimData.contra_score || 'N/A';
  
  sourcesPanel.innerHTML = `
    <div style="display: flex; align-items: center; margin-bottom: 12px;">
      <span style="font-size: 18px; margin-right: 8px;">${emoji}</span>
      <span style="font-weight: 600; color: ${verdictColor};">${formatVerdict(verdict)}</span>
    </div>
    <div style="margin-bottom: 12px;">
      <div style="font-size: 12px; color: #666; margin-bottom: 4px;">Support: ${typeof supportScore === 'number' ? supportScore.toFixed(2) : supportScore} | Contradiction: ${typeof contraScore === 'number' ? contraScore.toFixed(2) : contraScore}</div>
    </div>
    ${relevantSources.length > 0 ? `
      <div style="margin-bottom: 8px;">
        <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; color: #333;">Related Sources (${relevantSources.length}):</div>
        ${relevantSources.map((source, i) => `
          <div style="margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #007bff;">
            <div style="margin-bottom: 4px;">
              <a href="${source.url}" target="_blank" style="color: #007bff; text-decoration: none; font-weight: 500; font-size: 13px; line-height: 1.3;">${source.title}</a>
            </div>
            <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
              ${source.publisher || 'Unknown Publisher'} • ${source.publishedAt ? new Date(source.publishedAt).toLocaleDateString() : 'Date unknown'}
              ${source.relevanceScore ? ` • Match Score: ${source.relevanceScore.toFixed(1)}` : ''}
            </div>
            ${source.description ? `<div style="font-size: 12px; color: #555; margin-top: 4px; line-height: 1.3;">${source.description.slice(0, 130)}...</div>` : ''}
            ${source.matchDetails && source.matchDetails.length > 0 ? 
              `<div style="font-size: 11px; color: #007bff; margin-top: 4px; font-style: italic;">
                Key matches: ${source.matchDetails.slice(0, 3).join(', ')}
              </div>` : ''
            }
          </div>
        `).join('')}
      </div>
    ` : `
      <div style="font-size: 12px; color: #666; font-style: italic; text-align: center; padding: 12px; background: #f8f9fa; border-radius: 4px;">
        ${pageData.sources && pageData.sources.length > 0 ? 
          '⚠️ No sources found specifically related to this claim.<br><small>This may indicate the claim needs more context or verification.</small>' : 
          '🔍 Sources are still being analyzed...'}
      </div>
    `}
  `;
  
  highlight.appendChild(sourcesPanel);
  
  // Scroll to the highlighted element
  highlight.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
  
  // Store reference for cleanup
  window.currentClaimHighlight = highlight;
}

/**
 * Clear any existing claim details
 */
function clearClaimDetails() {
  const existingHighlights = document.querySelectorAll('.fact-check-highlight-wrapper.persistent');
  existingHighlights.forEach(highlight => {
    if (highlight.parentNode && highlight.firstChild) {
      // Find the original element (not the close button or sources panel)
      const originalElement = Array.from(highlight.childNodes).find(child => 
        child.nodeType === Node.ELEMENT_NODE && 
        !child.classList.contains('fact-check-close-highlight') && 
        !child.classList.contains('fact-check-sources-panel')
      );
      
      if (originalElement) {
        highlight.parentNode.insertBefore(originalElement, highlight);
      }
      highlight.remove();
    }
  });
  
  // Also clear any temporary highlights
  clearHighlights();
}

/**
 * Get relevant sources for a specific claim using advanced matching
 */
function getRelevantSourcesForClaim(claimData, allSources) {
  if (!claimData || !allSources || allSources.length === 0) {
    return [];
  }
  
  // Extract key terms from the claim
  const claimText = claimData.text || '';
  console.log('Finding sources for claim:', claimText.slice(0, 100) + '...');
  
  // Advanced text processing for better matching
  const claimWords = claimText.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['that', 'this', 'with', 'they', 'their', 'there', 'have', 'been', 'will', 'would', 'could', 'should', 'from', 'into', 'over', 'under', 'above', 'below'].includes(word));
  
  // Extract numbers, dates, and named entities for precise matching
  const numbers = claimText.match(/\d+\.?\d*%?|\$[\d,]+/g) || [];
  const years = claimText.match(/\b(19|20)\d{2}\b/g) || [];
  const properNouns = claimText.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  const organizations = claimText.match(/\b[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*(?:\s+(?:Inc|Corp|LLC|Ltd|Company|Organization|Agency|Department|Ministry|Institute|University|College))\b/g) || [];
  
  console.log('Claim analysis:', {
    words: claimWords.slice(0, 10),
    numbers: numbers,
    years: years,
    properNouns: properNouns.slice(0, 5),
    organizations: organizations
  });
  
  // Score sources based on multiple relevance factors
  const scoredSources = allSources.map((source, index) => {
    const sourceText = `${source.title || ''} ${source.description || ''}`.toLowerCase();
    let score = 0;
    let matchDetails = [];
    
    // 1. Exact number/percentage matching (high priority)
    numbers.forEach(num => {
      if (sourceText.includes(num.toLowerCase())) {
        score += 10;
        matchDetails.push(`Number: ${num}`);
      }
    });
    
    // 2. Year matching
    years.forEach(year => {
      if (sourceText.includes(year)) {
        score += 8;
        matchDetails.push(`Year: ${year}`);
      }
    });
    
    // 3. Named entity matching (organizations, people, places)
    properNouns.forEach(noun => {
      if (noun.length > 3 && sourceText.includes(noun.toLowerCase())) {
        score += 6;
        matchDetails.push(`Entity: ${noun}`);
      }
    });
    
    // 4. Organization matching
    organizations.forEach(org => {
      if (sourceText.includes(org.toLowerCase())) {
        score += 8;
        matchDetails.push(`Organization: ${org}`);
      }
    });
    
    // 5. Key phrase matching (3-4 word combinations)
    for (let i = 0; i <= claimWords.length - 3; i++) {
      const phrase = claimWords.slice(i, i + 3).join(' ');
      if (phrase.length > 10 && sourceText.includes(phrase)) {
        score += 5;
        matchDetails.push(`Phrase: ${phrase}`);
      }
    }
    
    // 6. Keyword density scoring
    const matchingWords = claimWords.filter(word => sourceText.includes(word));
    const keywordDensity = matchingWords.length / Math.max(claimWords.length, 1);
    score += keywordDensity * 3;
    
    // 7. Title vs description weighting
    const titleText = (source.title || '').toLowerCase();
    const titleMatches = claimWords.filter(word => titleText.includes(word)).length;
    score += titleMatches * 2; // Title matches are more important
    
    // 8. Source quality bonus
    const reputableSources = ['Reuters', 'AP', 'Bloomberg', 'BBC', 'CNN', 'The Guardian', 'NPR', 'The New York Times', 'The Washington Post'];
    if (source.publisher && reputableSources.some(rs => source.publisher.includes(rs))) {
      score += 1;
    }
    
    // 9. Recency bonus for news sources
    if (source.publishedAt) {
      const daysOld = (Date.now() - new Date(source.publishedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 7) score += 2;
      else if (daysOld < 30) score += 1;
    }
    
    console.log(`Source ${index}: "${source.title?.slice(0, 50)}..." - Score: ${score.toFixed(1)}`, matchDetails);
    
    return { 
      ...source, 
      relevanceScore: score,
      matchDetails: matchDetails,
      keywordMatches: matchingWords.length
    };
  });
  
  // Filter and sort by relevance
  const relevantSources = scoredSources
    .filter(source => source.relevanceScore > 1) // Minimum threshold
    .sort((a, b) => {
      // Primary sort by relevance score
      if (Math.abs(a.relevanceScore - b.relevanceScore) > 2) {
        return b.relevanceScore - a.relevanceScore;
      }
      // Secondary sort by keyword matches
      return b.keywordMatches - a.keywordMatches;
    })
    .slice(0, 4); // Top 4 most relevant sources
  
  console.log(`Found ${relevantSources.length} relevant sources out of ${allSources.length}`);
  relevantSources.forEach((source, i) => {
    console.log(`  ${i + 1}. "${source.title?.slice(0, 60)}..." (Score: ${source.relevanceScore.toFixed(1)})`);
  });
  
  return relevantSources;
}

/**
 * Get color for verdict
 */
function getVerdictColor(verdict) {
  switch (verdict) {
    case 'strongly_supported':
    case 'supported':
    case 'weakly_supported':
      return '#28a745';
    case 'contested':
    case 'insufficient_evidence':
      return '#ffc107';
    case 'likely_false':
    case 'refuted':
    case 'weakly_refuted':
      return '#dc3545';
    default:
      return '#6c757d';
  }
}

/**
 * Format verdict for display
 */
function formatVerdict(verdict) {
  const verdictMap = {
    'strongly_supported': 'Strongly Supported',
    'supported': 'Supported',
    'weakly_supported': 'Weakly Supported',
    'contested': 'Contested',
    'insufficient_evidence': 'Insufficient Evidence',
    'likely_false': 'Likely False',
    'refuted': 'Refuted',
    'weakly_refuted': 'Weakly Refuted'
  };
  
  return verdictMap[verdict] || verdict || 'Unknown';
}

/**
 * Clear any existing highlights (temporary ones only)
 */
function clearHighlights() {
  const existingHighlights = document.querySelectorAll('.fact-check-highlight-wrapper:not(.persistent)');
  existingHighlights.forEach(highlight => {
    if (highlight.parentNode && highlight.firstChild) {
      highlight.parentNode.insertBefore(highlight.firstChild, highlight);
      highlight.remove();
    }
  });
}

/**
 * Show a temporary message when claim is not found
 */
function showClaimNotFoundMessage(claimElement) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'claim-not-found-message';
  messageDiv.textContent = 'Claim text not found in article';
  messageDiv.style.cssText = `
    position: absolute;
    background: #dc3545;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
    z-index: 1000;
    opacity: 0;
    animation: fadeInOut 2s ease-in-out;
  `;
  
  claimElement.style.position = 'relative';
  claimElement.appendChild(messageDiv);
  
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 2000);
}

function createFactCheckOverlay() {
  // Create toggle button
  toggleButton = document.createElement('button');
  toggleButton.className = 'fact-check-toggle';
  toggleButton.innerHTML = '🔍';
  toggleButton.title = 'Show Fact Check Results';
  
  // Create overlay
  factCheckOverlay = document.createElement('div');
  factCheckOverlay.className = 'fact-check-overlay';
  factCheckOverlay.innerHTML = `
    <div class="fact-check-header">
      <h2 class="fact-check-title">Real-time Fact Check</h2>
      <button class="fact-check-close">×</button>
    </div>
    <div class="fact-check-content">
      <div class="fact-check-status">
        <div class="fact-check-loading"></div>
        <span class="status-text">Analyzing page content...</span>
      </div>
      <div class="fact-check-sections">
        <div class="page-type-section" style="display: none;"></div>
        <div class="claims-section" style="display: none;">
          <h3>Claims Analysis</h3>
          <div class="claims-container"></div>
        </div>
        <div class="sources-section" style="display: none;">
          <h3>Sources</h3>
          <div class="sources-container"></div>
        </div>
        <div class="consensus-section" style="display: none;"></div>
      </div>
    </div>
  `;
  
  // Add event listeners
  toggleButton.addEventListener('click', showOverlay);
  factCheckOverlay.querySelector('.fact-check-close').addEventListener('click', hideOverlay);
  
  // Add to page
  document.body.appendChild(toggleButton);
  document.body.appendChild(factCheckOverlay);
  
  // Auto-show overlay immediately
  showOverlay();
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

function updateStatus(message) {
  if (!factCheckOverlay) return;
  const statusText = factCheckOverlay.querySelector('.status-text');
  if (statusText) {
    statusText.textContent = message;
  }
}

function updatePageType(pageType) {
  if (!factCheckOverlay) return;
  const section = factCheckOverlay.querySelector('.page-type-section');
  section.innerHTML = `
    <div class="fact-check-section">
      <h3>Page Type</h3>
      <span class="page-type-badge">${pageType.label || 'unknown'}</span>
      <span class="confidence-score">(conf: ${(pageType.score || 0).toFixed(2)})</span>
    </div>
  `;
  section.style.display = 'block';
}

function addClaimResult(claimData) {
  if (!factCheckOverlay) return;
  
  const claimsSection = factCheckOverlay.querySelector('.claims-section');
  const claimsContainer = factCheckOverlay.querySelector('.claims-container');
  
  claimsSection.style.display = 'block';
  
  const claim = claimData.claim;
  const emoji = getClaimEmoji(claim.verdict);
  
  const claimElement = document.createElement('div');
  claimElement.className = 'claim-item new';
  claimElement.setAttribute('data-verdict', claim.verdict);
  claimElement.style.cursor = 'pointer';
  claimElement.title = 'Click to find this claim in the article';
  
  claimElement.innerHTML = `
    <div class="claim-text">
      <span class="claim-emoji">${emoji}</span>
      <span class="claim-content">${claim.text}</span>
      <span class="claim-highlight-hint">📍</span>
    </div>
    <div class="claim-scores">
      Support: ${claim.support} | Contradiction: ${claim.contradiction} | Verdict: ${claim.verdict}
    </div>
    <div class="claim-progress">
      Claim ${claimData.index + 1} of ${claimData.total}
    </div>
  `;
  
  // Add click handler to highlight claim in article and show sources
  claimElement.addEventListener('click', (e) => {
    e.preventDefault();
    console.log('Claim clicked:', claim.text.slice(0, 50) + '...');
    
    const found = findAndHighlightClaim(claim.text, claim);
    
    if (found) {
      console.log('Claim successfully highlighted');
      // Visual feedback that claim was found
      claimElement.style.transform = 'scale(0.98)';
      setTimeout(() => {
        claimElement.style.transform = '';
      }, 150);
    } else {
      console.log('Claim not found in article');
      // Show message if claim not found
      showClaimNotFoundMessage(claimElement);
    }
  });
  
  claimsContainer.appendChild(claimElement);
  
  // Remove the animation class after animation completes
  setTimeout(() => {
    claimElement.classList.remove('new');
  }, 500);
  
  // Scroll to show new claim
  claimElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateSources(sources) {
  if (!factCheckOverlay || !sources || sources.length === 0) return;
  
  const sourcesSection = factCheckOverlay.querySelector('.sources-section');
  const sourcesContainer = factCheckOverlay.querySelector('.sources-container');
  
  sourcesSection.style.display = 'block';
  
  sourcesContainer.innerHTML = sources.map(source => `
    <div class="source-item">
      <a href="${source.url}" target="_blank" class="source-link">
        ${source.title || source.url}
      </a>
      ${source.publisher ? `<div class="source-publisher">${source.publisher}</div>` : ''}
    </div>
  `).join('');
}

function updateConsensus(consensus) {
  if (!factCheckOverlay || !consensus) return;
  
  const section = factCheckOverlay.querySelector('.consensus-section');
  section.innerHTML = `
    <div class="fact-check-section">
      <h3>Final Consensus</h3>
      <div class="consensus-text">${consensus.summary || '—'}</div>
      <div class="consensus-disclaimer">${consensus.disclaimer || ''}</div>
      ${consensus.sources_analyzed ? `<div class="consensus-stats">Sources analyzed: ${consensus.sources_analyzed} | Reputable sources: ${consensus.reputable_sources || 0}</div>` : ''}
    </div>
  `;
  section.style.display = 'block';
}

function getClaimEmoji(verdict) {
  switch (verdict) {
    case 'strongly_supported': return '✅';
    case 'supported': return '✅';
    case 'weakly_supported': return '☑️';
    case 'contested': return '⚠️';
    case 'insufficient_evidence': return '❓';
    case 'likely_false': return '❌';
    case 'refuted': return '❌';
    case 'weakly_refuted': return '⚠️';
    default: return '❓';
  }
}

function handleStreamingUpdate(data) {
  switch (data.type) {
    case 'status':
      updateStatus(data.message);
      break;
      
    case 'page_type':
      pageData.pageType = data.data;
      updatePageType(data.data);
      break;
      
    case 'claims_extracted':
      updateStatus(`Found ${data.data.count} claims to analyze`);
      break;
      
    case 'sources_found':
      pageData.sources = data.data.sources;
      updateSources(data.data.sources);
      updateStatus(`Found ${data.data.count} sources`);
      break;
      
    case 'claim_result':
      pageData.claims.push(data.data.claim);
      addClaimResult(data.data);
      break;
      
    case 'complete':
      pageData.consensus = data.data.consensus;
      updateConsensus(data.data.consensus);
      updateStatus('Analysis complete!');
      isAnalyzing = false; // Reset analyzing state
      
      // Hide loading indicator
      const loading = factCheckOverlay.querySelector('.fact-check-loading');
      if (loading) loading.style.display = 'none';
      break;
      
    case 'error':
      updateStatus(`Error: ${data.message}`);
      isAnalyzing = false; // Reset analyzing state
      const loadingError = factCheckOverlay.querySelector('.fact-check-loading');
      if (loadingError) loadingError.style.display = 'none';
      break;
  }
}

// Listen for streaming updates from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'FACTCHECK_UPDATE') {
    handleStreamingUpdate(message.data);
  }
});

// Initialize when page loads - also add cleanup listeners
document.addEventListener('DOMContentLoaded', () => {
  initializeExtension();
});

// Also initialize if DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  initializeExtension();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  clearClaimDetails();
  clearFactCheckOverlay();
});

// Clean up when switching pages (for SPAs)
let currentUrl = location.href;
setInterval(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    clearClaimDetails();
    clearFactCheckOverlay();
    // Re-initialize for new page
    setTimeout(() => {
      initializeExtension();
    }, 1000);
  }
}, 1000);