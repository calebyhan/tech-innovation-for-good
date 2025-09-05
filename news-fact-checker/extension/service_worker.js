const API_BASE = "http://localhost:3000";

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type !== "PAGE_CONTENT") return;
  
  try {
    console.log('Analyzing page content for tab:', sender.tab.id);
    
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload)
    });
    
    const result = await res.json();
    console.log('Analysis complete, sending result to content script');
    
    // Send result directly to the content script
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "FACTCHECK_RESULT",
      data: result
    });
    
  } catch (error) {
    console.error('Analysis failed:', error);
    
    // Send error to content script
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "FACTCHECK_RESULT", 
      data: { error: String(error) }
    });
  }
  
  sendResponse({ ok: true });
  return true;
});