import '../src/backend/crypto-patch';
import { GoogleAuth } from 'google-auth-library';
import path from 'path';

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(process.cwd(), 'gcp-service-account.json');

async function testRanking() {

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  const client = await auth.getClient();
  const projectId = await auth.getProjectId();
  
  console.log(`Using project ID: ${projectId}`);

  const url = `https://discoveryengine.googleapis.com/v1alpha/projects/${projectId}/locations/global/rankingConfigs/default_config:rank`;

  const requestBody = {
    query: "What is the meaning of life?",
    records: [
      { id: "1", content: "The meaning of life is 42." },
      { id: "2", content: "Apples are red." },
      { id: "3", content: "Living a good life involves finding your purpose." }
    ]
  };

  try {
    const res = await client.request({
      url,
      method: 'POST',
      data: requestBody
    });
    console.log("Reranker Response:", JSON.stringify(res.data, null, 2));
  } catch (error: any) {
    console.error("Reranker Error:", error.message, error.response?.data);
  }
}

testRanking();
