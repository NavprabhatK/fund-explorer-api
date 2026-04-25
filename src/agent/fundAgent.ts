//import { google } from "@ai-sdk/google";  // changed
/*import { createGroq } from "@ai-sdk/groq";
import { generateText } from "ai";
import { searchFundsTool, getFundDetailsTool, getIndexFundsTool } from "../tools/fundTools";

export interface UserPreference {
    riskAppetite: "low" | "medium" | "high";
    investmentGoal: string;
    horizon: string;
    monthlyAmount?: number;
    preferIndex?: boolean;
    freeText?: string;
}

export async function runFundRecommendationAgent(preference: UserPreference) {
    const userContext = `
    Risk Appetite: ${preference.riskAppetite}
    Investment Goal: ${preference.investmentGoal}
    Time Horizon: ${preference.horizon}
    ${preference.monthlyAmount ? `Monthly SIP Amount: ₹${preference.monthlyAmount}` : ""}
    ${preference.preferIndex ? "User prefers index/passive funds" : ""}
    ${preference.freeText ? `Additional context: ${preference.freeText}` : ""}
  `.trim();

    const groq = createGroq({
        apiKey: process.env.GROQ_API_KEY,
    });

    // Step 1: Let the agent do all tool calls to gather fund data
    const { steps } = await generateText({
        model: groq("llama-3.3-70b-versatile"),
        maxSteps: 10,
        system: `You are an expert Indian mutual fund advisor. 
Use the available tools to search and fetch real fund data based on the user's preferences.
- For low risk users: prefer index funds, large cap, or debt-oriented hybrid
- For medium risk: flexi cap, large & mid cap, or balanced advantage
- For high risk: mid cap, small cap, or sectoral/thematic
- Fetch details for at least 3 funds using getFundDetails to get NAV and returns data.`,
        prompt: `Fetch fund data for this user:\n\n${userContext}`,
        tools: {
            searchFunds: searchFundsTool,
            getFundDetails: getFundDetailsTool,
            getIndexFunds: getIndexFundsTool,
        },
    });

    // Step 2: Collect all tool results from the steps
    const toolResultsSummary = steps
        .flatMap(step => step.toolResults ?? [])
        .map(r => JSON.stringify(r))
        .join("\n\n");

    console.log("Tool results collected:", toolResultsSummary.slice(0, 500));

    // Step 3: Separate call with NO tools — just summarize into JSON
    const { text: finalText } = await generateText({
        model: groq("llama-3.3-70b-versatile"),
        system: `You are an expert Indian mutual fund advisor. 
Respond ONLY with a raw JSON object. No markdown, no backticks, no explanation.
Start your response with { and end with }.`,
        prompt: `Based on this user profile:
${userContext}

And this real fund data fetched from the API:
${toolResultsSummary}

Recommend exactly 3 funds in this exact JSON format:
{
  "recommendations": [
    {
      "rank": 1,
      "schemeName": "...",
      "schemeCode": "...",
      "fundHouse": "...",
      "category": "...",
      "currentNAV": "...",
      "returns1Year": "...",
      "returns30Days": "...",
      "whyChosen": "2-3 sentence personalized explanation"
    }
  ],
  "summary": "Overall strategy explanation in 2-3 sentences"
}`,
    });

    console.log("Final model response:", finalText);

    const jsonMatch = finalText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error(`Model did not return valid JSON. Raw response: ${finalText}`);
    }

    return JSON.parse(jsonMatch[0]);
}*/







/*import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { searchFundsTool, getFundDetailsTool, getIndexFundsTool } from "../tools/fundTools";

export interface UserPreference {
    riskAppetite: "low" | "medium" | "high";
    investmentGoal: string;       // "retirement", "house", "wealth creation"
    horizon: string;              // "1 year", "5 years", "10+ years"
    monthlyAmount?: number;       // SIP amount in INR
    preferIndex?: boolean;        // prefers passive/index funds
    freeText?: string;            // raw user input
}

export async function runFundRecommendationAgent(preference: UserPreference) {
    const userContext = `
    Risk Appetite: ${preference.riskAppetite}
    Investment Goal: ${preference.investmentGoal}
    Time Horizon: ${preference.horizon}
    ${preference.monthlyAmount ? `Monthly SIP Amount: ₹${preference.monthlyAmount}` : ""}
    ${preference.preferIndex ? "User prefers index/passive funds" : ""}
    ${preference.freeText ? `Additional context: ${preference.freeText}` : ""}
  `.trim();

    const { text, steps } = await generateText({
        //model: anthropic("claude-sonnet-4-20250514"),
        model: anthropic("claude-haiku-4-5"),
        maxSteps: 10, // allows multi-step tool use (agentic loop)
        system: `You are an expert Indian mutual fund advisor.
Your job is to recommend exactly 3 funds tailored to the user's preferences.

Guidelines:
- Always use the available tools to fetch REAL, LIVE fund data before recommending
- For low risk users: prefer index funds, large cap, or debt-oriented hybrid
- For medium risk: flexi cap, large & mid cap, or balanced advantage
- For high risk: mid cap, small cap, or sectoral/thematic
- Always check 1-year and 30-day returns using getFundDetails
- Respond ONLY in this JSON format (no markdown, no extra text):
{
  "recommendations": [
    {
      "rank": 1,
      "schemeName": "...",
      "schemeCode": "...",
      "fundHouse": "...",
      "category": "...",
      "currentNAV": "...",
      "returns1Year": "...",
      "returns30Days": "...",
      "whyChosen": "2-3 sentence personalized explanation"
    }
  ],
  "summary": "Overall strategy explanation in 2-3 sentences"
}`,
        prompt: `Based on these user preferences, find and recommend exactly 3 mutual funds:\n\n${userContext}`,
        tools: {
            searchFunds: searchFundsTool,
            getFundDetails: getFundDetailsTool,
            getIndexFunds: getIndexFundsTool,
        },
    });

    // Parse the JSON response
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
}*/



