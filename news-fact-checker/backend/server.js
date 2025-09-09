const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { HfInference } = require('@huggingface/inference');
const natural = require('natural');
const nlp = require('compromise');
require('dotenv').config();

// Configure axios with connection pooling
const { Agent } = require('https');
const httpsAgent = new Agent({
  maxSockets: 10,
  keepAlive: true,
  keepAliveMsecs: 30000
});

axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 8000;

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Hugging Face client with timeout configuration
const hf = new HfInference(process.env.HF_TOKEN);

// Performance optimizations
const NLI_CACHE = new Map();
const API_CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_CACHE_SIZE = 1000;

// Batch processing configuration
const MAX_CONCURRENT_NLI = 3;
const MAX_CONCURRENT_API = 2;

// Check if HF token is configured
if (!process.env.HF_TOKEN) {
  console.warn('WARNING: HF_TOKEN not configured. NLI will use fallback heuristics.');
}

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_KEY_1 = process.env.NEWS_API_KEY_1; // Backup API key
const NEWS_SEARCH_URL = 'https://newsapi.org/v2/everything';

// Track which API key to use and rate limit status
let currentApiKeyIndex = 0;
const apiKeys = [NEWS_API_KEY, NEWS_API_KEY_1].filter(Boolean); // Filter out undefined keys
let rateLimitedKeys = new Set(); // Track which keys are rate limited

// Enhanced Helper Functions

/**
 * Extract factual claims using improved heuristics and NLP
 */
function extractFactualClaims(text, k = 10) {
  // Pre-filter text to reduce processing overhead
  const cleanedText = text.slice(0, 10000); // Limit text length
  const doc = nlp(cleanedText);
  const sentences = doc.sentences().out('array');
  
  // Enhanced filtering and scoring with better non-relevant content detection
  const candidates = sentences
    .filter(s => s.length >= 40 && s.length <= 400) // Slightly more lenient length
    .filter(s => !isUIElement(s))
    .filter(s => !isNavigationContent(s))
    .filter(s => !isAdvertisingContent(s))
    .filter(s => !isOpinion(s))
    .filter(s => !isMetadata(s))
    .map(sentence => ({
      text: cleanSentence(sentence),
      score: scoreFactualClaim(sentence),
      entities: extractEntities(sentence)
    }))
    .filter(item => item.score > 0.4) // Lower threshold to get more claims
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(k, 15)); // Allow up to 15 claims max
    
  return candidates;
}

/**
 * Clean sentence by removing unnecessary elements
 */
function cleanSentence(sentence) {
  return sentence
    .replace(/\[.*?\]/g, '') // Remove citations
    .replace(/\(.*?\)/g, '') // Remove parentheticals
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if sentence is likely opinion vs fact
 */
function isOpinion(sentence) {
  const opinionMarkers = [
    'believe', 'think', 'feel', 'opinion', 'seems', 'appears',
    'might', 'could', 'should', 'ought', 'probably', 'possibly',
    'arguably', 'supposedly', 'allegedly', 'reportedly'
  ];
  
  const lowerSentence = sentence.toLowerCase();
  const opinionScore = opinionMarkers.reduce((score, marker) => {
    return score + (lowerSentence.includes(marker) ? 1 : 0);
  }, 0);
  
  return opinionScore >= 2;
}

/**
 * Enhanced claim scoring with more sophisticated heuristics
 */
function scoreFactualClaim(sentence) {
  let score = 0;
  const lowerSentence = sentence.toLowerCase();
  
  // Strong factual indicators
  // Statistics and numbers
  if (/\b\d+(\.\d+)?%/.test(sentence)) score += 2.0; // Percentages
  if (/\$[\d,]+(\.\d+)?[BMK]?/.test(sentence)) score += 1.8; // Currency
  if (/\b\d{1,3}(,\d{3})+/.test(sentence)) score += 1.5; // Large numbers
  
  // Temporal specificity
  if (/\b(20\d{2}|19\d{2})\b/.test(sentence)) score += 1.5; // Years
  if (/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i.test(sentence)) score += 1.8;
  
  // Attribution and sources
  const attributionPatterns = [
    /according to [\w\s]+/i,
    /\bstudy\s+(by|from|conducted)/i,
    /\bresearch(ers?)?\s+(show|found|indicate)/i,
    /\breport(s|ed)?\s+(by|from|that)/i,
    /\bsurvey\s+(of|by|shows)/i,
    /\bdata\s+(from|shows|indicates)/i
  ];
  
  attributionPatterns.forEach(pattern => {
    if (pattern.test(sentence)) score += 1.5;
  });
  
  // Comparative claims
  if (/\b(more|less|fewer|greater|higher|lower)\s+than\b/i.test(sentence)) score += 1.2;
  if (/\b(increased?|decreased?|rose|fell|jumped|dropped)\s+by?\s+\d+/i.test(sentence)) score += 1.5;
  
  // Named entities (proper nouns)
  const properNouns = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  score += Math.min(properNouns.length * 0.3, 1.5);
  
  // Causal claims
  if (/\b(caused?|leads?\s+to|results?\s+in|because\s+of)\b/i.test(sentence)) score += 1.0;
  
  // Length and complexity factor
  const wordCount = sentence.split(/\s+/).length;
  if (wordCount >= 15 && wordCount <= 40) score += 0.5;
  
  // Penalize vague language
  const vagueTerms = ['some', 'many', 'several', 'various', 'certain'];
  vagueTerms.forEach(term => {
    if (lowerSentence.includes(term)) score -= 0.3;
  });
  
  return Math.max(score, 0);
}

/**
 * Extract named entities for better search queries
 */
function extractEntities(sentence) {
  const doc = nlp(sentence);
  const entities = {
    people: doc.people().out('array'),
    places: doc.places().out('array'),
    organizations: doc.organizations().out('array'),
    dates: doc.match('#Date').out('array'),
    values: doc.values().out('array')
  };
  
  // Also extract acronyms and proper nouns
  const acronyms = sentence.match(/\b[A-Z]{2,}\b/g) || [];
  const properNouns = sentence.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) || [];
  
  return {
    ...entities,
    acronyms,
    properNouns: properNouns.filter(pn => !entities.people.includes(pn) && !entities.places.includes(pn))
  };
}

