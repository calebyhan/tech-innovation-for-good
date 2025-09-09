# News Fact Checker

An intelligent Chrome extension that automatically detects news articles and provides real-time fact-checking through AI-powered analysis. The extension mines factual claims from news content, cross-references them with multiple sources, and displays consensus-based truth assessments using advanced Natural Language Processing.

Devpost: https://devpost.com/software/news-fact-checker

## 🌟 Key Features

- **Smart News Detection**: Automatically identifies news articles using URL patterns, content analysis, and metadata
- **Toggle Control**: Master switch to enable/disable automatic fact-checking with manual override option
- **Intelligent Claim Extraction**: Advanced NLP algorithms identify factual claims while filtering out opinions and UI elements
- **Multi-Source Verification**: Cross-references claims against multiple reputable news sources
- **Real-Time Analysis**: Streaming results with progressive updates as analysis proceeds
- **Source Relevance Matching**: Sophisticated algorithm matches specific sources to individual claims
- **Interactive UI**: Click on highlighted claims to see supporting/contradicting sources
- **Consensus Scoring**: Weighted analysis considering source credibility and content relevance

## 🏗️ Architecture

### Frontend (Chrome Extension)
- **Content Script**: Extracts page text, detects news articles, manages UI overlays
- **Service Worker**: Handles communication with backend API and streaming data
- **Popup Interface**: Toggle controls, status display, and manual analysis options

### Backend (Node.js API)
- **Claim Extraction**: Heuristic and NLP-based factual claim mining
- **Source Search**: Enhanced news API integration with rate limiting and fallback
- **NLI Analysis**: Natural Language Inference using Hugging Face transformers
- **Consensus Engine**: Weighted scoring system for truth assessment

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed
- Chrome browser
- Hugging Face account (free)
- NewsAPI account (free tier available)

### 1. Setup Backend

```bash
# Clone and navigate to backend
cd news-fact-checker/backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys:
# HF_TOKEN=your_huggingface_token
# NEWS_API_KEY=your_newsapi_key

# Start server
npm start
```

### 2. Install Extension

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" → Select `news-fact-checker/extension/`
4. Extension icon should appear in toolbar

### 3. Usage

1. **Automatic Mode**: Navigate to any news article - extension detects and analyzes automatically
2. **Manual Mode**: Click extension icon → Toggle off auto-analysis → Use "Analyze This Page" button
3. **View Results**: Click highlighted claims to see source verification

## 🔧 Configuration

### Environment Variables
```bash
# Backend (.env file)
HF_TOKEN=hf_your_token_here          # Hugging Face API (Read permission)
NEWS_API_KEY=your_newsapi_key_here   # NewsAPI.org key
PORT=3000                            # Server port (optional)
```

### Extension Settings
- **Auto-Check Toggle**: Enable/disable automatic news analysis
- **Force Analyze**: Manual analysis override for any page
- **Source Display**: View relevance scores and match explanations

## 🧠 AI Models & Technologies

### Natural Language Processing
- **Page Classification**: Zero-shot classification for content type detection
- **Claim Extraction**: Custom heuristics + compromise.js NLP library
- **Evidence Matching**: Multi-strategy relevance scoring (semantic, entity, keyword)
- **Inference Engine**: Facebook BART for natural language inference

### Source Verification
- **News APIs**: NewsAPI.org with rate limiting and mock fallback
- **Quality Scoring**: Reputable source identification and weighting
- **Relevance Matching**: Entity extraction, number matching, semantic similarity

## 📊 Analysis Pipeline

1. **Page Detection** → URL patterns + content analysis + metadata
2. **Claim Mining** → NLP extraction + factual scoring + entity recognition
3. **Source Search** → Multi-query search + deduplication + quality filtering
4. **Evidence Analysis** → NLI scoring + relevance matching + consensus building
5. **Result Display** → Interactive highlights + source panels + consensus summary

## 🎯 Smart Detection Features

### News Article Recognition
- **URL Pattern Matching**: `/news/`, `/article/`, domain-specific patterns
- **Content Analysis**: Publication dates, bylines, news phrases
- **Metadata Detection**: OpenGraph tags, JSON-LD structured data
- **Domain Recognition**: 20+ major news outlets pre-configured

### Claim Quality Assessment
- **Factual Indicators**: Statistics, dates, named entities, attributions
- **Opinion Filtering**: Removes subjective language and speculation
- **UI Element Removal**: Filters navigation, ads, and metadata
- **Relevance Scoring**: Multi-factor assessment for claim importance

## 🔍 Advanced Source Matching

