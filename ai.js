import dotenv from 'dotenv';
import OpenAI from "openai";

dotenv.config();

const openai = new OpenAI({apiKey:process.env.OPENAPIKEY});

async function main() {
    const stream = await openai.chat.completions.create({
        model: "text-embedding-ada-002",
        messages: [{ role: "user", content: "Say this is a test" }],
        stream: true,
    });
    for await (const chunk of stream) {
        process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }
}

main();