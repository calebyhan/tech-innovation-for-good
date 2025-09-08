document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('factCheckToggle');
  const statusText = document.getElementById('statusText');
  const statusSection = document.getElementById('statusSection');
  const pageInfo = document.getElementById('pageInfo');
  const pageType = document.getElementById('pageType');
  const pageUrl = document.getElementById('pageUrl');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  
  // Load current toggle state
  const { factCheckEnabled = true } = await chrome.storage.sync.get(['factCheckEnabled']);
  updateToggleState(factCheckEnabled);
  
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab) {
    pageUrl.textContent = tab.url;
    
    // Check if current page is a news article
    try {
      const [result] = await chrome.tabs.sendMessage(tab.id, { 
        action: 'checkPageType' 
      }).catch(() => [null]);
      
      if (result) {
        updatePageStatus(result, factCheckEnabled);
      } else {
        statusText.textContent = 'Content script not loaded on this page';
        statusSection.style.background = '#fff3cd';
        statusSection.style.borderColor = '#ffeaa7';
      }
    } catch (error) {
      console.error('Error checking page type:', error);
      statusText.textContent = 'Unable to analyze this page type';
      statusSection.style.background = '#f8d7da';
      statusSection.style.borderColor = '#f5c6cb';
    }
  }
  
  // Toggle event listener
  toggle.addEventListener('click', async () => {
    const newState = !toggle.classList.contains('active');
    await chrome.storage.sync.set({ factCheckEnabled: newState });
    updateToggleState(newState);
    
    // Update status for current page
    if (tab) {
      try {
        const [result] = await chrome.tabs.sendMessage(tab.id, { 
          action: 'checkPageType' 
        }).catch(() => [null]);
        
        if (result) {
          updatePageStatus(result, newState);
        }
      } catch (error) {
        console.error('Error updating page status:', error);
      }
    }
    
    // Notify content script of the change
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { 
        action: 'updateSettings', 
        factCheckEnabled: newState 
      }).catch(() => {
        // Content script might not be loaded, that's OK
      });
    }
  });
  
  // Analyze button
  analyzeBtn.addEventListener('click', async () => {
    if (tab && tab.id) {
      analyzeBtn.textContent = 'Analyzing...';
      analyzeBtn.disabled = true;
      
      try {
        await chrome.tabs.sendMessage(tab.id, { 
          action: 'forceAnalyze' 
        });
        
        // Update status to show manual analysis is running
        statusText.textContent = '🔍 Manual analysis in progress...';
        statusSection.style.background = '#e3f2fd';
        statusSection.style.borderColor = '#2196f3';
        
        // Close popup after triggering analysis
        setTimeout(() => window.close(), 800);
      } catch (error) {
        console.error('Error triggering analysis:', error);
        analyzeBtn.textContent = 'Analyze This Page';
        analyzeBtn.disabled = false;
        
        // Show error feedback
        statusText.textContent = '❌ Failed to start analysis. Make sure the page is loaded.';
        statusSection.style.background = '#ffebee';
        statusSection.style.borderColor = '#f44336';
      }
    }
  });
  
  // Settings button (placeholder)
  settingsBtn.addEventListener('click', () => {
    // For now, just show an alert. In the future, this could open options page
    alert('Settings panel coming soon!');
  });
  
  function updateToggleState(enabled) {
    if (enabled) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }
  
  function updatePageStatus(pageData, enabled) {
    const isNewsArticle = pageData.isNewsArticle;
    const pageTypeText = pageData.pageType || 'Unknown';
    
    pageInfo.style.display = 'block';
    pageType.textContent = `Page Type: ${pageTypeText}`;
    
    if (enabled && isNewsArticle) {
      statusText.textContent = '✅ Fact-checking is active on this news article';
      statusSection.style.background = '#d4edda';
      statusSection.style.borderColor = '#c3e6cb';
      analyzeBtn.textContent = 'Re-analyze Page';
    } else if (enabled && !isNewsArticle) {
      statusText.textContent = '⚪ Page detected as non-news content. Fact-checking disabled.';
      statusSection.style.background = '#fff3cd';
      statusSection.style.borderColor = '#ffeaa7';
      analyzeBtn.textContent = 'Force Analyze';
    } else if (!enabled) {
      statusText.textContent = '⏸️ Fact-checking is disabled';
      statusSection.style.background = '#f8d7da';
      statusSection.style.borderColor = '#f5c6cb';
      analyzeBtn.textContent = 'Analyze This Page';
    }
  }
});
