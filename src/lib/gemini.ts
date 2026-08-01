export type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required: string[];
    };
  }>;
};

export type GeminiMessage = {
  role: 'user' | 'model' | 'function';
  parts: Array<{ text?: string; functionCall?: { name: string; args: any }; functionResponse?: { name: string; response: any } }>;
};

export async function callGeminiChat(
  history: GeminiMessage[],
  systemPrompt: string,
  apiKey: string,
  tools?: GeminiTool[]
): Promise<GeminiMessage> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  
  const body: any = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: history,
    generationConfig: {
      temperature: 0.7,
    }
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API Error:', errorText);
    throw new Error(`API Greška: ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  
  if (!candidate || !candidate.content) {
    throw new Error('Nema odgovora od asistenta.');
  }

  return candidate.content;
}

export async function callGemini(prompt: string, systemPrompt: string, apiKey: string): Promise<string> {
  const result = await callGeminiChat(
    [{ role: 'user', parts: [{ text: prompt }] }],
    systemPrompt,
    apiKey
  );
  return result.parts[0].text || '';
}