/**
 * Build optimized search queries from claims
 */
function buildSearchQueries(claim, entities) {
  const queries = [];
  
  // Filter out generic or UI-related text
  const skipTerms = ['realtime', 'fact', 'check', 'analyzing', 'page', 'content', 'click', 'here'];
  
  // Primary query: key entities + numbers
  const numbers = claim.text.match(/\d+\.?\d*%?/g) || [];
  const primaryTerms = [
    ...entities.people.slice(0, 2),
    ...entities.organizations.slice(0, 2),
    ...entities.places.slice(0, 1),
    ...numbers.slice(0, 1)
  ].filter(Boolean).filter(term => 
    !skipTerms.some(skip => term.toLowerCase().includes(skip.toLowerCase()))
  );
  
  if (primaryTerms.length > 0) {
    queries.push(primaryTerms.join(' '));
  }
  
  // Secondary query: action verbs + objects
  const doc = nlp(claim.text);
  const verbs = doc.verbs().out('array').slice(0, 2);
  const nouns = doc.nouns().out('array').slice(0, 3).filter(noun => 
    noun.length > 3 && !skipTerms.some(skip => noun.toLowerCase().includes(skip.toLowerCase()))
  );
  
  if (verbs.length > 0 && nouns.length > 0) {
    queries.push(`${verbs[0]} ${nouns.join(' ')}`);
  }
  
  // Fallback: simplified claim (avoid generic terms)
  const simplifiedClaim = claim.text
    .replace(/[^\w\s%$]/g, '')
    .split(' ')
    .filter(word => word.length > 3)
    .filter(word => !skipTerms.some(skip => word.toLowerCase().includes(skip.toLowerCase())))
    .slice(0, 8)
    .join(' ');
  
  if (simplifiedClaim.length > 10) {
    queries.push(simplifiedClaim);
  }
  
  // If no good queries, return a single generic fallback
  if (queries.length === 0) {
    console.log('No specific search terms found, using generic fallback');
    queries.push('news recent developments');
  }
  
  return queries.filter(q => q.length > 0).slice(0, 3);
}

/**
 * Get the next available API key that isn't rate limited
 */
function getAvailableApiKey() {
  if (apiKeys.length === 0) {
    return null;
  }
  
  // If all keys are rate limited, reset the tracking (they might have recovered)
  if (rateLimitedKeys.size === apiKeys.length) {
    console.log('All API keys were rate limited, resetting status...');
    rateLimitedKeys.clear();
  }
  
  // Find next available key
  for (let i = 0; i < apiKeys.length; i++) {
    const keyIndex = (currentApiKeyIndex + i) % apiKeys.length;
    const key = apiKeys[keyIndex];
    
    if (!rateLimitedKeys.has(key)) {
      currentApiKeyIndex = keyIndex;
      return key;
    }
  }
  
  // Fallback to first key if somehow no keys are available
  return apiKeys[0];
}

/**
 * Mark an API key as rate limited
 */
function markApiKeyRateLimited(apiKey) {
  rateLimitedKeys.add(apiKey);
  console.log(`API key ending in ...${apiKey.slice(-4)} marked as rate limited. Available keys: ${apiKeys.length - rateLimitedKeys.size}`);
  
  // Switch to next available key
  currentApiKeyIndex = (currentApiKeyIndex + 1) % apiKeys.length;
}

/**
 * Enhanced news search with caching and parallel processing
 */
async function searchNewsEnhanced(queries, n = 10) {
  // Check cache first
  const cacheKey = queries.sort().join('|');
  if (API_CACHE.has(cacheKey)) {
    const cached = API_CACHE.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('Using cached API results');
      return cached.result;
    }
    API_CACHE.delete(cacheKey);
  }
  if (apiKeys.length === 0) {
    console.log('No NEWS_API_KEY provided, returning mock sources');
    return getMockSources();
  }
  
  const allArticles = new Map(); // Use Map to deduplicate by URL
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  for (const query of queries) {
    let success = false;
    let lastError = null;
    
    // Try each available API key
    for (let attempt = 0; attempt < apiKeys.length && !success; attempt++) {
      const currentApiKey = getAvailableApiKey();
      
      if (!currentApiKey) {
        console.log('No available API keys, using mock sources');
        return getMockSources();
      }
      
      try {
        console.log(`Searching news for query: "${query}" with API key ending in ...${currentApiKey.slice(-4)}`);
        
        const response = await axios.get(NEWS_SEARCH_URL, {
          params: {
            q: query,
            pageSize: Math.ceil(n / queries.length) + 2,
            sortBy: 'relevancy',
            language: 'en',
            apiKey: currentApiKey
          },
          timeout: 8000
        });
        
        if (response.status === 200 && response.data.articles) {
          response.data.articles.forEach(article => {
            if (!allArticles.has(article.url)) {
              allArticles.set(article.url, {
                title: article.title,
                url: article.url,
                publisher: article.source?.name,
                description: article.description,
                publishedAt: article.publishedAt,
                content: article.content
              });
            }
          });
          success = true;
          console.log(`Successfully retrieved ${response.data.articles.length} articles for query: "${query}"`);
        }
        
      } catch (error) {
        lastError = error;
        
        if (error.response?.status === 429) {
          console.error(`Rate limit exceeded for API key ending in ...${currentApiKey.slice(-4)} on query "${query}"`);
          markApiKeyRateLimited(currentApiKey);
          
          // If we have more keys available, try the next one
          if (rateLimitedKeys.size < apiKeys.length) {
            console.log(`Trying next available API key...`);
            continue;
          } else {
            console.log('All API keys rate limited, switching to mock sources');
            return getMockSources();
          }
        } else {
          console.error(`News search error for query "${query}":`, error.message);
          // For non-rate-limit errors, don't mark the key as bad, just continue
          break;
        }
      }
    }
    
    // If we couldn't get results for this query with any key, log it but continue
    if (!success) {
      console.log(`Failed to get results for query "${query}" with all available API keys`);
    }
    
    // Reduced delay between requests for better performance
    if (queries.indexOf(query) < queries.length - 1) {
      await delay(200); // 200ms delay between requests
    }
  }
  
  // Convert to array and sort by relevance
  const articles = Array.from(allArticles.values());
  
  // If we got no articles due to rate limiting, return mock sources
  if (articles.length === 0) {
    console.log('No articles found with any API key, using mock sources as fallback');
    return getMockSources();
  }
  
  // Prefer recent, reputable sources
  const reputableSources = ['Reuters', 'AP', 'Bloomberg', 'BBC', 'CNN', 'The Guardian', 'NPR', 'The New York Times', 'The Washington Post'];
  
  articles.sort((a, b) => {
    const aReputable = reputableSources.some(source => a.publisher?.includes(source)) ? 1 : 0;
    const bReputable = reputableSources.some(source => b.publisher?.includes(source)) ? 1 : 0;
    
    if (aReputable !== bReputable) return bReputable - aReputable;
    
    // Sort by recency if both are equally reputable
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });
  
  console.log(`Successfully retrieved ${articles.length} unique articles from ${allArticles.size} total results`);
  
  const result = articles.slice(0, n);
  
  // Cache the result
  if (API_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = API_CACHE.keys().next().value;
    API_CACHE.delete(oldestKey);
  }
  API_CACHE.set(cacheKey, {
    result: result,
    timestamp: Date.now()
  });
  
  return result;
}

