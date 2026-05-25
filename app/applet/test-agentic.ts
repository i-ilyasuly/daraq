import { GoogleGenAI, Type } from '@google/genai';
import 'dotenv/config';

const ai = new GoogleGenAI({});

async function test() {
  const searchDecl = {
    name: "searchDatabase",
    description: "Search the database",
    parameters: {
      type: Type.OBJECT,
      properties: {
         query: { type: Type.STRING, description: "query" }
      },
      required: ["query"]
    }
  };

  const response1 = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: "What is the weather like in Astana?",
    config: { tools: [{ functionDeclarations: [searchDecl] }] }
  });

  let functionCall = null;
  let modelContent = null;
  let text = "";

  for await (const chunk of response1) {
    if (chunk.functionCalls?.length) {
      functionCall = chunk.functionCalls[0];
    }
    if (chunk.text) { text += chunk.text; }
    if (chunk.candidates?.[0]?.content) {
        modelContent = chunk.candidates[0].content; // grab the content to append
    }
  }

  if (functionCall) {
    console.log("Called function:", functionCall);
    const response2 = await ai.models.generateContentStream({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: "What is the weather like in Astana?" }] },
        modelContent,
        { role: 'user', parts: [{ functionResponse: { name: functionCall.name, response: { temp: "-15C" } } }] }
      ]
    });
    
    let text2 = "";
    for await (const chunk of response2) {
       text2 += chunk.text || "";
    }
    console.log("Final response:", text2);
  } else {
     console.log("Final text:", text);
  }
}

test();
