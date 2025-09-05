const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { HfInference } = require('@huggingface/inference');
const natural = require('natural');
const nlp = require('compromise');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Hugging Face client
const hf = new HfInference(process.env.HF_TOKEN);

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_SEARCH_URL = 'https://newsapi.org/v2/everything';

// Helper functions
function extractClaimLikeSentences(text, k = 5) {
  // Split into sentences using natural language processing
  const doc = nlp(text);
  const sentences = doc.sentences().out('array');
  
  // Filter out UI/navigation elements and non-claim sentences
  const candidates = sentences
    .filter(s => s.length >= 60 && s.length <= 300)
    .filter(s => !isUIElement(s))
    .map(sentence => ({
      text: sentence,
      score: scoreAssertion(sentence)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(item => item.text);
    
  return candidates;
}

function isUIElement(sentence) {
  const uiKeywords = [
    'arrow_back', 'logout', 'back to home', 'update email', 'change password',
    'api key', 'subscription', 'developer plan', 'manage subscription',
    'usage requests', 'resetting in', 'usage history', 'follow us on twitter',
    'click here', 'sign up', 'log in', 'menu', 'navigation', 'search',
    'newsletter', 'subscribe', 'unsubscribe', 'privacy policy', 'terms of service',
    'cookies', 'advertisement', 'sponsored', 'read more', 'show more',
    'load more', 'next page', 'previous page'
  ];
  
  const lowerSentence = sentence.toLowerCase();
  return uiKeywords.some(keyword => lowerSentence.includes(keyword)) ||
         /^\s*(home|about|contact|help|faq|support)\s*$/i.test(sentence.trim()) ||
         sentence.includes('©') || sentence.includes('®') ||
         /^\s*\d+\s+(minutes?|hours?|days?)\s+ago\s*$/i.test(sentence.trim());
}

function scoreAssertion(sentence) {
  let score = 0;
  
  // Check for numbers, percentages, currency
  if (/\b\d{4}\b|\b\d+(\.\d+)?%|\$\d+/.test(sentence)) score += 1.5;
  
  // Check for months/dates
  if (/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(sentence)) score += 1.0;
  
  // Check for reporting verbs
  if (/\b(said|according to|reports?|announced|confirmed)\b/i.test(sentence)) score += 1.0;
  
  // Check for present/past tense verbs
  if (/\b(will|is|are|was|were|has|have)\b/i.test(sentence)) score += 0.3;
  
  // Length factor
  score += Math.min(sentence.length / 180, 1.0);
  
  return score;
}

async function searchNews(query, n = 8) {
  if (!NEWS_API_KEY) {
    console.log('No NEWS_API_KEY provided, returning mock sources');
    // Return mock sources for testing when no API key is available
    return [
      {
        title: 'Sample News Article 1',
        url: 'https://example.com/article1',
        publisher: 'Example News',
        description: 'This is a sample news article description for testing purposes.'
      },
      {
        title: 'Sample News Article 2', 
        url: 'https://example.com/article2',
        publisher: 'Test Media',
        description: 'Another sample article description to demonstrate the fact checking functionality.'
      }
    ];
  }
  
  try {
    console.log('Searching news for query:', query);
    const response = await axios.get(NEWS_SEARCH_URL, {
      params: {
        q: query,
        pageSize: n,
        sortBy: 'relevancy',
        language: 'en',
        apiKey: NEWS_API_KEY
      },
      timeout: 10000
    });
    
    console.log('News API response status:', response.status);
    console.log('Found articles:', response.data.articles?.length || 0);
    
    if (response.status !== 200) return [];
    
    const articles = response.data.articles?.map(article => ({
      title: article.title,
      url: article.url,
      publisher: article.source?.name,
      description: article.description
    })) || [];
    
    console.log('Processed articles:', articles.length);
    return articles;
  } catch (error) {
    console.error('News search error:', error.message);
    return [];
  }
}

async function classifyPageType(text) {
  try {
    const labels = ['news article', 'opinion', 'blog', 'research report', 'fact page'];
    const result = await hf.zeroShotClassification({
      inputs: text.slice(0, 4000), // Cap tokens
      parameters: { candidate_labels: labels }
    });
    
    console.log('Classification result:', result); // Debug log
    
    // Handle different possible response formats
    if (Array.isArray(result)) {
      const firstResult = result[0];
      return {
        label: firstResult.labels?.[0] || firstResult.label || 'unknown',
        score: firstResult.scores?.[0] || firstResult.score || 0.0
      };
    } else if (result.labels && result.scores) {
      return {
        label: result.labels[0],
        score: result.scores[0]
      };
    } else if (result.label) {
      return {
        label: result.label,
        score: result.score || 0.0
      };
    } else {
      console.warn('Unexpected classification result format:', result);
      return { label: 'unknown', score: 0.0 };
    }
  } catch (error) {
    console.error('Page type classification error:', error.message);
    return { label: 'unknown', score: 0.0 };
  }
}

async function performNLI(premise, hypothesis) {
  try {
    const result = await hf.zeroShotClassification({
      inputs: premise,
      parameters: { 
        candidate_labels: ['true', 'false'],
        hypothesis_template: hypothesis
      }
    });
    
    console.log('NLI result:', result); // Debug log
    
    // Handle different possible response formats
    let labels, scores;
    if (Array.isArray(result)) {
      const firstResult = result[0];
      labels = firstResult.labels || [];
      scores = firstResult.scores || [];
    } else {
      labels = result.labels || [];
      scores = result.scores || [];
    }
    
    const entailIndex = labels.indexOf('true');
    const contraIndex = labels.indexOf('false');
    
    return {
      entail: entailIndex !== -1 ? scores[entailIndex] : 0.0,
      contra: contraIndex !== -1 ? scores[contraIndex] : 0.0
    };
  } catch (error) {
    console.error('NLI error:', error.message);
    return { entail: 0.0, contra: 0.0 };
  }
}

async function summarizeText(text) {
  if (!text.trim()) return text;
  
  // Skip summarization if text is too short or looks like error/API response
  if (text.length < 50 || text.includes('Developer plan') || text.includes('API key')) {
    return text;
  }
  
  try {
    const result = await hf.summarization({
      inputs: text.slice(0, 1000), // Limit input length
      parameters: {
        max_length: 100,
        min_length: 30,
        do_sample: false
      }
    });
    
    console.log('Summarization result:', result); // Debug log
    
    // Handle different possible response formats
    let summary;
    if (Array.isArray(result)) {
      summary = result[0]?.summary_text || result[0]?.generated_text || text;
    } else {
      summary = result.summary_text || result.generated_text || text;
    }
    
    // If summary looks like an error or API response, return original
    if (summary.includes('Developer plan') || summary.includes('API key') || summary.includes('subscription')) {
      return text;
    }
    
    return summary;
  } catch (error) {
    console.error('Summarization error:', error.message);
    return text;
  }
}

function calculateConsensus(entailScores, contraScores) {
  const avgEntail = entailScores.length > 0 ? entailScores.reduce((a, b) => a + b, 0) / entailScores.length : 0;
  const avgContra = contraScores.length > 0 ? contraScores.reduce((a, b) => a + b, 0) / contraScores.length : 0;
  
  if (avgEntail >= 0.55 && avgContra <= 0.25) return 'supported';
  if (avgContra >= 0.55 && avgEntail <= 0.25) return 'refuted';
  return 'contested';
}

// Simple cosine similarity for text embeddings (using TF-IDF as approximation)
function calculateSimilarity(text1, text2) {
  const tfidf = new natural.TfIdf();
  tfidf.addDocument(text1);
  tfidf.addDocument(text2);
  
  // Get TF-IDF vectors
  const terms = new Set();
  tfidf.listTerms(0).forEach(item => terms.add(item.term));
  tfidf.listTerms(1).forEach(item => terms.add(item.term));
  
  const vec1 = [], vec2 = [];
  Array.from(terms).forEach(term => {
    vec1.push(tfidf.tfidf(term, 0));
    vec2.push(tfidf.tfidf(term, 1));
  });
  
  // Cosine similarity
  const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
  const mag1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
  const mag2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
  
  return mag1 && mag2 ? dotProduct / (mag1 * mag2) : 0;
}

// Main analysis endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { url, title, text } = req.body;
    
    // 1. Page type detection
    const pageType = await classifyPageType(text);
    
    // 2. Claim mining
    const claims = extractClaimLikeSentences(text, 4);
    
    // 3. Evidence retrieval
    const searchQuery = title + (claims.length > 0 ? ' ' + claims[0].slice(0, 160) : '');
    const sources = await searchNews(searchQuery, 8);
    
    // Build evidence texts from search results
    const evidenceTexts = sources
      .map(source => `${source.title || ''}. ${source.description || ''}`.trim())
      .filter(text => text.length > 0);
    
    // 4. Rank evidence by similarity (simple approximation)
    let rankedEvidence = evidenceTexts;
    if (claims.length > 0 && evidenceTexts.length > 0) {
      const queryText = claims[0];
      const similarities = evidenceTexts.map(evidence => ({
        text: evidence,
        similarity: calculateSimilarity(queryText, evidence)
      }));
      
      rankedEvidence = similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 6)
        .map(item => item.text);
    }
    
    // 5. Score each claim against evidence (NLI)
    const resultClaims = [];
    for (const claim of claims) {
      const entailScores = [];
      const contraScores = [];
      
      for (const evidence of rankedEvidence) {
        const nliResult = await performNLI(evidence, claim);
        entailScores.push(nliResult.entail);
        contraScores.push(nliResult.contra);
      }
      
      const avgEntail = entailScores.length > 0 ? entailScores.reduce((a, b) => a + b, 0) / entailScores.length : 0;
      const avgContra = contraScores.length > 0 ? contraScores.reduce((a, b) => a + b, 0) / contraScores.length : 0;
      
      resultClaims.push({
        text: claim,
        entail_score: avgEntail,
        contra_score: avgContra,
        consensus: calculateConsensus(entailScores, contraScores)
      });
    }
    
    // 6. Consensus summary
    const supported = resultClaims.filter(c => c.consensus === 'supported').map(c => c.text);
    const contested = resultClaims.filter(c => c.consensus === 'contested').map(c => c.text);
    const refuted = resultClaims.filter(c => c.consensus === 'refuted').map(c => c.text);
    
    const bullets = [];
    if (supported.length > 0) bullets.push('Generally supported: ' + supported.slice(0, 2).join('; '));
    if (contested.length > 0) bullets.push('Contested/unclear: ' + contested.slice(0, 2).join('; '));
    if (refuted.length > 0) bullets.push('Likely incorrect: ' + refuted.slice(0, 2).join('; '));
    
    const baseSummary = bullets.join(' ') || 'Insufficient evidence for consensus.';
    const summaryText = await summarizeText(baseSummary);
    
    res.json({
      page_type: pageType,
      claims: resultClaims,
      consensus: {
        summary: summaryText,
        disclaimer: 'Consensus is estimated from multiple sources using automated NLI and may be imperfect.'
      },
      sources: sources
    });
    
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ error: 'Analysis failed: ' + error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`News fact checker backend running on port ${PORT}`);
});