/**
 * Calculate how relevant a source is to a specific claim
 */
function calculateSourceRelevance(claim, source, evidence, nliResult) {
  let score = 0;
  let matchType = [];
  
  const claimText = claim.text.toLowerCase();
  const sourceText = `${source.title || ''} ${source.description || ''}`.toLowerCase();
  
  // 1. NLI score contribution (primary factor)
  const nliScore = (nliResult.entail || 0) + (nliResult.contra || 0);
  score += nliScore * 2;
  if (nliScore > 0.3) matchType.push('semantic');
  
  // 2. Entity matching
  const entities = claim.entities || {};
  let entityMatches = 0;
  
  ['people', 'places', 'organizations'].forEach(entityType => {
    if (entities[entityType]) {
      entities[entityType].forEach(entity => {
        if (entity.length > 2 && sourceText.includes(entity.toLowerCase())) {
          score += 0.5;
          entityMatches++;
        }
      });
    }
  });
  
  if (entityMatches > 0) matchType.push(`entities(${entityMatches})`);
  
  // 3. Number/percentage matching
  const claimNumbers = claimText.match(/\d+\.?\d*%?|\$[\d,]+/g) || [];
  const sourceNumbers = sourceText.match(/\d+\.?\d*%?|\$[\d,]+/g) || [];
  const numberMatches = claimNumbers.filter(num => sourceNumbers.includes(num)).length;
  score += numberMatches * 0.8;
  if (numberMatches > 0) matchType.push(`numbers(${numberMatches})`);
  
  // 4. Keyword overlap
  const claimWords = claimText.split(/\s+/).filter(w => w.length > 3);
  const sourceWords = sourceText.split(/\s+/).filter(w => w.length > 3);
  const overlap = claimWords.filter(w => sourceWords.includes(w)).length;
  const overlapRatio = overlap / Math.max(claimWords.length, 1);
  score += overlapRatio * 0.5;
  if (overlapRatio > 0.2) matchType.push(`keywords(${overlap})`);
  
  // 5. Title relevance bonus
  if (source.title) {
    const titleWords = source.title.toLowerCase().split(/\s+/);
    const titleOverlap = claimWords.filter(w => titleWords.includes(w)).length;
    score += (titleOverlap / Math.max(claimWords.length, 1)) * 0.3;
  }
  
  return {
    score: Math.min(score, 2.0), // Cap at 2.0
    matchType: matchType.join(', ') || 'minimal'
  };
}

/**
 * Improved fallback scoring using better keyword matching and semantic similarity
 */
