import 'dotenv/config';
import { GoogleAuth } from 'google-auth-library';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string; // Loaded Markdown content from Jina Reader Or Firecrawl
}

/**
 * Performs a real-time web search restricted strictly to official, verified Kazakh Islamic domains.
 * Uses official Google Vertex AI Search (Discovery Engine API) to search across muftyat.kz and fatua.kz.
 * Falls back gracefully if no credentials exist or search fails.
 */
export async function search_official_kazakh_fatwas(query: string): Promise<WebSearchResult[]> {
  const queryClean = query.trim();
  if (!queryClean) return [];

  const projectId = process.env.GOOGLE_PROJECT_ID || 'daraq-497018';
  const dataStoreId = process.env.VERTEX_DATA_STORE_ID || 'daraq-fatwas_1';

  console.log(`[🌐 Web Search] Querying official Vertex AI Search (Project: ${projectId}, DataStore: ${dataStoreId}) for: "${queryClean}"`);

  try {
    const auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const accessToken = tokenResponse.token;

    if (!accessToken) {
      throw new Error('Access token is empty.');
    }

    const url = `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/global/collections/default_collection/dataStores/${dataStoreId}/servingConfigs/default_search:search`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: queryClean,
        pageSize: 5,
      }),
    });

    if (response.ok) {
      const data: any = await response.json();
      if (data.results && Array.isArray(data.results)) {
        const results: WebSearchResult[] = [];
        for (const entry of data.results) {
          const doc = entry.document;
          if (!doc) continue;

          const structData = doc.derivedStructData || doc.structData || {};
          const title = structData.title || doc.title || 'Белгісіз тақырып';
          const link = structData.link || structData.formattedUrl || doc.url || '';

          let snippet = '';
          if (structData.snippets && Array.isArray(structData.snippets) && structData.snippets.length > 0) {
            snippet = structData.snippets[0].snippet || structData.snippets[0].htmlSnippet || '';
          } else if (structData.snippet) {
            snippet = structData.snippet;
          } else if (doc.snippet) {
            snippet = doc.snippet;
          }

          if (link) {
            results.push({
              title,
              url: link,
              snippet,
            });
          }
        }
        console.log(`[🌐 Web Search] Vertex AI Search returned ${results.length} results.`);
        return results;
      }
    } else {
      const errText = await response.text();
      console.warn(`[🚨 Web Search] Vertex AI Search returned error status: ${response.status}`);
      console.warn(`[🚨 Web Search] Error Details: ${errText}`);
    }
  } catch (err: any) {
    console.error(`[🚨 Web Search] Vertex AI Search failed:`, err.message || err);
  }

  console.warn(`[⚠️ Web Search] No search credentials configured or Vertex AI Search failed. Falling back empty.`);
  return [];
}

/**
 * Fetches the raw text content of a URL using Jina Reader API (https://r.jina.ai/<url>)
 * to return lightweight, clean Markdown. Falls back gracefully with timeout protection.
 */
export async function scrapeUrlContent(url: string, timeoutMs = 8000): Promise<string> {
  console.log(`[🌐 Reader] Scraping content from URL: ${url}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const readerUrl = `https://r.jina.ai/${encodeURI(url)}`;
    const headers: Record<string, string> = {
      'Accept': 'text/plain'
    };
    if (process.env.JINA_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.JINA_API_KEY}`;
    }

    const response = await fetch(readerUrl, {
      signal: controller.signal,
      headers
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const markdown = await response.text();
      console.log(`[🌐 Reader] Successfully fetched ${markdown.length} bytes of content.`);
      return markdown;
    } else {
      console.warn(`[🚨 Reader] Jina Reader API returned status: ${response.status}`);
      return '';
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn(`[🚨 Reader] Scrape timed out after ${timeoutMs}ms for: ${url}`);
    } else {
      console.error(`[🚨 Reader] Content scraping failed for ${url}:`, err.message || err);
    }
    return '';
  }
}

/**
 * Orchestrated function that performs restricted search, fetches the content of top 2 links (URL),
 * and compiles them into a structured text context.
 */
export async function getVerifiedFatwasContext(
  query: string,
  onAction?: (statusText: string) => void
): Promise<{ text: string; sources: { title: string; url: string; snippet: string }[] }> {
  try {
    if (onAction) {
      onAction('Сенімді сайттардан іздеу');
    }

    const webResults = await search_official_kazakh_fatwas(query);
    if (webResults.length === 0) {
      return { text: '', sources: [] };
    }

    // Limit to top 2 results for fast processing and token efficiency as requested by user
    const targets = webResults.slice(0, 2);
    const sourcesToLog = targets.map(t => ({ title: t.title, url: t.url, snippet: t.snippet }));

    if (onAction) {
      onAction('Ақпаратты өңдеу');
    }

    // Parallel fetch contents of selected articles
    const contentPromises = targets.map(async (item) => {
      const content = await scrapeUrlContent(item.url);
      return {
        ...item,
        content: content ? content.substring(0, 15000) : '' // Avoid excessive sizes while preserving main contents
      };
    });

    const parsedResults = await Promise.all(contentPromises);

    let contextJoined = "";
    parsedResults.forEach((res, index) => {
      const textToAppend = res.content || res.snippet;
      contextJoined += `[ҚМДБ ПӘТУА ${index + 1}] ТАҚЫРЫБЫ: "${res.title}"\nСІЛТЕМЕ: ${res.url}\n\nҚҰРАМЫНДАҒЫ МӘТІН:\n${textToAppend}\n\n-------------------------\n\n`;
    });

    return {
      text: contextJoined.trim(),
      sources: sourcesToLog
    };
  } catch (e: any) {
    console.error(`[🚨 Web Search Pipeline] Error compiling web sources:`, e.message || e);
    return { text: '', sources: [] };
  }
}