import Anthropic from "@anthropic-ai/sdk";
import { searchFundsTool, getFundDetailsTool, getIndexFundsTool } from "../tools/fundTools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface UserPreference {
    riskAppetite: "low" | "medium" | "high";
    investmentGoal: string;
    horizon: string;
    monthlyAmount?: number;
    preferIndex?: boolean;
    freeText?: string;
}

const tools: Anthropic.Tool[] = [
    {
        name: "searchFunds",
        description: "Search for Indian mutual funds or index funds by name or category keyword.",
        input_schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Fund name, AMC, or category e.g. 'Nifty 50 index', 'flexi cap'",
                },
            },
            required: ["query"],
        },
    },
    {
        name: "getFundDetails",
        description: "Get detailed NAV history and fund metadata by scheme code.",
        input_schema: {
            type: "object",
            properties: {
                schemeCode: {
                    type: "string",
                    description: "The unique scheme code of the mutual fund",
                },
            },
            required: ["schemeCode"],
        },
    },
    {
        name: "getIndexFunds",
        description: "Get a curated list of popular Indian index funds and their scheme codes.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
];

async function executeTool(name: string, input: any): Promise<any> {
    if (name === "searchFunds") return await searchFundsTool.execute!(input, {} as any);
    if (name === "getFundDetails") return await getFundDetailsTool.execute!(input, {} as any);
    if (name === "getIndexFunds") return await getIndexFundsTool.execute!(input, {} as any);
    throw new Error(`Unknown tool: ${name}`);
}

function extractJSON(text: string) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in response: " + text.substring(0, 200));
    return JSON.parse(match[0]);
}

export async function runFundRecommendationAgent(preference: UserPreference) {
    const userContext = `
    Risk Appetite: ${preference.riskAppetite}
    Investment Goal: ${preference.investmentGoal}
    Time Horizon: ${preference.horizon}
    ${preference.monthlyAmount ? `Monthly SIP Amount: ₹${preference.monthlyAmount}` : ""}
    ${preference.preferIndex ? "User prefers index/passive funds" : ""}
    ${preference.freeText ? `Additional context: ${preference.freeText}` : ""}
    `.trim();

    const messages: Anthropic.MessageParam[] = [
        {
            role: "user",
            content: `Based on these user preferences, find and recommend exactly 3 mutual funds:\n\n${userContext}`,
        },
    ];

    const systemPrompt = `You are an expert Indian mutual fund advisor.
Your job is to recommend exactly 3 funds tailored to the user's preferences.

Guidelines:
- Always use the available tools to fetch REAL, LIVE fund data before recommending
- For low risk users: prefer index funds, large cap, or debt-oriented hybrid
- For medium risk: flexi cap, large & mid cap, or balanced advantage
- For high risk: mid cap, small cap, or sectoral/thematic
- Always check 1-year and 30-day returns using getFundDetails
- Do NOT add any text before or after the JSON
- Output ONLY the raw JSON object, nothing else

Respond ONLY in this exact JSON format:
{
  "recommendations": [
    {
      "rank": 1,
      "schemeName": "...",
      "schemeCode": "...",
      "fundHouse": "...",
      "category": "...",
      "currentNAV": "...",
      "returns1Year": "...",
      "returns30Days": "...",
      "whyChosen": "2-3 sentence personalized explanation"
    }
  ],
  "summary": "Overall strategy explanation in 2-3 sentences"
}`;

    for (let step = 0; step < 10; step++) {
        const response = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 4096,
            system: systemPrompt,
            tools,
            messages,
        });

        // Add assistant response to history
        messages.push({ role: "assistant", content: response.content });

        // Final answer
        if (response.stop_reason === "end_turn") {
            const textBlock = response.content.find((b) => b.type === "text");
            if (!textBlock || textBlock.type !== "text") {
                throw new Error("No text response from agent");
            }
            return extractJSON(textBlock.text);
        }

        // Process tool calls
        if (response.stop_reason === "tool_use") {
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const block of response.content) {
                if (block.type === "tool_use") {
                    console.log(`🔧 Tool called: ${block.name}`, block.input);
                    try {
                        const result = await executeTool(block.name, block.input);
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: JSON.stringify(result),
                        });
                    } catch (err: any) {
                        // Return error to agent so it can recover
                        toolResults.push({
                            type: "tool_result",
                            tool_use_id: block.id,
                            content: `Error: ${err.message}`,
                            is_error: true,
                        });
                    }
                }
            }

            messages.push({ role: "user", content: toolResults });
        }
    }

    throw new Error("Agent exceeded maximum steps without finishing");
}