function fallbackScoring(evidence, claim) {
  const evidenceLower = evidence.toLowerCase();
  const claimLower = claim.toLowerCase();
  
  // Extract numbers from both for comparison
  const claimNumbers = claim.match(/\d+\.?\d*%?/g) || [];
  const evidenceNumbers = evidence.match(/\d+\.?\d*%?/g) || [];
  const numberMatch = claimNumbers.some(num => evidence.includes(num));
  
  // Extract key terms (nouns, verbs, named entities)
  const claimWords = claimLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 3);
  
  // Count significant word matches
  let matchCount = 0;
  let totalSignificantWords = 0;
  
  claimWords.forEach(word => {
    // Skip common words
    const commonWords = ['that', 'this', 'which', 'what', 'when', 'where', 'there', 'have', 'been', 'will', 'would', 'could', 'should'];
    if (!commonWords.includes(word)) {
      totalSignificantWords++;
      if (evidenceLower.includes(word)) {
        matchCount++;
      }
    }
  });
  
  // Calculate base overlap score
  const overlapRatio = totalSignificantWords > 0 ? matchCount / totalSignificantWords : 0;
  
  // Look for contradiction indicators
  const contradictPatterns = [
    /\bnot?\b.*\btrue\b/i,
    /\bfalse\b/i,
    /\bincorrect\b/i,
    /\bdeni(ed|es)\b/i,
    /\bdisput(ed|es)\b/i,
    /\brefut(ed|es)\b/i,
    /\bcontrary to\b/i,
    /\bdebunk(ed|s)\b/i,
    /\bmisleading\b/i,
    /\bno evidence\b/i
  ];
  
  const hasContradiction = contradictPatterns.some(pattern => pattern.test(evidence));
  
  // Look for support indicators
  const supportPatterns = [
    /\bconfirm(s|ed)\b/i,
    /\bverif(y|ied|ies)\b/i,
    /\btrue\b/i,
    /\bcorrect\b/i,
    /\baccurate\b/i,
    /\bsupport(s|ed)\b/i,
    /\bagree(s|d)\b/i,
    /\bconsistent with\b/i,
    /\bshows? that\b/i,
    /\bproves?\b/i
  ];
  
  const hasSupport = supportPatterns.some(pattern => pattern.test(evidence));
  
  // Calculate scores based on patterns and overlap
  let entailScore = 0.0;
  let contraScore = 0.0;
  
  // Strong overlap with numbers matching suggests support
  if (overlapRatio > 0.5 && numberMatch) {
    entailScore = 0.45;
  } else if (overlapRatio > 0.4) {
    entailScore = 0.35;
  } else if (overlapRatio > 0.3) {
    entailScore = 0.25;
  } else if (overlapRatio > 0.2) {
    entailScore = 0.15;
  }
  
  // Adjust based on explicit support/contradiction indicators
  if (hasSupport && overlapRatio > 0.2) {
    entailScore = Math.min(entailScore + 0.25, 0.6);
  }
  
  if (hasContradiction && overlapRatio > 0.2) {
    contraScore = Math.max(0.35, overlapRatio * 0.7);
    entailScore *= 0.4; // Reduce support if contradiction found
  }
  
  // If there's very low overlap and no clear signals, it's probably unrelated
  if (overlapRatio < 0.15 && !hasSupport && !hasContradiction) {
    entailScore = 0.05;
    contraScore = 0.05;
  }
  
  // Ensure scores are reasonable
  entailScore = Math.min(Math.max(entailScore, 0), 0.7);
  contraScore = Math.min(Math.max(contraScore, 0), 0.7);
  
  const neutral = Math.max(0, 1.0 - entailScore - contraScore);
  
  console.log(`Fallback scoring - Overlap: ${overlapRatio.toFixed(2)}, Numbers match: ${numberMatch}, Support: ${hasSupport}, Contradiction: ${hasContradiction}`);
  console.log(`Scores - Entail: ${entailScore.toFixed(2)}, Contra: ${contraScore.toFixed(2)}, Neutral: ${neutral.toFixed(2)}`);
  
  return {
    entail: entailScore,
    contra: contraScore,
    neutral: neutral
  };
}

/**
 * Enhanced NLI with better error handling and fallback
 */
async function performEnhancedNLI(evidence, claim) {
  // First check if we have HF token
  if (!process.env.HF_TOKEN) {
    console.log('No HF_TOKEN, using fallback scoring');
    return fallbackScoring(evidence, claim);
  }
  
  try {
    console.log('Attempting HF NLI inference...');
    
    // Truncate inputs to avoid token limits
    const truncatedEvidence = evidence.slice(0, 500);
    const truncatedClaim = claim.slice(0, 200);
    
    // Check cache first
    const cacheKey = `${truncatedEvidence}||${truncatedClaim}`;
    if (NLI_CACHE.has(cacheKey)) {
      const cached = NLI_CACHE.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('Using cached NLI result');
        return cached.result;
      }
      NLI_CACHE.delete(cacheKey);
    }
    
    // Create a more specific hypothesis with reduced timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('NLI timeout')), 5000)
    );
    
    const nliPromise = hf.zeroShotClassification({
      inputs: truncatedEvidence,
      parameters: { 
        candidate_labels: ['supports', 'contradicts', 'unrelated'],
        hypothesis_template: `This text ${'{}'} the claim: ${truncatedClaim}`,
        multi_label: false
      }
    });
    
    const result = await Promise.race([nliPromise, timeoutPromise]);
    
    // Parse the result
    let labels, scores;
    if (Array.isArray(result)) {
      labels = result[0]?.labels || [];
      scores = result[0]?.scores || [];
    } else {
      labels = result?.labels || [];
      scores = result?.scores || [];
    }
    
    // Map to our scoring system
    const supportIdx = labels.indexOf('supports');
    const contradictIdx = labels.indexOf('contradicts');
    const unrelatedIdx = labels.indexOf('unrelated');
    
    const nliScores = {
      entail: supportIdx !== -1 ? scores[supportIdx] : 0.0,
      contra: contradictIdx !== -1 ? scores[contradictIdx] : 0.0,
      neutral: unrelatedIdx !== -1 ? scores[unrelatedIdx] : 0.5
    };
    
    // Validate scores - if they seem invalid, use fallback
    const totalScore = nliScores.entail + nliScores.contra + nliScores.neutral;
    if (totalScore < 0.5 || totalScore > 1.5 || isNaN(totalScore)) {
      console.log('Invalid NLI scores detected, using fallback');
      return fallbackScoring(evidence, claim);
    }
    
    console.log('NLI scores:', nliScores);
    
    // Cache the result
    if (NLI_CACHE.size >= MAX_CACHE_SIZE) {
      // Remove oldest entries
      const oldestKey = NLI_CACHE.keys().next().value;
      NLI_CACHE.delete(oldestKey);
    }
    NLI_CACHE.set(cacheKey, {
      result: nliScores,
      timestamp: Date.now()
    });
    
    return nliScores;
    
  } catch (error) {
    console.log(`NLI error: ${error.message}, using fallback scoring`);
    return fallbackScoring(evidence, claim);
  }
}

/**
 * Improved consensus calculation with better thresholds
 */
