# News Fact Checker MVP

A Chrome extension that detects news pages, mines claims, cross-references multiple sources, and shows consensus truth using NLP models.

## Architecture

- **Chrome Extension**: Content script extracts page text, service worker calls backend API, popup displays results
- **Backend API**: Node.js/Express server with Hugging Face models for page classification, claim mining, evidence retrieval, and NLI scoring

## Setup

### Backend

1. Navigate to backend directory:
   ```bash
   cd news-fact-checker/backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set environment variables (copy .env.example to .env and fill in your keys):
   ```bash
   cp .env.example .env
   # Edit .env file with your API keys:
   # HF_TOKEN=your_huggingface_token
   # NEWS_API_KEY=your_newsapi_key
   # PORT=8000
   ```

4. Run the server:
   ```bash
   npm start
   # or for development with auto-restart:
   npm run dev
   ```

### Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" 
3. Click "Load unpacked" and select the `news-fact-checker/extension` directory
4. Update `service_worker.js` with your backend URL (replace `https://YOUR_BACKEND_HOST`)

## API Keys Required

- **Hugging Face Token**: For accessing transformer models via their API
- **NewsAPI Key**: For news search functionality (or replace with alternative news API)

## Models Used

- Page Classification: `facebook/bart-large-mnli`
- Claim Mining: Custom heuristic-based approach
- Evidence Retrieval: NewsAPI + sentence similarity filtering
- NLI Scoring: `facebook/bart-large-mnli` (reused)
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- Summarization: `facebook/bart-large-cnn`

## Usage

1. Navigate to any news article
2. Click the extension icon
3. View page type detection, extracted claims, consensus analysis, and source citations

## MVP Limitations

- Evidence uses news API descriptions rather than full article text
- Simple heuristic claim mining (could be improved with dedicated models)
- Basic NLI approach using zero-shot classification
- No cross-encoder reranking for evidence

## Deployment

For production deployment:
- Deploy Node.js backend to cloud service (AWS, GCP, Azure, Vercel, Railway)
- Consider using dedicated NLI models for better accuracy
- Implement article text extraction from URLs
- Add rate limiting and caching
- Publish extension to Chrome Web Store

### Quick Deploy Options
- **Vercel**: `vercel --prod` (after installing Vercel CLI)
- **Railway**: Connect GitHub repo for automatic deployments
- **Heroku**: `git push heroku main` (with Heroku CLI)
- **AWS/GCP**: Use their respective container or serverless services