### Relevance Algorithms
- **Semantic Matching**: NLI-based content similarity
- **Entity Matching**: People, places, organizations alignment
- **Numerical Matching**: Exact number and percentage correlation
- **Keyword Density**: Weighted term overlap analysis
- **Title Prioritization**: Higher weighting for headline matches

### Consensus Building
- **Weighted Scoring**: Reputable sources get higher influence
- **Confidence Thresholds**: Multiple levels (strongly supported → refuted)
- **Evidence Requirements**: Minimum source count for determinations
- **Contradiction Detection**: Explicit disagreement identification

## 🛠️ Development

### Backend Development
```bash
# Development server with auto-restart
npm run dev

# Testing endpoints
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{"url":"...", "title":"...", "text":"..."}'

# API status check
curl http://localhost:3000/api-status
```

### Extension Development
- **Hot Reload**: Refresh extension after code changes
- **Console Debugging**: Check browser console for content script logs
- **Service Worker**: Monitor in `chrome://extensions/` → service worker link

## 🚀 Deployment Options

### Backend Deployment
- **Vercel**: `npm i -g vercel && vercel --prod`
- **Railway**: Connect GitHub repo for auto-deploy
- **Heroku**: `git push heroku main`
- **AWS/GCP**: Container or serverless options

### Extension Distribution
- **Development**: Load unpacked for testing
- **Chrome Web Store**: Publish for public distribution
- **Enterprise**: Package for organizational deployment

## 🔧 Troubleshooting

### Common Issues

**"Connection to fact-check service failed"**
- Ensure backend server is running on port 3000
- Check firewall/network restrictions
- Verify API keys in `.env` file

**"No sources found for claim"**
- May indicate NewsAPI rate limits (check console)
- Extension falls back to mock data automatically
- Consider upgrading NewsAPI plan for production

**Duplicate analysis popups**
- Fixed in latest version with state management
- Reload extension if persists

**Toggle not working**
- Check Chrome storage permissions
- Ensure service worker is active

### Debug Mode
Enable verbose logging by setting `DEBUG=true` in backend `.env`

## 📈 Performance & Limits

### Rate Limits
- **NewsAPI Free**: 1000 requests/day
- **Hugging Face Free**: 1000 requests/month
- **Backend**: 500ms delay between news API calls

### Optimization
- **Caching**: Source results cached per session
- **Deduplication**: URL-based article deduplication
- **Text Limits**: Articles capped at 100KB for processing

## 🔒 Privacy & Security

- **No Data Storage**: Analysis results not saved server-side
- **Local Settings**: User preferences stored in Chrome storage
- **API Security**: Keys stored server-side only
- **Content Security**: No injection of remote resources

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Hugging Face**: Transformer models for NLI and classification
- **NewsAPI**: News source aggregation
- **compromise.js**: Natural language processing library
- **Chrome Extensions API**: Platform foundation
## 📊 Project Scope & Impact

### Problem Statement
Misinformation and "fake news" have become critical challenges in our digital information landscape. Traditional fact-checking is slow, manual, and can't keep pace with the volume of content being published. This project addresses the need for real-time, automated fact verification to help users make informed decisions about news content.

### Target Users
- **General Public**: News consumers seeking reliable information verification
- **Journalists**: Professionals needing quick source verification and claim validation
- **Researchers**: Academics studying misinformation and media literacy
- **Educators**: Teachers demonstrating critical thinking and source evaluation

### Technology Innovation
- **AI-Powered Analysis**: Leverages cutting-edge NLP models for sophisticated content understanding
- **Real-Time Processing**: Streaming analysis provides immediate feedback to users
- **Multi-Source Verification**: Aggregates information from multiple reputable sources for consensus building
- **Smart Detection**: Advanced algorithms distinguish news content from other web pages

### Social Good Applications
- **Media Literacy**: Helps users develop critical thinking skills about information sources
- **Democratic Process**: Supports informed decision-making during elections and policy debates
- **Public Health**: Can help identify medical misinformation during health crises
- **Educational Tool**: Teaches students how to evaluate information credibility

### Measurable Outcomes
- **Accuracy**: Claims verified against multiple reputable sources
- **Speed**: Real-time analysis vs. traditional fact-checking delays
- **Coverage**: Automated processing of content that would otherwise go unchecked
- **Accessibility**: Free tool available to anyone with a Chrome browser

### Future Enhancements
- **Multi-Language Support**: Extend to non-English news sources
- **Video/Audio Analysis**: Process multimedia content for fact-checking
- **API Integration**: Allow other applications to use the fact-checking engine
- **Community Features**: User reporting and collaborative verification
- **Mobile Apps**: Extend beyond browser extension to mobile platforms

This project demonstrates how modern AI technologies can be deployed for social benefit, creating tools that empower individuals to navigate the complex information landscape while promoting truth and transparency in media consumption.