function calculateWeightedConsensus(scores, sources) {
  const reputableSources = ['Reuters', 'AP', 'Bloomberg', 'BBC', 'CNN', 'The Guardian', 'NPR', 'The New York Times', 'The Washington Post'];
  
  if (!scores || scores.length === 0) {
    return 'insufficient_evidence';
  }
  
  // Calculate weighted averages
  let weightedEntail = 0;
  let weightedContra = 0;
  let totalWeight = 0;
  let validScores = 0;
  
  scores.forEach((score, index) => {
    // Skip invalid scores
    if (!score || (score.entail === 0 && score.contra === 0 && score.neutral === 0)) {
      return;
    }
    
    validScores++;
    const source = sources[index];
    const isReputable = source && reputableSources.some(rs => source.publisher?.includes(rs));
    const weight = isReputable ? 1.5 : 1.0;
    
    weightedEntail += (score.entail || 0) * weight;
    weightedContra += (score.contra || 0) * weight;
    totalWeight += weight;
  });
  
  // Need at least 2 valid scores to make a determination
  if (validScores < 2 || totalWeight === 0) {
    return 'insufficient_evidence';
  }
  
  const avgEntail = weightedEntail / totalWeight;
  const avgContra = weightedContra / totalWeight;
  
  console.log(`Consensus - Valid scores: ${validScores}, Avg entail: ${avgEntail.toFixed(3)}, Avg contra: ${avgContra.toFixed(3)}`);
  
  // Adjusted thresholds for better discrimination
  if (avgEntail >= 0.35 && avgContra <= 0.15) {
    return 'strongly_supported';
  }
  if (avgEntail >= 0.25 && avgContra <= 0.20) {
    return 'supported';
  }
  if (avgContra >= 0.35 && avgEntail <= 0.15) {
    return 'refuted';
  }
  if (avgContra >= 0.25 && avgEntail <= 0.20) {
    return 'likely_false';
  }
  
  // Check for clear winner even with lower scores
  const ratio = avgEntail > 0 ? avgContra / avgEntail : 999;
  if (avgEntail > avgContra * 1.5 && avgEntail > 0.15) {
    return 'supported';
  }
  if (avgContra > avgEntail * 1.5 && avgContra > 0.15) {
    return 'likely_false';
  }
  
  // Default to contested only if scores are close
  if (Math.abs(avgEntail - avgContra) <= 0.1) {
    return 'contested';
  }
  
  // If we have some signal but it's weak
  if (avgEntail > avgContra && avgEntail > 0.1) {
    return 'weakly_supported';
  }
  if (avgContra > avgEntail && avgContra > 0.1) {
    return 'weakly_refuted';
  }
  
  return 'insufficient_evidence';
}

// Mock sources for testing and rate limit fallback
function getMockSources() {
  return [
    {
      title: 'Global Economic Growth Reaches 3.2% in Latest Quarter',
      url: 'https://example.com/economic-growth-q3',
      publisher: 'Reuters',
      description: 'Latest economic data shows steady growth across major economies, with technology and healthcare sectors leading the expansion.',
      publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
    },
    {
      title: 'New Climate Research Shows Accelerating Ice Sheet Loss', 
      url: 'https://example.com/climate-research-2024',
      publisher: 'BBC',
      description: 'Scientists report that Antarctic ice sheets are melting at twice the rate previously estimated, with significant implications for sea level rise.',
      publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    },
    {
      title: 'Technology Sector Employment Increases by 15% This Year',
      url: 'https://example.com/tech-employment-2024',
      publisher: 'The Guardian',
      description: 'The technology sector continues to drive job creation, with artificial intelligence and cybersecurity roles seeing the highest demand.',
      publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago
    },
    {
      title: 'Healthcare Innovations Reduce Treatment Costs by 25%',
      url: 'https://example.com/healthcare-innovations',
      publisher: 'NPR',
      description: 'New medical technologies and treatment protocols are making healthcare more affordable while improving patient outcomes.',
      publishedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() // 4 days ago
    },
    {
      title: 'Renewable Energy Capacity Doubles in Major Economies',
      url: 'https://example.com/renewable-energy-2024',
      publisher: 'Bloomberg',
      description: 'Wind and solar power installations have reached record levels, with costs falling below traditional energy sources in most markets.',
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days ago
    },
    {
      title: 'Education Technology Improves Student Performance Metrics',
      url: 'https://example.com/edtech-performance',
      publisher: 'The New York Times',
      description: 'Studies show that digital learning platforms and AI-powered tutoring systems are helping students achieve better academic outcomes.',
      publishedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString() // 6 days ago
    }
  ];
}

// Enhanced UI element detection
function isUIElement(sentence) {
  const uiKeywords = [
    'arrow_back', 'logout', 'back to home', 'update email', 'change password',
    'api key', 'subscription', 'developer plan', 'manage subscription',
    'usage requests', 'resetting in', 'usage history', 'follow us on twitter',
    'click here', 'sign up', 'log in', 'menu', 'navigation', 'search',
    'newsletter', 'subscribe', 'unsubscribe', 'privacy policy', 'terms of service',
    'cookies', 'advertisement', 'sponsored', 'read more', 'show more',
    'load more', 'next page', 'previous page', 'share', 'comment', 'like',
    'follow', 'copyright', 'all rights reserved'
  ];
  
  const lowerSentence = sentence.toLowerCase();
  return uiKeywords.some(keyword => lowerSentence.includes(keyword)) ||
         /^\s*(home|about|contact|help|faq|support)\s*$/i.test(sentence.trim()) ||
         sentence.includes('©') || sentence.includes('®') || sentence.includes('™') ||
         /^\s*\d+\s+(minutes?|hours?|days?)\s+ago\s*$/i.test(sentence.trim()) ||
         sentence.length < 30; // Shortened from 40 to 30
}

// New function to detect navigation content
function isNavigationContent(sentence) {
  const navPatterns = [
    /^(skip to|jump to|go to)/i,
    /^(main menu|site navigation|breadcrumb)/i,
    /^\s*(home|news|sports|politics|business|entertainment|technology)\s*$/i,
    /^\s*(previous|next|page \d+|1 of \d+)\s*$/i,
    /^(search results|filter by|sort by|view all)/i,
    /(toggle|expand|collapse|dropdown)/i
  ];
  
  return navPatterns.some(pattern => pattern.test(sentence));
}

