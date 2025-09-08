# tech-innovation-for-good

A Chrome extension that detects news pages, mines claims, cross-references multiple sources, and shows consensus truth using NLP models.

## Architecture

- **Chrome Extension**: Content script extracts page text, service worker calls backend API, popup displays results
- **Backend API**: Node.js/Express server with Hugging Face models for page classification, claim mining, evidence retrieval, and NLI scoring

## Quick Start Checklist

1. [ ] Clone this repository
2. [ ] Get a Hugging Face account and create a **Read** access token ([instructions](https://huggingface.co/settings/tokens))
3. [ ] Get a NewsAPI key ([https://newsapi.org/](https://newsapi.org/))
4. [ ] Copy `news-fact-checker/backend/.env.example` to `.env` and fill in your keys
5. [ ] Install backend dependencies and start the server
6. [ ] Update the extension's `service_worker.js` with your backend URL
7. [ ] Load the extension in Chrome via `chrome://extensions/`
8. [ ] Test on a news article page (must be published at least 24 hours before)

---


## Setup Details

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
   # HF_TOKEN=your_huggingface_token (must have at least READ permission)
   # NEWS_API_KEY=your_newsapi_key
   # PORT=3000
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
4. Update `service_worker.js` with your backend URL (replace `https://YOUR_BACKEND_HOST` with your actual backend address, e.g. `http://localhost:3000`)

## API Keys Required

- **Hugging Face Token**: For accessing transformer models via their API. **Only "Read" permission is required.**
- **NewsAPI Key**: For news search functionality (or replace with alternative news API)

## Models Used

- Page Classification: `facebook/bart-large-mnli`
- Claim Mining: Custom heuristic-based approach
- Evidence Retrieval: NewsAPI + sentence similarity filtering
- NLI Scoring: `facebook/bart-large-mnli` (reused)
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- Summarization: `facebook/bart-large-cnn`

## Usage

1. Start the backend server (see above)
2. Load the extension in Chrome
3. Navigate to any news article
4. Click the extension icon
5. View page type detection, extracted claims, consensus analysis, and source citations

---

## Testing & Troubleshooting

### Testing

1. With the backend running, use a tool like Postman or curl to test the API:
    ```bash
    curl -X POST http://localhost:3000/analyze -H "Content-Type: application/json" -d '{"text": "Your news article text here."}'
    ```
    You should receive a JSON response with analysis results.

2. Load the extension and test on a real news article page.

### Troubleshooting

- **Page type classification error: Cannot read properties of undefined (reading '0')**
   - This usually means the Hugging Face API did not return the expected result. Check:
      - Your `HF_TOKEN` is valid and has at least "Read" permission
      - You have not exceeded your Hugging Face API quota
      - The backend server logs for more details
      - The input text is not empty or too short
- **API errors or empty results**
   - Check your `.env` file for correct keys
   - Restart the backend after editing `.env`
   - Check your internet connection
- **Extension not working**
   - Make sure the backend URL in `service_worker.js` is correct
   - Check the browser console for errors

---

## MVP Limitations

- Evidence uses news API descriptions rather than full article text
- Simple heuristic claim mining (could be improved with dedicated models)
- Basic NLI approach using zero-shot classification
- No cross-encoder reranking for evidence

## Deployment

For production deployment:
- Deploy Node.js backend to a cloud service (AWS, GCP, Azure, Vercel, Railway, etc.)
- Consider using dedicated NLI models for better accuracy
- Implement article text extraction from URLs
- Add rate limiting and caching
- Publish extension to Chrome Web Store

### Quick Deploy Options
- **Vercel**: `vercel --prod` (after installing Vercel CLI)
- **Railway**: Connect GitHub repo for automatic deployments
- **Heroku**: `git push heroku main` (with Heroku CLI)
- **AWS/GCP**: Use their respective container or serverless services

---

**Note:** All Hugging Face API calls are made server-side from the backend. The Chrome extension does not require any special permissions for Hugging Face.