// New function to detect advertising content
function isAdvertisingContent(sentence) {
  const adPatterns = [
    /(advertisement|sponsored|promoted|affiliate)/i,
    /(buy now|shop now|order now|get yours)/i,
    /(sale|discount|% off|free shipping)/i,
    /(limited time|hurry|act now|don't miss)/i,
    /(casino|bitcoin|crypto|forex|investment opportunity)/i,
    /^\s*(ad|ads|advertisement)\s*$/i
  ];
  
  return adPatterns.some(pattern => pattern.test(sentence));
}

// New function to detect metadata content
function isMetadata(sentence) {
  const metaPatterns = [
    /^(published|updated|edited|written|authored|by)/i,
    /^(tags|categories|filed under)/i,
    /^\d{1,2}[\/:]\d{1,2}[\/:]\d{2,4}/,  // dates
    /^\d+ (min|minutes|hour|hours|second|seconds) read$/i,
    /^(source|credit|photo by|image)/i,
    /^(related|see also|more from)/i,
    /^\s*\d+\s*(comments?|replies?|views?|shares?)\s*$/i
  ];
  
  return metaPatterns.some(pattern => pattern.test(sentence));
}

// Streaming analysis endpoint for real-time updates
app.post('/analyze-stream', async (req, res) => {
  try {
    const { text } = req.body;
    
    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    
    // Send initial status
    res.write(`data: ${JSON.stringify({
      type: 'status',
      message: 'Starting analysis...'
    })}\n\n`);
    
    // 1. Page type detection
    const pageType = await classifyPageType(text);
    res.write(`data: ${JSON.stringify({
      type: 'page_type',
      data: pageType
    })}\n\n`);
    
    // 2. Extract claims
    res.write(`data: ${JSON.stringify({
      type: 'status',
      message: 'Extracting factual claims...'
    })}\n\n`);
    
    const claimsWithEntities = extractFactualClaims(text, 10);
    
    if (claimsWithEntities.length === 0) {
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        data: {
          page_type: pageType,
          claims: [],
          consensus: {
            summary: 'No verifiable factual claims found in the article.',
            disclaimer: 'The article may be opinion-based or lack specific factual assertions.'
          },
          sources: []
        }
      })}\n\n`);
      res.end();
      return;
    }
    
    // Send claims found
    res.write(`data: ${JSON.stringify({
      type: 'claims_extracted',
      data: { count: claimsWithEntities.length }
    })}\n\n`);
    
    // 3. Build search queries and get sources
    res.write(`data: ${JSON.stringify({
      type: 'status',
      message: 'Searching for relevant sources...'
    })}\n\n`);
    
    const allQueries = [];
    claimsWithEntities.forEach(claim => {
      const queries = buildSearchQueries(claim, claim.entities);
      allQueries.push(...queries);
    });
    
    const uniqueQueries = [...new Set(allQueries)].slice(0, 5);
    const sources = await searchNewsEnhanced(uniqueQueries, 12);
    
    // Check if we're using mock data
    const usingMockData = !NEWS_API_KEY || sources.some(s => s.url.includes('example.com'));
    
    res.write(`data: ${JSON.stringify({
      type: 'sources_found',
      data: { 
        count: sources.length, 
        mock_data: usingMockData,
        message: usingMockData ? 'Using sample sources (API limit reached or no API key)' : 'Found real news sources',
        sources: sources.slice(0, 10).map(s => ({
          title: s.title,
          url: s.url,
          publisher: s.publisher,
          published: s.publishedAt
        })) 
      }
    })}\n\n`);
    
    const evidenceTexts = sources.map(source => {
      const parts = [];
      if (source.title) parts.push(source.title);
      if (source.description) parts.push(source.description);
      if (source.content) parts.push(source.content.slice(0, 200));
      return parts.join('. ').trim();
    }).filter(text => text.length > 30);
    
    // 4. Process claims with parallel processing and stream results
    const resultClaims = [];
    
    // Process claims in smaller batches for streaming
    const batchSize = 2;
    for (let i = 0; i < claimsWithEntities.length; i += batchSize) {
      const batch = claimsWithEntities.slice(i, i + batchSize);
      
      res.write(`data: ${JSON.stringify({
        type: 'status',
        message: `Analyzing claims ${i + 1}-${Math.min(i + batchSize, claimsWithEntities.length)} of ${claimsWithEntities.length}...`
      })}\n\n`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (claim, batchIndex) => {
        const nliScores = [];
        
        // Process NLI calls for this claim in parallel with limited concurrency
        const nliPromises = evidenceTexts.slice(0, 8).map(async (evidence) => {
          try {
            return await performEnhancedNLI(evidence, claim.text);
          } catch (error) {
            console.error('NLI error for evidence:', error.message);
            return { entail: 0.0, contra: 0.0, neutral: 1.0 };
          }
        });
        
        // Execute in batches of 3 to avoid overwhelming the API
        const results = [];
        for (let j = 0; j < nliPromises.length; j += 3) {
          const nliBatch = nliPromises.slice(j, j + 3);
          const batchResults = await Promise.all(nliBatch);
          results.push(...batchResults);
        }
        
        nliScores.push(...results);
        const consensus = calculateWeightedConsensus(nliScores, sources.slice(0, 8));
        const avgEntail = nliScores.reduce((sum, s) => sum + s.entail, 0) / nliScores.length;
        const avgContra = nliScores.reduce((sum, s) => sum + s.contra, 0) / nliScores.length;
        
        return {
          text: claim.text,
          confidence_score: claim.score,
          entail_score: avgEntail,
          contra_score: avgContra,
          consensus: consensus,
          entities: claim.entities,
          confidence: claim.score.toFixed(2),
          support: avgEntail.toFixed(2),
          contradiction: avgContra.toFixed(2),
          verdict: consensus,
          originalIndex: i + batchIndex
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      resultClaims.push(...batchResults);
      
      // Stream each result immediately
      batchResults.forEach((processedClaim) => {
        res.write(`data: ${JSON.stringify({
          type: 'claim_result',
          data: {
            claim: processedClaim,
            index: processedClaim.originalIndex,
            total: claimsWithEntities.length
          }
        })}\n\n`);
      });
    }
    
    // Generate final consensus
    const stronglySupported = resultClaims.filter(c => c.consensus === 'strongly_supported');
    const supported = resultClaims.filter(c => c.consensus === 'supported');
    const contested = resultClaims.filter(c => c.consensus === 'contested');
    const refuted = resultClaims.filter(c => c.consensus === 'refuted' || c.consensus === 'likely_false');
    
    const summaryParts = [];
    if (stronglySupported.length > 0) {
      summaryParts.push(`Strongly supported by multiple sources: ${stronglySupported[0].text.slice(0, 100)}...`);
    }
    if (supported.length > 0) {
      summaryParts.push(`Generally supported: ${supported[0].text.slice(0, 100)}...`);
    }
    if (contested.length > 0) {
      summaryParts.push(`Disputed claims: ${contested[0].text.slice(0, 100)}...`);
    }
    if (refuted.length > 0) {
      summaryParts.push(`Contradicted by sources: ${refuted[0].text.slice(0, 100)}...`);
    }
    
    const consensusSummary = summaryParts.length > 0 
      ? summaryParts.join(' ') 
      : 'Unable to establish clear consensus from available sources.';
    
    const credibilityScore = calculateCredibilityScore(resultClaims);
    
    // Send final complete result
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      data: {
        page_type: pageType,
        credibility_score: credibilityScore,
        claims: resultClaims,
        consensus: {
          summary: consensusSummary,
          disclaimer: 'Analysis based on automated NLI and news source comparison. Results should be verified independently.',
          sources_analyzed: sources.length,
          reputable_sources: sources.filter(s => 
            ['Reuters', 'AP', 'Bloomberg', 'BBC', 'CNN', 'The Guardian', 'NPR', 'The New York Times', 'The Washington Post']
              .some(rs => s.publisher?.includes(rs))
          ).length
        },
        sources: sources.slice(0, 10).map(s => ({
          title: s.title,
          url: s.url,
          publisher: s.publisher,
          published: s.publishedAt
        }))
      }
    })}\n\n`);
    
    res.end();
    
  } catch (error) {
    console.error('Streaming analysis error:', error);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message
    })}\n\n`);
    res.end();
  }
});

// Main analysis endpoint
app.post('/analyze', async (req, res) => {
  try {
    const { text } = req.body;
    
    // 1. Page type detection
    const pageType = await classifyPageType(text);
    
    // 2. Enhanced claim extraction
    const claimsWithEntities = extractFactualClaims(text, 10);
    
    if (claimsWithEntities.length === 0) {
      return res.json({
        page_type: pageType,
        claims: [],
        consensus: {
          summary: 'No verifiable factual claims found in the article.',
          disclaimer: 'The article may be opinion-based or lack specific factual assertions.'
        },
        sources: []
      });
    }
    
    // 3. Build optimized search queries
    const allQueries = [];
    claimsWithEntities.forEach(claim => {
      const queries = buildSearchQueries(claim, claim.entities);
      allQueries.push(...queries);
    });
    
    // Remove duplicates and limit
    const uniqueQueries = [...new Set(allQueries)].slice(0, 5);
    
    // 4. Enhanced evidence retrieval
    const sources = await searchNewsEnhanced(uniqueQueries, 12);
    
    // Build evidence texts with more context
    const evidenceTexts = sources.map(source => {
      const parts = [];
      if (source.title) parts.push(source.title);
      if (source.description) parts.push(source.description);
      if (source.content) parts.push(source.content.slice(0, 200));
      return parts.join('. ').trim();
    }).filter(text => text.length > 30);
    
    // 5. Score claims with parallel processing for better performance
    const resultClaims = await processClaimsInParallel(claimsWithEntities, evidenceTexts, sources);
    
    // 6. Generate improved consensus summary
    const stronglySupported = resultClaims.filter(c => c.consensus === 'strongly_supported');
    const supported = resultClaims.filter(c => c.consensus === 'supported');
    const contested = resultClaims.filter(c => c.consensus === 'contested');
    const refuted = resultClaims.filter(c => c.consensus === 'refuted' || c.consensus === 'likely_false');
    
    const summaryParts = [];
    
    if (stronglySupported.length > 0) {
      summaryParts.push(`Strongly supported by multiple sources: ${stronglySupported[0].text.slice(0, 100)}...`);
    }
    if (supported.length > 0) {
      summaryParts.push(`Generally supported: ${supported[0].text.slice(0, 100)}...`);
    }
    if (contested.length > 0) {
      summaryParts.push(`Disputed claims: ${contested[0].text.slice(0, 100)}...`);
    }
    if (refuted.length > 0) {
      summaryParts.push(`Contradicted by sources: ${refuted[0].text.slice(0, 100)}...`);
    }
    
    const consensusSummary = summaryParts.length > 0 
      ? summaryParts.join(' ') 
      : 'Unable to establish clear consensus from available sources.';
    
    // Calculate overall credibility score
    const credibilityScore = calculateCredibilityScore(resultClaims);
    
    res.json({
      page_type: pageType,
      credibility_score: credibilityScore,
      claims: resultClaims.map(c => ({
        text: c.text,
        confidence: c.confidence_score.toFixed(2),
        support: c.entail_score.toFixed(2),
        contradiction: c.contra_score.toFixed(2),
        verdict: c.consensus
      })),
      consensus: {
        summary: consensusSummary,
        disclaimer: 'Analysis based on automated NLI and news source comparison. Results should be verified independently.',
        sources_analyzed: sources.length,
        reputable_sources: sources.filter(s => 
          ['Reuters', 'AP', 'Bloomberg', 'BBC', 'CNN', 'The Guardian', 'NPR', 'The New York Times', 'The Washington Post']
            .some(rs => s.publisher?.includes(rs))
        ).length
      },
      sources: sources.slice(0, 10).map(s => ({
        title: s.title,
        url: s.url,
        publisher: s.publisher,
        published: s.publishedAt
      }))
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Process claims in parallel for better performance
 */
async function processClaimsInParallel(claimsWithEntities, evidenceTexts, sources) {
  
  const processClaim = async (claim) => {
    console.log(`Processing claim: ${claim.text.slice(0, 100)}...`);
    const nliScores = [];
    const relevantSources = [];
    
    // Limit concurrent NLI calls
    const nliPromises = evidenceTexts.slice(0, 8).map(async (evidence, i) => {
      const source = sources[i];
      
      try {
        const nliResult = await performEnhancedNLI(evidence, claim.text);
        
        // Track source relevance based on NLI scores and text similarity
        const sourceRelevance = calculateSourceRelevance(claim, source, evidence, nliResult);
        if (sourceRelevance.score > 0.3) {
          relevantSources.push({
            ...source,
            relevanceScore: sourceRelevance.score,
            matchType: sourceRelevance.matchType,
            evidence: evidence.slice(0, 200)
          });
        }
        
        return nliResult;
      } catch (error) {
        console.error('NLI error for evidence:', error.message);
        return { entail: 0.0, contra: 0.0, neutral: 1.0 };
      }
    });
    
    // Process in batches to avoid overwhelming the API
    const results = [];
    for (let i = 0; i < nliPromises.length; i += MAX_CONCURRENT_NLI) {
      const batch = nliPromises.slice(i, i + MAX_CONCURRENT_NLI);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }
    
    nliScores.push(...results);
    const consensus = calculateWeightedConsensus(nliScores, sources.slice(0, 8));
    
    const avgEntail = nliScores.reduce((sum, s) => sum + s.entail, 0) / nliScores.length;
    const avgContra = nliScores.reduce((sum, s) => sum + s.contra, 0) / nliScores.length;
    
    return {
      text: claim.text,
      confidence_score: claim.score,
      entail_score: avgEntail,
      contra_score: avgContra,
      consensus: consensus,
      entities: claim.entities,
      relevant_sources: relevantSources.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 4)
    };
  };
  
  // Process claims with limited concurrency
  const results = [];
  for (let i = 0; i < claimsWithEntities.length; i += MAX_CONCURRENT_API) {
    const batch = claimsWithEntities.slice(i, i + MAX_CONCURRENT_API);
    const batchPromises = batch.map(processClaim);
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Calculate overall credibility score for the article
 */
function calculateCredibilityScore(claims) {
  if (claims.length === 0) return 0.5;
  
  let totalWeight = 0;
  let weightedScore = 0;
  
  claims.forEach(claim => {
    const weight = claim.confidence_score;
    totalWeight += weight;
    
    let claimScore = 0.5; // neutral
    if (claim.consensus === 'strongly_supported') claimScore = 1.0;
    else if (claim.consensus === 'supported') claimScore = 0.8;
    else if (claim.consensus === 'weakly_supported') claimScore = 0.65; // New
    else if (claim.consensus === 'contested') claimScore = 0.5;
    else if (claim.consensus === 'insufficient_evidence') claimScore = 0.5; // New
    else if (claim.consensus === 'weakly_refuted') claimScore = 0.35; // New
    else if (claim.consensus === 'likely_false') claimScore = 0.3;
    else if (claim.consensus === 'refuted') claimScore = 0.1;
    
    weightedScore += claimScore * weight;
  });
  
  return totalWeight > 0 ? (weightedScore / totalWeight) : 0.5;
}

// Page type classification (kept from original)
async function classifyPageType(text) {
  try {
    const labels = ['news article', 'opinion piece', 'blog post', 'research report', 'fact sheet', 'advertisement'];
    
    // Add shorter timeout for page classification
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Page classification timeout')), 3000)
    );
    
    const classificationPromise = hf.zeroShotClassification({
      inputs: text.slice(0, 4000),
      parameters: { candidate_labels: labels }
    });
    
    const result = await Promise.race([classificationPromise, timeoutPromise]);
    
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
    } else {
      return { label: 'unknown', score: 0.0 };
    }
  } catch (error) {
    console.error('Page type classification error:', error.message);
    return { label: 'unknown', score: 0.0 };
  }
}

// Test scoring endpoint for diagnostics
app.post('/test-scoring', async (req, res) => {
  const { evidence, claim } = req.body;
  
  if (!evidence || !claim) {
    return res.status(400).json({ error: 'Both evidence and claim are required' });
  }
  
  try {
    // Test both HF and fallback scoring
    const hfScore = await performEnhancedNLI(evidence, claim);
    const fallbackScore = fallbackScoring(evidence, claim);
    
    res.json({
      claim: claim,
      evidence: evidence.slice(0, 200) + '...',
      hf_scores: hfScore,
      fallback_scores: fallbackScore,
      consensus_single: calculateWeightedConsensus([hfScore], [{ publisher: 'Test Source' }])
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API status endpoint
app.get('/api-status', (_req, res) => {
  res.json({
    news_api: {
      configured: !!NEWS_API_KEY,
      status: NEWS_API_KEY ? 'active' : 'disabled',
      note: NEWS_API_KEY ? 'Using live News API' : 'Using mock data due to missing API key'
    },
    huggingface: {
      configured: !!process.env.HF_TOKEN,
      status: process.env.HF_TOKEN ? 'active' : 'fallback',
      note: process.env.HF_TOKEN ? 'Using Hugging Face API' : 'Using fallback scoring'
    },
    rate_limiting: {
      news_api_delay: '500ms between requests',
      recommendation: 'Consider upgrading News API plan if hitting rate limits frequently'
    }
  });
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

app.listen(PORT, () => {
  console.log(`Enhanced news fact checker backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`News API: ${NEWS_API_KEY ? 'Configured' : 'Not configured (using mock data)'}`);
});